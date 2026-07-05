import { describe, expect, it } from 'vitest'
import { buildOcrDraftsFromResults, normalizeOcrResult } from './normalizeOcrResult'

describe('frontend OCR normalization', () => {
  it('keeps Gateway result text and exposes empty-text warnings', () => {
    const result = normalizeOcrResult({
      essayGroupId: 'group-1',
      text: '',
      pages: [{ pageId: 'page-1', text: '', warnings: ['empty_text'] }],
      provider: 'remote',
      status: 'success',
    })

    expect(result.text).toBe('')
    expect(result.warnings).toContain('empty_text')
  })

  it('builds editable drafts in visible group order', () => {
    const drafts = buildOcrDraftsFromResults(
      [
        { essayGroupId: 'group-2', text: 'Second visible draft', pages: [], provider: 'remote', status: 'success' },
        { essayGroupId: 'group-1', text: 'First visible draft', pages: [], provider: 'remote', status: 'success' },
      ],
      ['group-1', 'group-2'],
    )

    expect(drafts).toEqual(['First visible draft', 'Second visible draft'])
  })
})
