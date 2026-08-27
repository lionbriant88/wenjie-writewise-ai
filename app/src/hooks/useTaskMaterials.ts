import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_MATERIAL_UNITS } from '../services/taskMaterial/constants'
import { normalizeMaterialFile } from '../services/taskMaterial/normalizeMaterialFile'
import {
  MaterialNormalizationError,
  type MaterialNormalizationErrorCode,
  type MaterialUnit,
  type MaterialUnitDraft,
} from '../services/taskMaterial/types'

export type MaterialSourceErrorCode = MaterialNormalizationErrorCode | 'normalization_failed'

export interface MaterialSourceState {
  key: string
  sourceId?: string
  fileName: string
  status: 'normalizing' | 'ready' | 'failed'
  unitIds: readonly string[]
  errorCode?: MaterialSourceErrorCode
  errorMessage?: string
}

export interface TaskMaterialsController {
  units: readonly MaterialUnit[]
  sources: readonly MaterialSourceState[]
  isNormalizing: boolean
  addFiles(files: readonly File[]): Promise<void>
  retrySource(sourceId: string): Promise<void>
  removeUnit(unitId: string): void
  removeSource(sourceId: string): void
  moveUnit(unitId: string, direction: -1 | 1): void
  waitUntilIdle(): Promise<void>
}

export type TaskMaterialNormalizer = (
  file: File,
  options: { remainingUnits: number },
) => Promise<MaterialUnitDraft[]>

export interface UseTaskMaterialsOptions {
  normalizeFile?: TaskMaterialNormalizer
  createId?: () => string
  createObjectURL?: (file: File) => string
  revokeObjectURL?: (url: string) => void
}

const UNKNOWN_FAILURE: Pick<MaterialSourceState, 'errorCode' | 'errorMessage'> = {
  errorCode: 'normalization_failed',
  errorMessage: '材料文件处理失败，请删除后重新选择或重试。',
}

