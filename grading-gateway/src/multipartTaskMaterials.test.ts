import { describe, expect, it } from 'vitest'
import {
  MAX_TASK_MATERIAL_IMAGE_BYTES,
  MAX_TASK_MATERIAL_TEXT_CHARACTERS,
  validateTaskMaterialMultipart,
} from './multipartTaskMaterials.js'

function uploadFile(
  mimetype: string,
  buffer = Buffer.from('synthetic-image'),
): globalThis.Express.Multer.File {
  return {
    fieldname: 'materials',
    originalname: 'synthetic-material',
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
  }
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-1',
    fullScore: '15',
    writingRequirement: 'Write an email.',
    materialManifest: JSON.stringify([
      { id: 'u-1', kind: 'image', imageIndex: 0 },
      { id: 'u-2', kind: 'text', textIndex: 0 },
      { id: 'u-3', kind: 'image', imageIndex: 1 },
    ]),
    textMaterials: JSON.stringify([
      { displayName: 'prompt.docx', text: '正文内容' },
    ]),
    ...overrides,
  }
}

const validFiles = [uploadFile('image/png'), uploadFile('image/jpeg')]

function errorText(result: ReturnType<typeof validateTaskMaterialMultipart>): string {
  return result.ok ? '' : JSON.stringify(result.error)
}

