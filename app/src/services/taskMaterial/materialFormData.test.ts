import { describe, expect, it } from 'vitest'
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
})