export function useTaskMaterials(options: UseTaskMaterialsOptions = {}): TaskMaterialsController {
  const normalizeFileRef = useRef<TaskMaterialNormalizer>(options.normalizeFile ?? normalizeMaterialFile)
  const createIdRef = useRef(options.createId ?? defaultId)
  const createObjectURLRef = useRef(options.createObjectURL ?? ((file: File) => URL.createObjectURL(file)))
  const revokeObjectURLRef = useRef(options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url)))

  const [units, setUnits] = useState<readonly MaterialUnit[]>([])
  const [sources, setSources] = useState<readonly MaterialSourceState[]>([])
  const [isNormalizing, setIsNormalizing] = useState(false)
  const unitsRef = useRef<readonly MaterialUnit[]>([])
  const sourcesRef = useRef<readonly MaterialSourceState[]>([])
  const sourceFilesRef = useRef(new Map<string, File>())
  const nextSourceKeyRef = useRef(0)
  const liveUrlsRef = useRef(new Set<string>())
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingCountRef = useRef(0)
  const mountedRef = useRef(true)

  const replaceUnits = useCallback((next: readonly MaterialUnit[]) => {
    unitsRef.current = next
    if (mountedRef.current) setUnits(next)
  }, [])

  const replaceSources = useCallback((next: readonly MaterialSourceState[]) => {
    sourcesRef.current = next
    if (mountedRef.current) setSources(next)
  }, [])

  const revoke = useCallback((url: string) => {
    if (!liveUrlsRef.current.delete(url)) return
    revokeObjectURLRef.current(url)
  }, [])

  useEffect(() => () => {
    mountedRef.current = false
    for (const url of liveUrlsRef.current) revokeObjectURLRef.current(url)
    liveUrlsRef.current.clear()
    sourceFilesRef.current.clear()
  }, [])

  const finishPending = useCallback(() => {
    pendingCountRef.current = Math.max(0, pendingCountRef.current - 1)
    if (mountedRef.current && pendingCountRef.current === 0) setIsNormalizing(false)
  }, [])

  const processSource = useCallback(async (sourceKey: string, file: File) => {
    try {
      const remainingUnits = MAX_MATERIAL_UNITS - unitsRef.current.length
      const drafts = await normalizeFileRef.current(file, { remainingUnits })
      if (!mountedRef.current || !isCurrentSourceNormalizing(sourcesRef.current, sourceKey)) return
      if (drafts.length < 1 || drafts.length > MAX_MATERIAL_UNITS - unitsRef.current.length) {
        throw new MaterialNormalizationError('unit_limit_exceeded')
      }

      const createdUrls: string[] = []
      let materialized: MaterialUnit[]
      try {
        const previewUrls = drafts.map((draft) => {
          if (draft.kind === 'text') return undefined
          const previewUrl = createObjectURLRef.current(draft.file)
          createdUrls.push(previewUrl)
          liveUrlsRef.current.add(previewUrl)
          return previewUrl
        })
        const sourceId = createIdRef.current()
        materialized = drafts.map((draft, index) => {
          const id = createIdRef.current()
          if (draft.kind === 'text') return { ...draft, id, sourceId }
          const previewUrl = previewUrls[index]
          if (!previewUrl) throw new Error('Missing material preview URL')
          return { ...draft, id, sourceId, previewUrl }
        })
      } catch (error) {
        createdUrls.forEach(revoke)
        throw error
      }

      if (!mountedRef.current || !isCurrentSourceNormalizing(sourcesRef.current, sourceKey)) {
        createdUrls.forEach(revoke)
        return
      }

      replaceUnits([...unitsRef.current, ...materialized])
      replaceSources(sourcesRef.current.map((source) => source.key === sourceKey
        ? { ...source, sourceId: materialized[0]?.sourceId, status: 'ready', unitIds: materialized.map(({ id }) => id) }
        : source))
      sourceFilesRef.current.delete(sourceKey)
    } catch (error) {
      if (!mountedRef.current || !isCurrentSourceNormalizing(sourcesRef.current, sourceKey)) return
      const failure = toSourceFailure(error)
      replaceSources(sourcesRef.current.map((source) => source.key === sourceKey
        ? { ...source, status: 'failed', unitIds: [], ...failure }
        : source))
    }
  }, [replaceSources, replaceUnits, revoke])

  const enqueue = useCallback((sourceKey: string, file: File) => {
    pendingCountRef.current += 1
    if (mountedRef.current) setIsNormalizing(true)
    const queued = queueRef.current
      .then(() => processSource(sourceKey, file))
      .catch(() => undefined)
      .finally(finishPending)
    queueRef.current = queued
    return queued
  }, [finishPending, processSource])

  const addFiles = useCallback((files: readonly File[]) => {
    const operations: Promise<void>[] = []
    for (const file of files) {
      const sourceKey = `source-${++nextSourceKeyRef.current}`
      sourceFilesRef.current.set(sourceKey, file)
      replaceSources([...sourcesRef.current, {
        key: sourceKey,
        fileName: sanitizeFileName(file.name),
        status: 'normalizing',
        unitIds: [],
      }])
      operations.push(enqueue(sourceKey, file))
    }
    return Promise.all(operations).then(() => undefined)
  }, [enqueue, replaceSources])

  const retrySource = useCallback((sourceId: string) => {
    const source = sourcesRef.current.find((candidate) => candidate.key === sourceId)
    const file = sourceFilesRef.current.get(sourceId)
    if (!source || source.status !== 'failed' || !file) return queueRef.current
    replaceSources(sourcesRef.current.map((candidate) => candidate.key === sourceId
      ? { key: sourceId, fileName: candidate.fileName, status: 'normalizing', unitIds: [] }
      : candidate))
    return enqueue(sourceId, file)
  }, [enqueue, replaceSources])

  const removeUnit = useCallback((unitId: string) => {
    const removed = unitsRef.current.find((unit) => unit.id === unitId)
    if (!removed) return
    if (removed.kind === 'image') revoke(removed.previewUrl)
    replaceUnits(unitsRef.current.filter((unit) => unit.id !== unitId))
    const nextSources = sourcesRef.current
      .map((source) => source.sourceId === removed.sourceId
        ? { ...source, unitIds: source.unitIds.filter((id) => id !== unitId) }
        : source)
      .filter((source) => source.status !== 'ready' || source.unitIds.length > 0)
    replaceSources(nextSources)
  }, [replaceSources, replaceUnits, revoke])

  const removeSource = useCallback((sourceId: string) => {
    const source = sourcesRef.current.find((candidate) => candidate.key === sourceId || candidate.sourceId === sourceId)
    if (!source) return
    const removedUnits = source.sourceId
      ? unitsRef.current.filter((unit) => unit.sourceId === source.sourceId)
      : []
    for (const unit of removedUnits) {
      if (unit.kind === 'image') revoke(unit.previewUrl)
    }
    replaceUnits(unitsRef.current.filter((unit) => unit.sourceId !== source.sourceId))
    replaceSources(sourcesRef.current.filter((candidate) => candidate.key !== source.key))
    sourceFilesRef.current.delete(source.key)
  }, [replaceSources, replaceUnits, revoke])

  const moveUnit = useCallback((unitId: string, direction: -1 | 1) => {
    const index = unitsRef.current.findIndex((unit) => unit.id === unitId)
    const destination = index + direction
    if (index < 0 || destination < 0 || destination >= unitsRef.current.length) return
    const next = [...unitsRef.current]
    const current = next[index]
    const target = next[destination]
    if (!current || !target) return
    next[index] = target
    next[destination] = current
    replaceUnits(next)
  }, [replaceUnits])

  const waitUntilIdle = useCallback(() => queueRef.current, [])

  return {
    units,
    sources,
    isNormalizing,
    addFiles,
    retrySource,
    removeUnit,
    removeSource,
    moveUnit,
    waitUntilIdle,
  }
}

function isCurrentSourceNormalizing(sources: readonly MaterialSourceState[], sourceKey: string) {
  return sources.some((source) => source.key === sourceKey && source.status === 'normalizing')
}

function toSourceFailure(error: unknown): Pick<MaterialSourceState, 'errorCode' | 'errorMessage'> {
  if (error instanceof MaterialNormalizationError) {
    return { errorCode: error.code, errorMessage: error.message }
  }
  return UNKNOWN_FAILURE
}

const UNSAFE_FILE_NAME_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

function sanitizeFileName(fileName: string) {
  const printable = Array.from(fileName)
    .filter((character) => !UNSAFE_FILE_NAME_CHARACTER.test(character))
    .join('')
  return printable.replaceAll('/', '_').replaceAll('\\', '_').trim().slice(0, 255) || '材料文件'
}

function defaultId() {
  return `task-material-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}
