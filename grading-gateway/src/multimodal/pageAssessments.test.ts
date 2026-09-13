import { describe, expect, it } from 'vitest'
import { normalizeMultimodalResult } from './normalizeMultimodalResult.js'

const transcript = 'Dear friend,\nI enjoy reading in the library.'
const dimensions = [
  { id: 'content', name: 'Content', weight: 40, description: 'Answer the task.', deductionFocus: [], sourceEvidence: [] },
  { id: 'language', name: 'Language', weight: 55, description: 'Use clear English.', deductionFocus: [], sourceEvidence: [] },
  { id: 'legibility', name: 'Legibility', weight: 5, description: 'Important unresolved handwriting only.', deductionFocus: [], sourceEvidence: [] },
]
const task = {
  taskId: 'synthetic-page-review', fullScore: 15, materialSummary: 'Write to a friend.',
  writingRequirements: ['Write an English letter.'], constraints: [],
  rubric: { taskName: 'Synthetic', materialSummary: 'Write to a friend.', writingRequirements: ['Write an English letter.'], constraints: [], dimensions, reviewWarnings: [] },
}
const context = { requestId: 'page-review-request', essayId: 'page-review-essay', task, provider: 'remote' as const, pageCount: 1, createdAt: '2026-09-06T00:00:00.000Z' }
function payload() {
  return {
    transcript, printedTextExcluded: true, recognitionWarnings: [], reportedTotalScore: 15,
    dimensionScores: [
      { dimensionId: 'content', score: 6, reason: 'The task is complete.', evidence: transcript, relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'The language is clear.', evidence: transcript, relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'The writing is readable.', evidence: transcript, relatedIssueKeys: [] },
    ],
    issues: [], sentenceRevisions: [], expressionUpgrades: [], legibilityIssues: [],
    fullTextRevision: { sentencePairs: [], logicNotes: [], logicIssues: [] }, overallComment: 'A clear letter.',
    pageAssessments: [{ pageNumber: 1, bodyStatus: 'complete', excludedAnnotations: [] as string[] }],
  }
}

describe('page-level image quality survives final result projection', () => {
  it('turns clipped body assessment into a visible warning without inventing a handwriting penalty', () => {
    const input = payload()
    input.pageAssessments[0]!.bodyStatus = 'clipped'
    const result = normalizeMultimodalResult(input, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.recognitionWarnings).toContain('第 1 页作文正文在图片边缘被截断，请补拍完整页面；缺失内容不能作为可靠识别结果。')
    expect(result.result.status).toBe('partial')
    expect(result.result.legibilityIssues).toEqual([])
    expect(result.result.totalScore).toBe(15)
  })

  it('flags an excluded heading still present in the transcript instead of silently accepting contradictory boundaries', () => {
    const input = payload()
    input.transcript = `应用文\n${transcript}`
    input.pageAssessments[0]!.excludedAnnotations = ['应用文']
    const result = normalizeMultimodalResult(input, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.recognitionWarnings).toContain('第 1 页标记为非正文的内容仍出现在识别正文中，请核对正文边界。')
    expect(result.result.status).toBe('partial')
  })

  it('preserves clipped-page warnings even when a resolved reading matches the page number', () => {
    const input = { ...payload(), legibilityIssues: [{
      issueKey: 'legibility-resolved', transcriptText: 'I', possibleReadings: ['I', '1'],
      pageNumber: 1, regionDescription: 'Synthetic line', explanation: 'The visible letter is correct.',
      defaultOutcome: 'count_as_legibility_error', resolution: 'resolved_correct', deductionPoints: 0,
    }] }
    input.pageAssessments[0]!.bodyStatus = 'clipped'
    const result = normalizeMultimodalResult(input, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.recognitionWarnings).toContain('第 1 页作文正文在图片边缘被截断，请补拍完整页面；缺失内容不能作为可靠识别结果。')
    expect(result.result.status).toBe('partial')
  })

  it.each([
    ['image_clipped', 'The edge after library is clipped.'],
    ['printed_boundary', 'The heading after library may not belong to the essay body; please check the boundary.'],
  ])('preserves upstream %s warnings even when they quote a resolved correct reading', (scope, message) => {
    const input = { ...payload(), recognitionWarnings: [{ scope, message }], legibilityIssues: [{
      issueKey: 'legibility-resolved', transcriptText: 'library', possibleReadings: ['library', 'librany'],
      pageNumber: 1, regionDescription: 'Synthetic line', explanation: 'The visible word is correct.',
      defaultOutcome: 'count_as_legibility_error', resolution: 'resolved_correct', deductionPoints: 0,
    }] }
    const result = normalizeMultimodalResult(input, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.recognitionWarnings).toContain(message)
    expect(result.result.status).toBe('partial')
  })

  it('retains genuine essay titles and paragraphs when no non-body boundary was identified', () => {
    const input = payload()
    input.transcript = `A Day in the Library\n${transcript}`
    const result = normalizeMultimodalResult(input, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.transcript).toBe(input.transcript)
    expect(result.result.recognitionWarnings).toEqual([])
    expect(result.result.status).toBe('success')
  })

  it.each([
    ['missing page', []],
    ['duplicate page', [{ pageNumber: 1, bodyStatus: 'complete', excludedAnnotations: [] }, { pageNumber: 1, bodyStatus: 'complete', excludedAnnotations: [] }]],
    ['out of range', [{ pageNumber: 2, bodyStatus: 'complete', excludedAnnotations: [] }]],
    ['invalid status', [{ pageNumber: 1, bodyStatus: 'invented', excludedAnnotations: [] }]],
  ])('surfaces incomplete image assessment: %s', (_name, assessments) => {
    const input = { ...payload(), pageAssessments: assessments }
    const result = normalizeMultimodalResult(input, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.recognitionWarnings).toContain('图片完整性检查未覆盖全部作文页，请结合原图核对。')
    expect(result.result.status).toBe('partial')
  })

  it('does not perform image assessment or remove text from a teacher-confirmed regrade', () => {
    const input = payload()
    input.pageAssessments = []
    const result = normalizeMultimodalResult(input, { ...context, pageCount: 0, confirmedTranscript: transcript })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.transcript).toBe(transcript)
    expect(result.result.recognitionWarnings).toEqual([])
    expect(result.result.status).toBe('success')
  })
})