describe('validateTaskMaterialMultipart', () => {
  it('reconstructs interleaved image and text units in manifest order', () => {
    const result = validateTaskMaterialMultipart(validBody(), validFiles, 'required')

    expect(result).toEqual({
      ok: true,
      value: {
        requestId: 'req-1',
        fullScore: 15,
        writingRequirement: 'Write an email.',
        materials: [
          {
            kind: 'image',
            unitId: 'u-1',
            mimeType: 'image/png',
            buffer: Buffer.from('synthetic-image'),
          },
          {
            kind: 'text',
            unitId: 'u-2',
            displayName: 'prompt.docx',
            text: '正文内容',
          },
          {
            kind: 'image',
            unitId: 'u-3',
            mimeType: 'image/jpeg',
            buffer: Buffer.from('synthetic-image'),
          },
        ],
      },
    })
  })

  it('trims identifiers, the teacher requirement, display names and text', () => {
    const result = validateTaskMaterialMultipart({
      requestId: '  req-1  ',
      fullScore: '15',
      writingRequirement: '  Write an email.  ',
      materialManifest: JSON.stringify([
        { id: '  unit-1  ', kind: 'text', textIndex: 0 },
      ]),
      textMaterials: JSON.stringify([
        { displayName: '  prompt.docx  ', text: '  Prompt body.  ' },
      ]),
    }, [], 'required')

    expect(result).toEqual({
      ok: true,
      value: {
        requestId: 'req-1',
        fullScore: 15,
        writingRequirement: 'Write an email.',
        materials: [{
          kind: 'text',
          unitId: 'unit-1',
          displayName: 'prompt.docx',
          text: 'Prompt body.',
        }],
      },
    })
  })

  it.each([
    ['malformed manifest JSON', { materialManifest: '[{' }],
    ['malformed text JSON', { textMaterials: '[{' }],
    ['unknown body field', { privateMaterial: 'PRIVATE-BODY' }],
    ['array request id', { requestId: ['req-1'] }],
    ['array full score', { fullScore: ['15'] }],
    ['array requirement', { writingRequirement: ['Write an email.'] }],
    ['array manifest scalar', { materialManifest: ['[]'] }],
    ['array text scalar', { textMaterials: ['[]'] }],
  ] as const)('rejects %s without exposing submitted content', (_label, overrides) => {
    const result = validateTaskMaterialMultipart(validBody(overrides), validFiles, 'required')

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(errorText(result)).not.toMatch(/PRIVATE-BODY|Write an email|正文内容|prompt\.docx/)
  })

  it.each([
    ['unknown image manifest field', [
      { id: 'u-1', kind: 'image', imageIndex: 0, filename: 'PRIVATE-NAME' },
    ], [], [uploadFile('image/png')]],
    ['wrong index field for image', [
      { id: 'u-1', kind: 'image', imageIndex: 0, textIndex: 0 },
    ], [{ displayName: 'prompt.docx', text: 'PRIVATE-TEXT' }], [uploadFile('image/png')]],
    ['unknown text material field', [
      { id: 'u-1', kind: 'text', textIndex: 0 },
    ], [{ displayName: 'prompt.docx', text: 'PRIVATE-TEXT', localPath: 'PRIVATE-PATH' }], []],
  ] as const)('rejects %s with a redacted diagnostic', (_label, manifest, texts, files) => {
    const result = validateTaskMaterialMultipart(validBody({
      materialManifest: JSON.stringify(manifest),
      textMaterials: JSON.stringify(texts),
    }), files, 'required')

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(errorText(result)).not.toMatch(/PRIVATE-NAME|PRIVATE-TEXT|PRIVATE-PATH|prompt\.docx/)
  })

  it.each([
    ['duplicate unit ids', [
      { id: 'u-1', kind: 'image', imageIndex: 0 },
      { id: 'u-1', kind: 'image', imageIndex: 1 },
    ], [], validFiles],
    ['duplicate image indices', [
      { id: 'u-1', kind: 'image', imageIndex: 0 },
      { id: 'u-2', kind: 'image', imageIndex: 0 },
    ], [], validFiles],
    ['missing image index coverage', [
      { id: 'u-1', kind: 'image', imageIndex: 0 },
    ], [], validFiles],
    ['out-of-range image index', [
      { id: 'u-1', kind: 'image', imageIndex: 2 },
      { id: 'u-2', kind: 'image', imageIndex: 0 },
    ], [], validFiles],
    ['duplicate text indices', [
      { id: 'u-1', kind: 'text', textIndex: 0 },
      { id: 'u-2', kind: 'text', textIndex: 0 },
    ], [
      { displayName: 'one.docx', text: 'One' },
      { displayName: 'two.docx', text: 'Two' },
    ], []],
    ['missing text index coverage', [
      { id: 'u-1', kind: 'text', textIndex: 0 },
    ], [
      { displayName: 'one.docx', text: 'One' },
      { displayName: 'two.docx', text: 'Two' },
    ], []],
    ['out-of-range text index', [
      { id: 'u-1', kind: 'text', textIndex: 1 },
    ], [{ displayName: 'one.docx', text: 'One' }], []],
  ] as const)('rejects %s', (_label, manifest, texts, files) => {
    const result = validateTaskMaterialMultipart(validBody({
      materialManifest: JSON.stringify(manifest),
      textMaterials: JSON.stringify(texts),
    }), files, 'required')

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
  })

  it('rejects zero units and more than ten units', () => {
    const empty = validateTaskMaterialMultipart(validBody({
      materialManifest: '[]',
      textMaterials: '[]',
    }), [], 'required')
    const manifest = Array.from({ length: 11 }, (_, index) => ({
      id: `u-${index}`,
      kind: 'text',
      textIndex: index,
    }))
    const texts = Array.from({ length: 11 }, (_, index) => ({
      displayName: `material-${index}.docx`,
      text: `text-${index}`,
    }))
    const excessive = validateTaskMaterialMultipart(validBody({
      materialManifest: JSON.stringify(manifest),
      textMaterials: JSON.stringify(texts),
    }), [], 'required')

    expect(empty).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(excessive).toMatchObject({ ok: false, error: { code: 'request_too_large' } })
  })

  it.each(['image/gif', 'application/pdf'])('rejects unsupported image type %s', (mimetype) => {
    const result = validateTaskMaterialMultipart(validBody({
      materialManifest: JSON.stringify([{ id: 'u-1', kind: 'image', imageIndex: 0 }]),
      textMaterials: '[]',
    }), [uploadFile(mimetype)], 'required')

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
  })

  it('accepts an 8 MiB image and rejects the next byte without exposing bytes', () => {
    const body = validBody({
      materialManifest: JSON.stringify([{ id: 'u-1', kind: 'image', imageIndex: 0 }]),
      textMaterials: '[]',
    })
    const accepted = validateTaskMaterialMultipart(
      body,
      [uploadFile('image/webp', Buffer.alloc(MAX_TASK_MATERIAL_IMAGE_BYTES))],
      'required',
    )
    const rejected = validateTaskMaterialMultipart(
      body,
      [uploadFile('image/webp', Buffer.alloc(MAX_TASK_MATERIAL_IMAGE_BYTES + 1, 7))],
      'required',
    )

    expect(accepted.ok).toBe(true)
    expect(rejected).toMatchObject({ ok: false, error: { code: 'request_too_large' } })
    expect(errorText(rejected)).not.toContain(Buffer.alloc(8, 7).toString())
  })

  it.each([
    ['blank text', '   ', 'invalid_request'],
    ['30,001-character text', 'x'.repeat(MAX_TASK_MATERIAL_TEXT_CHARACTERS + 1), 'request_too_large'],
    ['blank display name', 'Body', 'invalid_request', '   '],
    ['257-character display name', 'Body', 'invalid_request', 'x'.repeat(257)],
  ] as const)('rejects %s', (_label, text, code, displayName = 'prompt.docx') => {
    const result = validateTaskMaterialMultipart(validBody({
      materialManifest: JSON.stringify([{ id: 'u-1', kind: 'text', textIndex: 0 }]),
      textMaterials: JSON.stringify([{ displayName, text }]),
    }), [], 'required')

    expect(result).toMatchObject({ ok: false, error: { code } })
  })

  it.each([
    ['zero', '0'],
    ['decimal', '15.5'],
    ['above range', '101'],
    ['number instead of multipart scalar', 15],
    ['hexadecimal wire value', '0x10'],
    ['scientific-notation wire value', '1e2'],
  ] as const)('rejects invalid full score: %s', (_label, fullScore) => {
    const result = validateTaskMaterialMultipart(validBody({ fullScore }), validFiles, 'required')
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
  })

  it('requires a nonempty teacher requirement in required mode', () => {
    const missing = validBody()
    delete missing.writingRequirement

    expect(validateTaskMaterialMultipart(missing, validFiles, 'required')).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    })
    expect(validateTaskMaterialMultipart(validBody({ writingRequirement: '   ' }), validFiles, 'required')).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    })
  })

  it('accepts an omitted or blank teacher requirement in optional mode without emitting an empty value', () => {
    const omitted = validBody()
    delete omitted.writingRequirement
    const omittedResult = validateTaskMaterialMultipart(omitted, validFiles, 'optional')
    const blankResult = validateTaskMaterialMultipart(validBody({ writingRequirement: '   ' }), validFiles, 'optional')

    expect(omittedResult.ok).toBe(true)
    expect(blankResult.ok).toBe(true)
    if (omittedResult.ok) expect(omittedResult.value).not.toHaveProperty('writingRequirement')
    if (blankResult.ok) expect(blankResult.value).not.toHaveProperty('writingRequirement')
  })

  it('accepts the inclusive identifier, requirement, display-name and text limits', () => {
    const result = validateTaskMaterialMultipart({
      requestId: 'r'.repeat(128),
      fullScore: '100',
      writingRequirement: 'w'.repeat(10_000),
      materialManifest: JSON.stringify([{
        id: 'u'.repeat(128),
        kind: 'text',
        textIndex: 0,
      }]),
      textMaterials: JSON.stringify([{
        displayName: 'd'.repeat(256),
        text: 't'.repeat(MAX_TASK_MATERIAL_TEXT_CHARACTERS),
      }]),
    }, [], 'required')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.requestId).toHaveLength(128)
      expect(result.value.writingRequirement).toHaveLength(10_000)
      expect(result.value.materials[0]).toMatchObject({
        kind: 'text',
        unitId: 'u'.repeat(128),
        displayName: 'd'.repeat(256),
        text: 't'.repeat(MAX_TASK_MATERIAL_TEXT_CHARACTERS),
      })
    }
  })

  it('rejects identifiers, display names and requirements beyond their stable limits', () => {
    const longRequest = validateTaskMaterialMultipart(validBody({ requestId: 'r'.repeat(129) }), validFiles, 'required')
    const longUnit = validateTaskMaterialMultipart(validBody({
      materialManifest: JSON.stringify([{ id: 'u'.repeat(129), kind: 'image', imageIndex: 0 }]),
      textMaterials: '[]',
    }), [uploadFile('image/png')], 'required')
    const longRequirement = validateTaskMaterialMultipart(
      validBody({ writingRequirement: 'w'.repeat(10_001) }),
      validFiles,
      'required',
    )

    expect(longRequest).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(longUnit).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(longRequirement).toMatchObject({ ok: false, error: { code: 'request_too_large' } })
  })
})
