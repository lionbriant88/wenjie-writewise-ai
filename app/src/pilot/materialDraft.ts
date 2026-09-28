import type {
  TaskDraftInput,
  TaskDto,
  MaterialRef,
} from '../../../shared/pilotContracts'
import type { MaterialUnit } from '../services/taskMaterial/types'
import type { RestoredMaterialUnit } from '../hooks/useTaskMaterials'
import type { CloudWorkspace } from './workspace'

/** One ordered stream for autosave, uploads and AI snapshots. Later edits always follow earlier snapshots. */
export function createMaterialDraftSession(
  workspace: CloudWorkspace,
  key: string,
  existingId?: string,
) {
  let tail: Promise<unknown> = Promise.resolve()
  const identities = new Map<string, string>()
  const uploads = new Map<string, string>()
  let currentId = existingId
  return {
    save(
      value: TaskDraftInput,
      units: readonly MaterialUnit[],
    ): Promise<TaskDto> {
      const snapshot = structuredClone(value),
        selected = [...units]
      const pending = tail
        .catch(() => undefined)
        .then(async () => {
          workspace.controller.signal.throwIfAborted()
          if (!currentId) {
            const created = await workspace.saveDraft(key, {
              ...snapshot,
              materialRefs: [],
            })
            currentId = created.id
          }
          const refs: MaterialRef[] = []
          for (const unit of selected) {
            if (unit.kind === 'text') {
              let id = identities.get(unit.id)
              if (!id) {
                id = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(unit.id)
                  ? unit.id
                  : crypto.randomUUID()
                identities.set(unit.id, id)
              }
              refs.push({
                kind: 'text',
                id,
                displayName: unit.displayName,
                text: unit.text,
                warnings: unit.warnings,
              })
            } else {
              let uploadId = unit.uploadId ?? uploads.get(unit.id)
              if (!uploadId) {
                uploadId = await workspace.uploadPage(
                  currentId,
                  {
                    id: unit.id,
                    label: unit.displayName,
                    pageNumber: refs.length + 1,
                    quality: 'clear',
                    accent: '',
                    sourceFile: unit.file,
                  },
                  'material',
                )
                uploads.set(unit.id, uploadId)
              }
              refs.push({ kind: 'image', uploadId })
            }
          }
          return workspace.saveDraft(
            key,
            { ...snapshot, materialRefs: refs },
            currentId,
          )
        })
      tail = pending
      return pending
    },
  }
}

export async function restoreMaterialUnits(
  workspace: CloudWorkspace,
  task: TaskDto,
  signal: AbortSignal,
): Promise<RestoredMaterialUnit[]> {
  const metadata = task.draft.materialRefs.some((r) => r.kind === 'image')
    ? await workspace.all((cursor) =>
        workspace.client.listUploads(task.id, { cursor }, signal),
      )
    : []
  const units: RestoredMaterialUnit[] = []
  for (const ref of task.draft.materialRefs) {
    signal.throwIfAborted()
    if (ref.kind === 'text')
      units.push({ ...ref, sourceKind: 'docx', sourceId: ref.id })
    else {
      const upload = metadata.find((u) => u.id === ref.uploadId)
      if (!upload) throw Error('原题材料暂时无法读取，请重新加载。')
      const file = await workspace.client.readImage(
        ref.uploadId,
        upload.label,
        signal,
      )
      units.push({
        kind: 'image',
        id: ref.uploadId,
        sourceId: ref.uploadId,
        uploadId: ref.uploadId,
        sourceKind: 'image',
        displayName: upload.label,
        mimeType: upload.mimeType,
        file,
      })
    }
  }
  return units
}
