import { act, renderHook } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MaterialNormalizationError,
  type MaterialUnitDraft,
} from '../services/taskMaterial/types'
import { useTaskMaterials } from './useTaskMaterials'

function file(name: string, type = 'image/png') {
  return new File(['material'], name, { type })
}

function imageDraft(source: File, sourceKind: 'image' | 'pdf' = 'image', pageNumber?: number): MaterialUnitDraft {
  return {
    kind: 'image',
    sourceKind,
    displayName: pageNumber ? `${source.name} · 第 ${pageNumber} 页` : source.name,
    file: source,
    mimeType: sourceKind === 'pdf' ? 'image/png' : source.type as 'image/png',
    ...(pageNumber ? { pageNumber } : {}),
  }
}

function textDraft(displayName: string): MaterialUnitDraft {
  return {
    kind: 'text',
    sourceKind: 'docx',
    displayName,
    text: 'Extracted body text.',
    warnings: ['docx_body_only'],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function controllerOptions(normalizeFile: (source: File, options: { remainingUnits: number }) => Promise<MaterialUnitDraft[]>) {
  let nextId = 0
  let nextUrl = 0
  return {
    normalizeFile,
    createId: vi.fn(() => `id-${++nextId}`),
    createObjectURL: vi.fn((_file: File) => `blob:preview-${++nextUrl}`),
    revokeObjectURL: vi.fn(),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTaskMaterials', () => {
  it('updates public state when mounted under React StrictMode effect replay', async () => {
    const options = controllerOptions(async (source) => [imageDraft(source)])
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useTaskMaterials(options), { wrapper, reactStrictMode: true })

    await act(async () => {
      await result.current.addFiles([file('strict.png')])
    })

    expect(result.current.sources).toHaveLength(1)
    expect(result.current.sources[0]).toMatchObject({ fileName: 'strict.png', status: 'ready' })
    expect(result.current.units).toHaveLength(1)
    expect(result.current.isNormalizing).toBe(false)
  })

  it('keeps source selection order across batches by normalizing one source at a time', async () => {
    const pdf = file('paper.pdf', 'application/pdf')
    const firstPdfPage = file('paper-1.png')
    const secondPdfPage = file('paper-2.png')
    const pdfResult = deferred<MaterialUnitDraft[]>()
    const callOrder: string[] = []
    const normalizeFile = vi.fn(async (source: File) => {
      callOrder.push(source.name)
      if (source === pdf) return pdfResult.promise
      if (source.name.endsWith('.docx')) return [textDraft(source.name)]
      return [imageDraft(source)]
    })
    const options = controllerOptions(normalizeFile)
    const { result } = renderHook(() => useTaskMaterials(options))

    let firstBatch!: Promise<void>
    let secondBatch!: Promise<void>
    act(() => {
      firstBatch = result.current.addFiles([file('first.png'), pdf])
      secondBatch = result.current.addFiles([
        file('requirements.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ])
    })

    expect(callOrder).toEqual([])
    await act(async () => { await Promise.resolve() })
    expect(callOrder).toEqual(['first.png', 'paper.pdf'])

    await act(async () => {
      pdfResult.resolve([
        imageDraft(firstPdfPage, 'pdf', 1),
        imageDraft(secondPdfPage, 'pdf', 2),
      ])
      await Promise.all([firstBatch, secondBatch])
    })

    expect(callOrder).toEqual(['first.png', 'paper.pdf', 'requirements.docx'])
    expect(result.current.units.map(({ sourceKind }) => sourceKind)).toEqual([
      'image', 'pdf', 'pdf', 'docx',
    ])
    expect(result.current.sources.map(({ status }) => status)).toEqual([
      'ready', 'ready', 'ready',
    ])
    expect(options.createObjectURL).toHaveBeenCalledTimes(3)
  })

  it('applies the ten-unit limit atomically and lets later sources use remaining capacity', async () => {
    const normalizeFile = vi.fn(async (source: File, { remainingUnits }: { remainingUnits: number }) => {
      if (source.name === 'eight.pdf') {
        return Array.from({ length: 8 }, (_, index) => imageDraft(file(`eight-${index + 1}.png`), 'pdf', index + 1))
      }
      if (source.name === 'overflow.pdf') {
        return Array.from({ length: 3 }, (_, index) => imageDraft(file(`overflow-${index + 1}.png`), 'pdf', index + 1))
      }
      if (remainingUnits < 1) throw new MaterialNormalizationError('unit_limit_exceeded')
      return [imageDraft(source)]
    })
    const options = controllerOptions(normalizeFile)
    const { result } = renderHook(() => useTaskMaterials(options))

    await act(async () => {
      await result.current.addFiles([
        file('eight.pdf', 'application/pdf'),
        file('overflow.pdf', 'application/pdf'),
        file('ninth.png'),
        file('tenth.png'),
        file('eleventh.png'),
      ])
    })

    expect(result.current.units).toHaveLength(10)
    expect(result.current.units.some(({ displayName }) => displayName.startsWith('overflow'))).toBe(false)
    expect(result.current.sources.map(({ status }) => status)).toEqual([
      'ready', 'failed', 'ready', 'ready', 'failed',
    ])
    expect(options.createObjectURL).toHaveBeenCalledTimes(10)
    expect(options.createObjectURL).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'overflow-1.png' }))
  })

  it('isolates a failed source and exposes only a safe name plus stable error details', async () => {
    const normalizeFile = vi.fn(async (source: File) => {
      if (source.name.includes('unsafe')) throw new MaterialNormalizationError('docx_parse_failed')
      return [imageDraft(source)]
    })
    const options = controllerOptions(normalizeFile)
    const { result } = renderHook(() => useTaskMaterials(options))

    await act(async () => {
      await result.current.addFiles([
        file('kept.png'),
        file('../unsafe\\name\u0000.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        file('later.png'),
      ])
    })

    expect(result.current.units.map(({ displayName }) => displayName)).toEqual(['kept.png', 'later.png'])
    const failed = result.current.sources.find(({ status }) => status === 'failed')
    expect(failed).toMatchObject({
      fileName: '.._unsafe_name.docx',
      status: 'failed',
      errorCode: 'docx_parse_failed',
      errorMessage: 'DOCX 正文提取失败。',
    })
    expect(failed).not.toHaveProperty('file')
    expect(failed).not.toHaveProperty('text')
    expect(failed).not.toHaveProperty('sourceId')
    expect(JSON.stringify(failed)).not.toContain('material')
    expect(options.createObjectURL).toHaveBeenCalledTimes(2)
    expect(options.createId).toHaveBeenCalledTimes(4)
  })

  it('gives repeated selections of the same File independent identities and previews', async () => {
    const repeated = file('repeat.png')
    const options = controllerOptions(async (source) => [imageDraft(source)])
    const { result } = renderHook(() => useTaskMaterials(options))

    await act(async () => {
      await result.current.addFiles([repeated, repeated])
    })

    expect(result.current.units).toHaveLength(2)
    expect(result.current.units[0]?.id).not.toBe(result.current.units[1]?.id)
    expect(result.current.units[0]?.sourceId).not.toBe(result.current.units[1]?.sourceId)
    expect(result.current.units[0]).toMatchObject({ previewUrl: 'blob:preview-1' })
    expect(result.current.units[1]).toMatchObject({ previewUrl: 'blob:preview-2' })
  })

  it('retries one failed source without disturbing ready units', async () => {
    let failedOnce = false
    const options = controllerOptions(async (source) => {
      if (source.name === 'retry.pdf' && !failedOnce) {
        failedOnce = true
        throw new MaterialNormalizationError('pdf_render_failed')
      }
      return [imageDraft(source, source.name.endsWith('.pdf') ? 'pdf' : 'image', 1)]
    })
    const { result } = renderHook(() => useTaskMaterials(options))

    await act(async () => {
      await result.current.addFiles([file('kept.png'), file('retry.pdf', 'application/pdf')])
    })
    const failedSourceKey = result.current.sources.find(({ status }) => status === 'failed')?.key
    expect(failedSourceKey).toBeDefined()

    await act(async () => {
      await result.current.retrySource(failedSourceKey!)
    })

    expect(result.current.sources.map(({ status }) => status)).toEqual(['ready', 'ready'])
    expect(result.current.units.map(({ displayName }) => displayName)).toEqual([
      'kept.png · 第 1 页', 'retry.pdf · 第 1 页',
    ])
  })

  it('moves and removes units or whole sources while revoking each live URL exactly once', async () => {
    const options = controllerOptions(async (source) => {
      if (source.name === 'two-pages.pdf') {
        return [
          imageDraft(file('page-1.png'), 'pdf', 1),
          imageDraft(file('page-2.png'), 'pdf', 2),
        ]
      }
      return [imageDraft(source)]
    })
    const { result, unmount } = renderHook(() => useTaskMaterials(options))

    await act(async () => {
      await result.current.addFiles([file('two-pages.pdf', 'application/pdf'), file('photo.png')])
    })
    const [first, second, photo] = result.current.units
    expect(first?.kind).toBe('image')
    expect(second?.kind).toBe('image')
    expect(photo?.kind).toBe('image')
    if (first?.kind !== 'image' || second?.kind !== 'image' || photo?.kind !== 'image') {
      throw new Error('Expected image material units')
    }
    act(() => result.current.moveUnit(first!.id, 1))
    expect(result.current.units.map(({ id }) => id)).toEqual([second!.id, first!.id, photo!.id])

    act(() => result.current.removeUnit(first!.id))
    expect(options.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(options.revokeObjectURL).toHaveBeenLastCalledWith(first!.previewUrl)

    const pdfSourceKey = result.current.sources.find(({ sourceId }) => sourceId === second!.sourceId)?.key
    expect(pdfSourceKey).toBeDefined()
    act(() => result.current.removeSource(pdfSourceKey!))
    act(() => result.current.removeSource(pdfSourceKey!))
    expect(options.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(options.revokeObjectURL).toHaveBeenLastCalledWith(second!.previewUrl)

    unmount()
    expect(options.revokeObjectURL).toHaveBeenCalledTimes(3)
    expect(options.revokeObjectURL).toHaveBeenLastCalledWith(photo!.previewUrl)
  })

  it('never creates URLs for text, failed, overflow, or work finishing after unmount', async () => {
    const late = deferred<MaterialUnitDraft[]>()
    const options = controllerOptions(async (source) => {
      if (source.name === 'text.docx') return [textDraft(source.name)]
      if (source.name === 'failed.png') throw new MaterialNormalizationError('image_too_large')
      if (source.name === 'overflow.pdf') return [
        imageDraft(file('one.png'), 'pdf', 1),
        imageDraft(file('two.png'), 'pdf', 2),
      ]
      if (source.name === 'late.png') return late.promise
      return [imageDraft(source)]
    })
    const { result, unmount } = renderHook(() => useTaskMaterials(options))

    await act(async () => {
      await result.current.addFiles([
        file('text.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        file('failed.png'),
      ])
    })
    await act(async () => {
      await result.current.addFiles(Array.from({ length: 8 }, (_, index) => file(`ready-${index}.png`)))
    })
    await act(async () => {
      await result.current.addFiles([file('overflow.pdf', 'application/pdf')])
    })
    expect(options.createObjectURL.mock.calls.map(([createdFile]) => createdFile.name)).toEqual(
      Array.from({ length: 8 }, (_, index) => `ready-${index}.png`),
    )

    let pending!: Promise<void>
    act(() => { pending = result.current.addFiles([file('late.png')]) })
    await act(async () => { await Promise.resolve() })
    unmount()
    late.resolve([imageDraft(file('late-result.png'))])
    await pending

    expect(options.createObjectURL).toHaveBeenCalledTimes(8)
    expect(options.revokeObjectURL).toHaveBeenCalledTimes(8)
  })

  it('waitUntilIdle waits for every normalization already queued when it is called', async () => {
    const first = deferred<MaterialUnitDraft[]>()
    const second = deferred<MaterialUnitDraft[]>()
    const options = controllerOptions(async (source) => source.name === 'first.pdf' ? first.promise : second.promise)
    const { result } = renderHook(() => useTaskMaterials(options))
    let addPromise!: Promise<void>
    let barrier!: Promise<void>
    let barrierResolved = false

    act(() => {
      addPromise = result.current.addFiles([
        file('first.pdf', 'application/pdf'),
        file('second.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ])
      barrier = result.current.waitUntilIdle().then(() => { barrierResolved = true })
    })
    await act(async () => { await Promise.resolve() })
    expect(result.current.isNormalizing).toBe(true)

    await act(async () => {
      first.resolve([imageDraft(file('first-page.png'), 'pdf', 1)])
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(barrierResolved).toBe(false)

    await act(async () => {
      second.resolve([textDraft('second.docx')])
      await Promise.all([addPromise, barrier])
    })
    expect(barrierResolved).toBe(true)
    expect(result.current.isNormalizing).toBe(false)
    expect(result.current.units).toHaveLength(2)
  })

  it('does not start normalization for a queued source removed behind active work', async () => {
    const active = deferred<MaterialUnitDraft[]>()
    const normalizeFile = vi.fn(async (source: File) => {
      if (source.name === 'active.pdf') return active.promise
      return [imageDraft(source)]
    })
    const options = controllerOptions(normalizeFile)
    const { result } = renderHook(() => useTaskMaterials(options))
    let addPromise!: Promise<void>

    act(() => {
      addPromise = result.current.addFiles([
        file('active.pdf', 'application/pdf'),
        file('removed.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ])
    })
    await act(async () => { await Promise.resolve() })
    const queuedSourceKey = result.current.sources[1]?.key
    expect(queuedSourceKey).toBeDefined()
    act(() => result.current.removeSource(queuedSourceKey!))

    await act(async () => {
      active.resolve([imageDraft(file('active-page.png'), 'pdf', 1)])
      await addPromise
    })

    expect(normalizeFile.mock.calls.map(([source]) => source.name)).toEqual(['active.pdf'])
    expect(result.current.sources.map(({ fileName }) => fileName)).toEqual(['active.pdf'])
  })

  it('does not start any remaining queued normalization after unmount', async () => {
    const active = deferred<MaterialUnitDraft[]>()
    const normalizeFile = vi.fn(async (source: File) => {
      if (source.name === 'active.pdf') return active.promise
      return [imageDraft(source)]
    })
    const options = controllerOptions(normalizeFile)
    const { result, unmount } = renderHook(() => useTaskMaterials(options))
    let addPromise!: Promise<void>

    act(() => {
      addPromise = result.current.addFiles([
        file('active.pdf', 'application/pdf'),
        file('queued.pdf', 'application/pdf'),
        file('queued.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ])
    })
    await act(async () => { await Promise.resolve() })
    unmount()
    active.resolve([imageDraft(file('active-page.png'), 'pdf', 1)])
    await addPromise

    expect(normalizeFile.mock.calls.map(([source]) => source.name)).toEqual(['active.pdf'])
    expect(options.createObjectURL).not.toHaveBeenCalled()
  })

  it('uses sourceKey as the only source control handle and never guesses from business sourceId', async () => {
    const normalizeFile = vi.fn(async (source: File) => {
      if (source.name === 'failed.pdf') throw new MaterialNormalizationError('pdf_render_failed')
      return [imageDraft(source)]
    })
    const options = controllerOptions(normalizeFile)
    options.createId.mockImplementationOnce(() => 'source-2')
    const { result } = renderHook(() => useTaskMaterials(options))

    await act(async () => {
      await result.current.addFiles([
        file('ready.png'),
        file('failed.pdf', 'application/pdf'),
      ])
    })
    const readySource = result.current.sources.find(({ status }) => status === 'ready')
    expect(readySource).toMatchObject({ key: 'source-1', sourceId: 'source-2' })

    act(() => result.current.removeSource('source-2'))
    expect(result.current.sources.map(({ fileName }) => fileName)).toEqual(['ready.png'])
    expect(result.current.units).toHaveLength(1)

    act(() => result.current.removeSource('source-1'))
    expect(result.current.sources).toHaveLength(0)
    expect(result.current.units).toHaveLength(0)
  })
})
