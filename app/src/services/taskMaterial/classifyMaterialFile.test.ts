import { describe, expect, it } from 'vitest'
import { classifyMaterialFile } from './classifyMaterialFile'

function file(name: string, type: string) {
  return new File(['content'], name, { type })
}

describe('classifyMaterialFile', () => {
  it.each([
    ['photo.jpg', 'image/jpeg'],
    ['scan.png', 'image/png'],
    ['prompt.webp', 'image/webp'],
  ])('classifies supported image MIME type %s', (name, type) => {
    expect(classifyMaterialFile(file(name, type))).toBe('image')
  })

  it.each([
    ['paper.PDF', '', 'pdf'],
    ['paper.bin', 'application/pdf', 'pdf'],
    ['prompt.DOCX', '', 'docx'],
    ['prompt.bin', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ] as const)('classifies supported document %s from its MIME type or extension', (name, type, expected) => {
    expect(classifyMaterialFile(file(name, type))).toBe(expected)
  })

  it.each([
    ['legacy.doc', 'application/msword'],
    ['legacy.DOC', ''],
  ])('classifies legacy Word file %s for its dedicated rejection', (name, type) => {
    expect(classifyMaterialFile(file(name, type))).toBe('legacy_doc')
  })

  it.each([
    ['photo.heic', 'image/heic'],
    ['notes.txt', 'text/plain'],
    ['archive.zip', 'application/zip'],
  ])('classifies unsupported file %s deterministically', (name, type) => {
    expect(classifyMaterialFile(file(name, type))).toBe('unsupported')
  })
})
