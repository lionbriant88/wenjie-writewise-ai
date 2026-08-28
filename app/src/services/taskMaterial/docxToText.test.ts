import { describe, expect, it, vi } from 'vitest'
import { MAX_DOCX_TEXT_CHARACTERS, MAX_MATERIAL_DOCUMENT_BYTES } from './constants'
import { extractDocxBodyText } from './docxToText'
import { MaterialNormalizationError } from './types'

function docxFile(size: number) {
  const file = new File(['docx'], 'prompt.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
  })
  return file
}

async function expectCode(promise: Promise<unknown>, code: MaterialNormalizationError['code']) {
  await expect(promise).rejects.toMatchObject({ name: 'MaterialNormalizationError', code })
}

describe('extractDocxBodyText', () => {
  it('extracts raw body text, trims only outer whitespace, and preserves internal paragraphs', async () => {
    const extractRawText = vi.fn().mockResolvedValue({
      value: '  Paragraph one.\n\nParagraph two.  ',
      messages: [],
    })

    await expect(extractDocxBodyText(docxFile(128), { extractRawText })).resolves.toEqual({
      text: 'Paragraph one.\n\nParagraph two.',
      warnings: ['docx_body_only'],
    })
  })

  it('accepts a DOCX exactly at the 20 MiB source limit', async () => {
    const extractRawText = vi.fn().mockResolvedValue({ value: 'Prompt text.' })

    await expect(extractDocxBodyText(docxFile(MAX_MATERIAL_DOCUMENT_BYTES), { extractRawText }))
      .resolves.toMatchObject({ text: 'Prompt text.' })
  })

  it('rejects 20 MiB plus one byte before reading or invoking the extractor', async () => {
    const file = docxFile(MAX_MATERIAL_DOCUMENT_BYTES + 1)
    const extractRawText = vi.fn()

    await expectCode(extractDocxBodyText(file, { extractRawText }), 'document_too_large')
    expect(file.arrayBuffer).not.toHaveBeenCalled()
    expect(extractRawText).not.toHaveBeenCalled()
  })

  it('rejects body text that is blank after outer trimming', async () => {
    await expectCode(extractDocxBodyText(docxFile(128), {
      extractRawText: async () => ({ value: ' \n\t ' }),
    }), 'docx_empty')
  })

  it('accepts exactly 30,000 extracted characters', async () => {
    const value = 'a'.repeat(MAX_DOCX_TEXT_CHARACTERS)

    await expect(extractDocxBodyText(docxFile(128), {
      extractRawText: async () => ({ value }),
    })).resolves.toMatchObject({ text: value })
  })

  it('rejects 30,001 extracted characters', async () => {
    await expectCode(extractDocxBodyText(docxFile(128), {
      extractRawText: async () => ({ value: 'a'.repeat(MAX_DOCX_TEXT_CHARACTERS + 1) }),
    }), 'docx_too_long')
  })

  it('accepts and preserves exactly 30,000 non-BMP Unicode code points', async () => {
    const value = '😀'.repeat(MAX_DOCX_TEXT_CHARACTERS)
    expect(value).toHaveLength(60_000)
    expect(Array.from(value)).toHaveLength(MAX_DOCX_TEXT_CHARACTERS)

    const result = await extractDocxBodyText(docxFile(128), {
      extractRawText: async () => ({ value }),
    })

    expect(result.text).toBe(value)
    expect(Array.from(result.text)).toHaveLength(MAX_DOCX_TEXT_CHARACTERS)
  })

  it('rejects 30,001 non-BMP Unicode code points', async () => {
    const value = '😀'.repeat(MAX_DOCX_TEXT_CHARACTERS + 1)

    await expectCode(extractDocxBodyText(docxFile(128), {
      extractRawText: async () => ({ value }),
    }), 'docx_too_long')
  })

  it('maps corrupt extraction to a stable safe error without exposing dependency details', async () => {
    const privateMessage = 'private parser path C:\\secret\\prompt.docx'

    try {
      await extractDocxBodyText(docxFile(128), {
        extractRawText: async () => { throw new Error(privateMessage) },
      })
      throw new Error('expected extraction to reject')
    } catch (error) {
      expect(error).toMatchObject({ name: 'MaterialNormalizationError', code: 'docx_parse_failed' })
      expect(String(error)).not.toContain(privateMessage)
    }
  })

  it('converts arbitrary Mammoth messages to one static warning code', async () => {
    const privateWarning = 'embedded warning with private source detail'

    const result = await extractDocxBodyText(docxFile(128), {
      extractRawText: async () => ({ value: 'Prompt text.', messages: [{ message: privateWarning }] }),
    })

    expect(result).toEqual({
      text: 'Prompt text.',
      warnings: ['docx_body_only', 'docx_parser_warning'],
    })
    expect(JSON.stringify(result)).not.toContain(privateWarning)
  })
})
