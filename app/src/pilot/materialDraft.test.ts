import { expect, it, vi } from 'vitest'
import { createMaterialDraftSession } from './materialDraft'
import type { CloudWorkspace } from './workspace'
import type { TaskDraftInput } from '../../../shared/pilotContracts'
import type { MaterialUnit } from '../services/taskMaterial/types'

it('serializes uploading and edits, preserving image identity and DOCX warnings', async () => {
  const draft: TaskDraftInput = {
    taskName: '',
    fullScore: 15,
    writingRequirement: 'First',
    dimensions: [],
    source: 'teacher',
    materialContext: null,
    materialProcessingStatus: 'none',
    materialRefs: [],
  }
  const units: MaterialUnit[] = [
    {
      kind: 'image',
      id: 'image',
      sourceId: 'source',
      sourceKind: 'image',
      displayName: 'Page',
      file: new File(['x'], 'page.png', { type: 'image/png' }),
      mimeType: 'image/png',
      previewUrl: 'blob:page',
    },
    {
      kind: 'text',
      id: 'doc',
      sourceId: 'source2',
      sourceKind: 'docx',
      displayName: 'Body',
      text: 'Synthetic body',
      warnings: ['docx_body_only'],
    },
  ]
  const saved: TaskDraftInput[] = []
  const workspace = {
    saveDraft: vi.fn(async (_key, value) => {
      saved.push(value)
      return { id: 'task', draft: value }
    }),
    uploadPage: vi.fn(async () => 'upload'),
    controller: new AbortController(),
  } as unknown as CloudWorkspace
  const session = createMaterialDraftSession(workspace, 'editor')
  const first = session.save(draft, units)
  const second = session.save(
    { ...draft, writingRequirement: 'Manual edit' },
    units,
  )
  await Promise.all([first, second])
  expect(saved.at(-1)).toMatchObject({
    writingRequirement: 'Manual edit',
    materialRefs: [
      { kind: 'image', uploadId: 'upload' },
      { kind: 'text', text: 'Synthetic body', warnings: ['docx_body_only'] },
    ],
  })
  expect(workspace.uploadPage).toHaveBeenCalledOnce()
  expect(saved[1].materialRefs).toEqual(saved.at(-1)?.materialRefs)
})
