import { describe, expect, it, vi } from 'vitest'
import { appendTaskMaterials, createTaskMaterialFormData } from './materialFormData'

function imageUnit(id: string, name: string, type: 'image/jpeg' | 'image/png' | 'image/webp') {
  return { id, kind: 'image' as const, file: new File([`bytes-${id}`], name, { type }) }
}

function textUnit(id: string) {
  return { id, kind: 'text' as const, displayName: 'prompt.docx', text: 'Extracted body' }
}

describe('task material FormData', () => {
  it('serializes interleaved ready units with exact independent image and text index coverage', () => {
    const materials = [
      imageUnit('u-1', 'private-first.png', 'image/png'),
      textUnit('u-2'),
      imageUnit('u-3', 'private-second.jpg', 'image/jpeg'),
    ] as const

    const formData = createTaskMaterialFormData({
      requestId: 'req-1', fullScore: 15, writingRequirement: 'Write an email.', materials,
    })

    expect(formData.get('requestId')).toBe('req-1')
    expect(formData.get('fullScore')).toBe('15')
    expect(formData.get('writingRequirement')).toBe('Write an email.')
    expect(JSON.parse(String(formData.get('materialManifest')))).toEqual([
      { id: 'u-1', kind: 'image', imageIndex: 0 },
      { id: 'u-2', kind: 'text', textIndex: 0 },
      { id: 'u-3', kind: 'image', imageIndex: 1 },
    ])
    expect(JSON.parse(String(formData.get('textMaterials')))).toEqual([
      { displayName: 'prompt.docx', text: 'Extracted body' },
    ])
    const images = formData.getAll('images') as File[]
    expect(images.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'material-image-1.png', type: 'image/png' },
      { name: 'material-image-2.jpeg', type: 'image/jpeg' },
    ])
  })

  it('writes only shared material fields and never serializes local-only metadata or original filenames', () => {
    const formData = new FormData()
    const material = {
      ...imageUnit('image-1', 'student-name-and-local-path.webp', 'image/webp'),
      sourceId: 'source-private', previewUrl: 'blob:private-preview',
      displayName: 'teacher-private-name.webp', pageNumber: 7,
    }
    const snapshot = { ...material }

    appendTaskMaterials(formData, [material])

    expect([...formData.keys()]).toEqual(['materialManifest', 'images', 'textMaterials'])
    expect(String(formData.get('materialManifest'))).toBe('[{"id":"image-1","kind":"image","imageIndex":0}]')
    expect(String(formData.get('textMaterials'))).toBe('[]')
    expect((formData.get('images') as File).name).toBe('material-image-1.webp')
    expect(JSON.stringify([...formData.entries()])).not.toMatch(/student-name|source-private|private-preview|teacher-private|pageNumber/)
    expect(material).toEqual(snapshot)
  })

  it('preserves explicit empty writingRequirement wire semantics without mutating inputs', () => {
    const request = {
      requestId: 'req-empty', fullScore: 20, writingRequirement: '', materials: [textUnit('text-1')],
    } as const
    const before = JSON.stringify(request)

    const formData = createTaskMaterialFormData(request)

    expect(formData.get('writingRequirement')).toBe('')
    expect(JSON.stringify(request)).toBe(before)
  })

  it('throws only for an impossible non-ready material variant', () => {
    const impossible = [{ id: 'pending-1', kind: 'pending' }] as never
    expect(() => appendTaskMaterials(new FormData(), impossible)).toThrow('Unsupported ready task material unit')
  })

  it.each([
    ['GIF', 'image/gif'],
    ['empty MIME', ''],
  ])('rejects %s before writing any wire field and does not mutate the input', (_label, type) => {
    const file = new File(['private-bytes'], 'student-private-file', { type })
    const materials = [
      textUnit('text-before-invalid'),
      { id: 'invalid-image', kind: 'image' as const, file },
    ]
    const formData = new FormData()
    formData.append('sentinel', 'keep')
    const before = { name: file.name, size: file.size, type: file.type, materials: [...materials] }

    expect(() => appendTaskMaterials(formData, materials)).toThrow('Unsupported ready task material image MIME type.')
    expect([...formData.entries()]).toEqual([['sentinel', 'keep']])
    expect({ name: file.name, size: file.size, type: file.type, materials }).toEqual(before)
    expect(() => createTaskMaterialFormData({
      requestId: 'invalid-mime', fullScore: 15, writingRequirement: 'Write.', materials,
    })).toThrow('Unsupported ready task material image MIME type.')
  })

  it('rejects an unsupported MIME before constructing FormData', () => {
    const OriginalFormData = globalThis.FormData
    const formDataConstructor = vi.fn(function FakeFormData() {
      return new OriginalFormData()
    })
    globalThis.FormData = formDataConstructor as unknown as typeof FormData

    try {
      expect(() => createTaskMaterialFormData({
        requestId: 'invalid-before-form-data',
        fullScore: 15,
        writingRequirement: 'Write.',
        materials: [{
          id: 'invalid-image', kind: 'image',
          file: new File(['private'], 'student-private', { type: 'image/gif' }),
        }],
      })).toThrow('Unsupported ready task material image MIME type.')
      expect(formDataConstructor).not.toHaveBeenCalled()
    } finally {
      globalThis.FormData = OriginalFormData
    }
  })
})
