import { describe, expect, it, vi } from 'vitest'
import { normalizeMultimodalResult } from '../../../../grading-gateway/src/multimodal/normalizeMultimodalResult'
import type { Essay, Task } from '../../types'
import { buildReviewIssueItems } from '../../utils/reviewIssueItems'
import { buildSourceIssueMarkers } from '../../utils/sourceIssueMarkers'
import { adaptAiGradingResult } from './adaptAiGradingResult'
import { buildMultimodalGradingRequest } from './buildMultimodalGradingRequest'
import { projectGradingClientResponse } from './projectGradingClientResponse'
import { createRemoteGradingClient } from './remoteGradingClient'

const task = { taskId: 'task-contract', fullScore: 15, materialSummary: 'Synthetic task.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic task.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [], dimensions: [{ id: 'language', name: 'Language', weight: 95, description: 'Accuracy.', deductionFocus: [], sourceEvidence: [] }, { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] }] } }
const context = { requestId: 'request-contract', essayId: 'essay-contract', task, provider: 'remote' as const, pageCount: 1, createdAt: '2026-08-15T00:00:00.000Z' }

function projectNormalized(
  result: Extract<ReturnType<typeof normalizeMultimodalResult>, { ok: true }>['result'],
  gradingTask: typeof task = task,
) {
  return projectGradingClientResponse(result, {
    httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true,
    inputMode: 'images', pageCount: 1, fullScore: gradingTask.fullScore, task: gradingTask,
  })
}

function fullScorePayload(transcript = 'I wark today.'): Record<string, unknown> {
  return {
    transcript, recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15,
    dimensionScores: [
      { dimensionId: 'language', score: 14.25, reason: 'Accurate.', evidence: transcript, relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: transcript, relatedIssueKeys: [] },
    ],
    issues: [], sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
    legibilityIssues: [], overallComment: 'Clear response.',
  }
}

function uncertainSpellingPayload(transcript = 'I wark today.'): Record<string, unknown> {
  const payload = fullScorePayload(transcript)
  payload.reportedTotalScore = 14
  payload.issues = [{
    issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
    explanation: 'The spelling is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
  }]
  ;(payload.dimensionScores as Array<Record<string, unknown>>)[0] = {
    dimensionId: 'language', score: 13.25, reason: 'The spelling is uncertain.', evidence: 'wark', relatedIssueKeys: ['spelling-wark'],
  }
  return payload
}

describe('Gateway-to-website public grading contract', () => {
  it('keeps an unlinked bounded deduction usable through the website projector', () => {
    const transcript = 'A complete synthetic response with clear grammar.'
    const normalized = normalizeMultimodalResult({
      transcript, recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 12, modelSelfConfidence: 0.72,
      dimensionScores: [
        { dimensionId: 'language', score: 11.25, reason: 'Some language detail needs review.', evidence: 'Invented evidence.', relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: transcript, relatedIssueKeys: [] },
      ],
      issues: [], sentenceRevisions: [], expressionUpgrades: [],
      fullTextRevision: { correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
      legibilityIssues: [], overallComment: 'The response is generally clear.',
    }, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 12, modelSelfConfidence: 0.72,
        dimensionScores: [expect.objectContaining({ dimensionId: 'language', score: 11.25, requiresTeacherReview: true }), expect.any(Object)],
        reviewReasons: expect.arrayContaining(['部分维度评分依据不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return

    expect(projectGradingClientResponse(normalized.result, {
      httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true,
      inputMode: 'images', pageCount: 1, fullScore: 15, task,
    })).toMatchObject({
      status: 'partial', totalScore: 12, modelSelfConfidence: 0.72,
      dimensionScores: [expect.objectContaining({ dimensionId: 'language', requiresTeacherReview: true }), expect.any(Object)],
      reviewReasons: expect.arrayContaining(['部分维度评分依据不完整，建议教师复核。']),
    })
  })

  it('keeps score-only transcript evidence usable when a separate legibility issue exists', () => {
    const transcript = 'A complete response with blur.'
    const normalized = normalizeMultimodalResult({
      transcript, recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 12,
      dimensionScores: [
        { dimensionId: 'language', score: 11.25, reason: 'Some language detail needs review.', evidence: 'Invented evidence.', relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0.25, reason: 'One mark is unclear.', evidence: 'blur', relatedIssueKeys: ['legibility-blur'] },
      ],
      issues: [], sentenceRevisions: [], expressionUpgrades: [],
      fullTextRevision: { correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
      legibilityIssues: [{ issueKey: 'legibility-blur', transcriptText: 'blur', possibleReadings: ['blur', 'blue'], pageNumber: 1, regionDescription: 'final word', explanation: 'Two readings are plausible.', defaultOutcome: 'count_as_legibility_error' }],
      overallComment: 'The response is generally clear.',
    }, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        dimensionScores: [expect.objectContaining({ dimensionId: 'language', evidence: transcript, requiresTeacherReview: true }), expect.any(Object)],
      },
    })
    if (!normalized.ok) return

    expect(projectGradingClientResponse(normalized.result, {
      httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true,
      inputMode: 'images', pageCount: 1, fullScore: 15, task,
    })).toMatchObject({ status: 'partial', totalScore: 12 })
  })

  it('omits legibility diagnostics whose teacher-confirmed rubric weight rounds to a zero maximum', () => {
    const transcript = 'A complete response with blur.'
    const tinyLegibilityTask = {
      ...task,
      rubric: {
        ...task.rubric,
        dimensions: [
          { id: 'language', name: 'Language', weight: 99.99, description: 'Accuracy.', deductionFocus: [], sourceEvidence: [] },
          { id: 'legibility', name: 'Legibility', weight: 0.01, description: 'Readable.', deductionFocus: [], sourceEvidence: [] },
        ],
      },
    }
    const tinyContext = { ...context, task: tinyLegibilityTask }
    const normalized = normalizeMultimodalResult({
      transcript, recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15,
      dimensionScores: [
        { dimensionId: 'language', score: 15, reason: 'Accurate.', evidence: transcript, relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0, reason: 'One mark is unclear.', evidence: 'blur', relatedIssueKeys: ['legibility-blur'] },
      ],
      issues: [], sentenceRevisions: [], expressionUpgrades: [],
      fullTextRevision: { correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
      legibilityIssues: [{ issueKey: 'legibility-blur', transcriptText: 'blur', possibleReadings: ['blur', 'blue'], pageNumber: 1, regionDescription: 'final word', explanation: 'Two readings are plausible.', defaultOutcome: 'count_as_legibility_error' }],
      overallComment: 'The response is generally clear.',
    }, tinyContext)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 15, legibilityIssues: [],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'legibility', score: 0, maxScore: 0 })]),
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return

    expect(projectGradingClientResponse(normalized.result, {
      httpOk: true, requestId: tinyContext.requestId, essayId: tinyContext.essayId, requireMultimodal: true,
      inputMode: 'images', pageCount: 1, fullScore: 15, task: tinyLegibilityTask,
    })).toMatchObject({ status: 'partial', totalScore: 15, legibilityIssues: [] })
  })

  it.each([
    [15, 14.25, 0.75, 14],
    [10, 9.5, 0.5, 9],
    [9, 8.55, 0.45, 8],
  ] as const)('keeps a visible legibility deduction through Gateway and website for fullScore=%i', (fullScore, languageMax, legibilityMax, expectedTotal) => {
    const weightedTask = { ...task, fullScore }
    const weightedContext = { ...context, task: weightedTask }
    const transcript = 'I can come.'
    const payload = fullScorePayload(transcript)
    payload.reportedTotalScore = expectedTotal
    payload.dimensionScores = [
      { dimensionId: 'language', score: languageMax, reason: 'Accurate.', evidence: transcript, relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0, reason: 'One mark is unclear.', evidence: 'can', relatedIssueKeys: ['legibility-can'] },
    ]
    payload.legibilityIssues = [{
      issueKey: 'legibility-can', transcriptText: 'can', possibleReadings: ['can', "can't"], pageNumber: 1,
      regionDescription: 'middle word', explanation: 'Two readings are plausible.', defaultOutcome: 'count_as_legibility_error',
    }]

    const normalized = normalizeMultimodalResult(payload, weightedContext)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        totalScore: expectedTotal,
        legibilityIssues: [expect.objectContaining({ transcriptText: 'can' })],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'legibility', score: 0, maxScore: legibilityMax })]),
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result, weightedTask)).toMatchObject({ totalScore: expectedTotal, legibilityIssues: [expect.any(Object)] })

    const clearPayload = fullScorePayload(transcript)
    clearPayload.reportedTotalScore = fullScore
    clearPayload.dimensionScores = [
      { dimensionId: 'language', score: languageMax, reason: 'Accurate.', evidence: transcript, relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: legibilityMax, reason: 'Legible.', evidence: transcript, relatedIssueKeys: [] },
    ]
    const clear = normalizeMultimodalResult(clearPayload, weightedContext)
    expect(clear).toMatchObject({ ok: true, result: { totalScore: fullScore, legibilityIssues: [] } })
    if (clear.ok) expect(projectNormalized(clear.result, weightedTask)).toMatchObject({ totalScore: fullScore, legibilityIssues: [] })
  })

  it('keeps spelling restoration plus same-range legibility accepted by the website projector', () => {
    const payload = uncertainSpellingPayload()
    payload.reportedTotalScore = 14
    payload.legibilityIssues = [{
      issueKey: 'legibility-wark', transcriptText: 'wark', possibleReadings: ['wark', 'work'], pageNumber: 1,
      regionDescription: 'first word', explanation: 'Two readings are genuinely plausible.', defaultOutcome: 'count_as_legibility_error',
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[1] = {
      dimensionId: 'legibility', score: 0, reason: 'The first word is unclear.', evidence: 'wark', relatedIssueKeys: ['legibility-wark'],
    }

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 14.25, evidence: payload.transcript, requiresTeacherReview: true,
        })]),
        legibilityIssues: [expect.objectContaining({ transcriptText: 'wark' })],
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result)).toMatchObject({
      status: 'partial', totalScore: 14, legibilityIssues: [expect.any(Object)],
      dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', requiresTeacherReview: true })]),
    })
  })

  it('regrounds stale linked evidence before a normalizer success crosses the website projector', () => {
    const transcript = 'I can come.'
    const normalized = normalizeMultimodalResult({
      transcript, recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 14,
      dimensionScores: [
        { dimensionId: 'language', score: 13.25, reason: 'One detail needs review.', evidence: 'can', relatedIssueKeys: ['unmatched-language'] },
        { dimensionId: 'legibility', score: 0.25, reason: 'One mark is unclear.', evidence: 'can', relatedIssueKeys: ['legibility-can'] },
      ],
      issues: [{ issueKey: 'unmatched-language', type: 'grammar', severity: 'low', originalText: 'Invented quote.', suggestion: 'Synthetic correction.', explanation: 'Synthetic explanation.', evidenceCertainty: 'certain', requiresTeacherReview: false }],
      sentenceRevisions: [], expressionUpgrades: [],
      fullTextRevision: { correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
      legibilityIssues: [{ issueKey: 'legibility-can', transcriptText: 'can', possibleReadings: ['can', "can't"], pageNumber: 1, regionDescription: 'middle word', explanation: 'The apostrophe is unclear.', defaultOutcome: 'count_as_legibility_error' }],
      overallComment: 'The response is concise.',
    }, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: [
          expect.objectContaining({ dimensionId: 'language', evidence: transcript, requiresTeacherReview: true }),
          expect.any(Object),
        ],
      },
    })
    if (!normalized.ok) return

    expect(projectGradingClientResponse(normalized.result, {
      httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true,
      inputMode: 'images', pageCount: 1, fullScore: 15, task,
    })).toMatchObject({ status: 'partial', totalScore: 14 })
  })

  it('keeps every repaired auxiliary edge accepted by the website projector', () => {
    const makePayload = (): Record<string, unknown> => ({
      transcript: 'A B', recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15,
      dimensionScores: [
        { dimensionId: 'language', score: 14.25, reason: 'Accurate.', evidence: 'A B', relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'A B', relatedIssueKeys: [] },
      ],
      issues: [], sentenceRevisions: [], expressionUpgrades: [],
      fullTextRevision: { correctedText: 'A B', improvedText: 'A B', sentencePairs: [], logicNotes: [], logicIssues: [] },
      legibilityIssues: [], overallComment: 'Clear response.',
    })
    const addLegibility = (payload: Record<string, unknown>) => {
      payload.reportedTotalScore = 14
      ;(payload.dimensionScores as Array<Record<string, unknown>>)[1] = { dimensionId: 'legibility', score: 0.25, reason: 'One mark is unclear.', evidence: 'B', relatedIssueKeys: ['legibility-b'] }
      payload.legibilityIssues = [{ issueKey: 'legibility-b', transcriptText: 'B', possibleReadings: ['B', 'D'], pageNumber: 1, regionDescription: 'final letter', explanation: 'Two readings are plausible.', defaultOutcome: 'count_as_legibility_error' }]
    }
    const cases: Array<{ name: string; mutate: (payload: Record<string, unknown>) => void }> = [
      { name: 'whitespace issue', mutate: (payload) => { payload.issues = [{ issueKey: 'space', type: 'grammar', severity: 'low', originalText: ' ', suggestion: 'Synthetic.', explanation: 'Synthetic.', evidenceCertainty: 'certain', requiresTeacherReview: false }] } },
      { name: 'whitespace revision', mutate: (payload) => { payload.sentenceRevisions = [{ originalText: ' ', revisedText: 'Synthetic.', note: 'Synthetic.', relatedIssueKeys: [], changeTypes: ['grammar'] }] } },
      { name: 'whitespace pair', mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: ' ', correctedText: 'x', improvedText: 'y', relatedIssueKeys: [], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }] } },
      { name: 'whitespace upgrade', mutate: (payload) => { payload.expressionUpgrades = [{ originalText: ' ', upgradedText: 'Synthetic.', note: 'Synthetic.' }] } },
      { name: 'whitespace logic issue', mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).logicIssues = [{ issueKey: 'space-logic', originalText: ' ', contextBefore: '', contextAfter: '', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic.', polishedSuggestion: 'Synthetic.', requiresTeacherReview: false }] } },
      { name: 'whitespace logic context', mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).logicIssues = [{ issueKey: 'space-context', originalText: 'B', contextBefore: ' ', contextAfter: '', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic.', polishedSuggestion: 'Synthetic.', requiresTeacherReview: false }] } },
      { name: 'whitespace legibility', mutate: (payload) => { payload.legibilityIssues = [{ issueKey: 'space-legibility', transcriptText: ' ', possibleReadings: ['A', 'B'], pageNumber: 1, regionDescription: 'middle', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }] } },
      { name: 'whitespace logic note', mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).logicNotes = [{ quote: ' ', note: 'Synthetic.' }] } },
      { name: 'whitespace dimension evidence', mutate: (payload) => { (payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = ' ' } },
      { name: 'oversized rebuilt text', mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: 'B', correctedText: 'x'.repeat(50_000), improvedText: 'y'.repeat(50_000), relatedIssueKeys: [], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }] } },
      { name: 'legibility-linked revision', mutate: (payload) => { addLegibility(payload); payload.sentenceRevisions = [{ originalText: 'A', revisedText: 'Synthetic.', note: 'Synthetic.', relatedIssueKeys: ['legibility-b'], changeTypes: ['grammar'] }] } },
      { name: 'legibility-linked pair', mutate: (payload) => { addLegibility(payload); (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: 'A', correctedText: 'Synthetic.', improvedText: 'Synthetic.', relatedIssueKeys: ['legibility-b'], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }] } },
    ]

    for (const testCase of cases) {
      const payload = makePayload()
      testCase.mutate(payload)
      const normalized = normalizeMultimodalResult(payload, context)
      expect(normalized.ok, testCase.name).toBe(true)
      if (!normalized.ok) continue
      const projected = projectGradingClientResponse(normalized.result, {
        httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true,
        inputMode: 'images', pageCount: 1, fullScore: 15, task,
      })
      expect(projected, testCase.name).toMatchObject({ status: normalized.result.status, totalScore: normalized.result.totalScore })
    }
  })

  it.each([
    ['issues', (payload: Record<string, unknown>) => { payload.issues = [{ malformed: true }] }],
    ['sentence revisions', (payload: Record<string, unknown>) => { payload.sentenceRevisions = [{ malformed: true }] }],
    ['full-text revision', (payload: Record<string, unknown>) => { delete payload.fullTextRevision }],
    ['legibility items', (payload: Record<string, unknown>) => { payload.legibilityIssues = [{ malformed: true }] }],
    ['recognition warnings', (payload: Record<string, unknown>) => { payload.recognitionWarnings = [{ malformed: true }] }],
    ['dimension support fields', (payload: Record<string, unknown>) => {
      const dimension = (payload.dimensionScores as Array<Record<string, unknown>>)[0]!
      dimension.reason = ' '
      delete dimension.evidence
      dimension.relatedIssueKeys = ['duplicate', 'duplicate']
    }],
    ['reported total', (payload: Record<string, unknown>) => { payload.reportedTotalScore = 'not-a-number' }],
  ] as const)('keeps the complete bounded score usable when %s drift', (_label, mutate) => {
    const transcript = 'A complete synthetic response.'
    const payload: Record<string, unknown> = {
      transcript, recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15,
      dimensionScores: [
        { dimensionId: 'language', score: 14.25, reason: 'Accurate.', evidence: transcript, relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: transcript, relatedIssueKeys: [] },
      ],
      issues: [], sentenceRevisions: [], expressionUpgrades: [],
      fullTextRevision: { correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
      legibilityIssues: [], overallComment: 'Clear response.',
    }
    mutate(payload)

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 15,
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return
    expect(projectGradingClientResponse(normalized.result, {
      httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true,
      inputMode: 'images', pageCount: 1, fullScore: 15, task,
    })).toMatchObject({ status: 'partial', totalScore: 15 })
  })

  it('silently suppresses a field-complete extra-key uncertain spelling record across Gateway and website', () => {
    const payload = fullScorePayload()
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The spelling is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false, extra: true,
    }]
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[0]
    language.reason = 'The spelling is uncertain.'
    language.evidence = 'wark'
    language.relatedIssueKeys = ['spelling-wark']
    payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: 'Change wark to work.', note: 'Correct the spelling.' }]
    payload.overallComment = 'Change wark to work.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'success', totalScore: 15, issues: [], expressionUpgrades: [], reviewReasons: [],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 14.25 })]),
      },
    })
    if (!normalized.ok) return
    expect(JSON.stringify(normalized.result)).not.toMatch(/Change wark to work|"suggestion":"work"/)
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'success', totalScore: 15, issues: [], reviewReasons: [] })
  })

  it('does not republish a different explanation from a malformed same-key issue clone across Gateway and website', () => {
    const transcript = 'I wark today. It are blue.'
    const payload = fullScorePayload(transcript)
    payload.reportedTotalScore = 14
    payload.issues = [{
      issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.',
      explanation: 'Agreement.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }, {
      issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.',
      explanation: 'PRIVATE-SAME-KEY-EXPLANATION', evidenceCertainty: 'certain', requiresTeacherReview: false, extra: true,
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0] = {
      dimensionId: 'language', score: 13.25, reason: 'Agreement needs review.', evidence: 'It are blue.', relatedIssueKeys: ['grammar-blue'],
    }
    payload.expressionUpgrades = [{
      originalText: 'today.', upgradedText: 'Use PRIVATE-SAME-KEY-EXPLANATION.', note: 'Synthetic.',
    }]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        issues: [expect.objectContaining({ type: 'grammar', explanation: 'Agreement.' })],
        expressionUpgrades: [],
      },
    })
    if (!normalized.ok) return
    expect(JSON.stringify(normalized.result)).not.toContain('PRIVATE-SAME-KEY-EXPLANATION')
    expect(projectNormalized(normalized.result)).toMatchObject({
      status: 'partial', totalScore: 14, issues: [expect.objectContaining({ type: 'grammar' })], expressionUpgrades: [],
    })
  })

  it('keeps a grammar deduction when a malformed same-key sibling conflicts on spelling semantics', () => {
    const payload = fullScorePayload()
    payload.reportedTotalScore = 14
    payload.issues = [{
      issueKey: 'grammar-wark', type: 'grammar', severity: 'medium', originalText: 'wark', suggestion: 'work',
      explanation: 'Grammar correction.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }, {
      issueKey: 'grammar-wark', type: 'spelling', severity: 'medium', originalText: 'wark', suggestion: 'work',
      explanation: 'Grammar correction.', evidenceCertainty: 'uncertain', requiresTeacherReview: false, extra: true,
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0] = {
      dimensionId: 'language', score: 13.25, reason: 'Grammar correction is needed.', evidence: 'wark', relatedIssueKeys: ['grammar-wark'],
    }
    payload.overallComment = 'The grammar correction from wark to work is needed.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        issues: [], overallComment: '已依据评分标准完成批改。',
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 13.25, requiresTeacherReview: true })]),
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result)).toMatchObject({
      status: 'partial', totalScore: 14, issues: [],
    })
  })

  it.each([
    ['issue suggestion plus explanation', (payload: Record<string, unknown>) => {
      ;(payload.issues as unknown[]).push({
        issueKey: 'grammar-split', type: 'grammar', severity: 'low', originalText: 'today.', suggestion: 'Use work.',
        explanation: 'Correct the spelling.', evidenceCertainty: 'certain', requiresTeacherReview: false,
      })
    }, 'partial'],
    ['logic diagnosis plus suggestions', (payload: Record<string, unknown>) => {
      ;((payload.fullTextRevision as Record<string, unknown>).logicIssues as unknown[]).push({
        issueKey: 'logic-split', originalText: 'today.', contextBefore: '', contextAfter: 'I work later.', subType: 'unclear_logic', severity: 'low',
        diagnosis: 'Correct the spelling.', suggestedAction: 'replace_sentence', conservativeSuggestion: 'Use work.',
        polishedSuggestion: 'Use work.', requiresTeacherReview: false,
      })
    }, 'partial'],
    ['revision replacement plus note', (payload: Record<string, unknown>) => {
      payload.sentenceRevisions = [{
        originalText: 'today.', revisedText: 'Use work.', note: 'Correct the spelling.',
        relatedIssueKeys: ['spelling-wark'], changeTypes: ['spelling'],
      }]
    }, 'success'],
    ['pair replacements plus explanation', (payload: Record<string, unknown>) => {
      ;(payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{
        originalText: 'today.', correctedText: 'Use work.', improvedText: 'Use work.',
        relatedIssueKeys: ['spelling-wark'], changeTypes: ['spelling'], explanation: 'Correct the spelling.', requiresTeacherReview: false,
      }]
    }, 'success'],
    ['upgrade text plus note', (payload: Record<string, unknown>) => {
      payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: 'Use work.', note: 'Correct the spelling.' }]
    }, 'success'],
    ['logic-note quote plus note', (payload: Record<string, unknown>) => {
      ;(payload.fullTextRevision as Record<string, unknown>).logicNotes = [{ quote: 'work', note: 'Correct the spelling.' }]
    }, 'success'],
    ['overall comment', (payload: Record<string, unknown>) => {
      payload.overallComment = 'Use work. Correct the spelling.'
    }, 'success'],
  ] as const)('suppresses a spelling correction split across one %s item through the website projector', (_label, mutate, expectedStatus) => {
    const transcript = 'I wark today. I work later.'
    const payload = uncertainSpellingPayload(transcript)
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[1].evidence = transcript
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = transcript
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = transcript
    mutate(payload)

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: expectedStatus, totalScore: 15 } })
    if (!normalized.ok) return
    expect(JSON.stringify(normalized.result)).not.toMatch(/Use work\.|Correct the spelling\./)
    expect(projectNormalized(normalized.result)).toMatchObject({ status: expectedStatus, totalScore: 15 })
  })

  it('preserves ordinary work/word feedback without a correction cue across Gateway and website', () => {
    const transcript = 'Your work is clear.'
    const payload = fullScorePayload(transcript)
    payload.issues = [{
      issueKey: 'spelling-work', type: 'spelling', severity: 'low', originalText: 'work', suggestion: 'word',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].reason = 'The work has clear logic.'
    payload.overallComment = 'Good work. This word is vivid.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'success', issues: [], overallComment: 'Good work. This word is vivid.',
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', reason: 'The work has clear logic.' })]),
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result)).toMatchObject({
      status: 'success', totalScore: 15, overallComment: 'Good work. This word is vivid.',
    })
  })

  it('suppresses explicit use/prefer/choose/replace spelling directives across Gateway and website', () => {
    const payload = uncertainSpellingPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].reason = 'Use work.'
    payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: 'Prefer work.', note: 'Synthetic.' }]
    payload.overallComment = 'Choose work. Replace wark with work.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: 'success', totalScore: 15, expressionUpgrades: [] } })
    if (!normalized.ok) return
    expect(JSON.stringify(normalized.result)).not.toMatch(/Use work\.|Prefer work\.|Choose work\.|Replace wark with work\./i)
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'success', totalScore: 15, expressionUpgrades: [] })
  })

  it.each(['issue', 'logic', 'legibility'] as const)('does not republish a policy-removed %s item across Gateway and website', (kind) => {
    const marker = `PRIVATE-POLICY-${kind.toUpperCase()}`
    const transcript = 'I wark today. Safe blur.'
    const payload = uncertainSpellingPayload(transcript)
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[1] = {
      dimensionId: 'legibility', score: kind === 'legibility' ? 0 : 0.75,
      reason: kind === 'legibility' ? 'One mark is unclear.' : 'Legible.',
      evidence: kind === 'legibility' ? 'blur' : transcript,
      relatedIssueKeys: kind === 'legibility' ? ['legibility-blur'] : [],
    }
    payload.reportedTotalScore = kind === 'legibility' ? 14 : 15
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = transcript
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = transcript
    if (kind === 'issue') {
      ;(payload.issues as unknown[]).push({
        issueKey: 'grammar-policy', type: 'grammar', severity: 'low', originalText: 'wark', suggestion: marker,
        explanation: marker, evidenceCertainty: 'certain', requiresTeacherReview: false,
      })
    } else if (kind === 'logic') {
      ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
        issueKey: 'logic-policy', originalText: 'Safe', contextBefore: 'wark', contextAfter: '', subType: 'unclear_logic', severity: 'low',
        diagnosis: marker, suggestedAction: 'add_bridge_sentence', conservativeSuggestion: marker,
        polishedSuggestion: marker, requiresTeacherReview: false,
      }]
    } else {
      payload.legibilityIssues = [{
        issueKey: 'legibility-blur', transcriptText: 'blur', possibleReadings: ['blur', 'blue'], pageNumber: 1,
        regionDescription: marker, explanation: `${marker}. Change wark to work.`, defaultOutcome: 'count_as_legibility_error',
      }]
    }
    payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: marker, note: marker }]
    payload.overallComment = marker

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: 'partial', expressionUpgrades: [], overallComment: '已依据评分标准完成批改。' } })
    if (!normalized.ok) return
    expect(JSON.stringify(normalized.result)).not.toContain(marker)
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'partial', expressionUpgrades: [] })
  })

  it.each(['issue', 'logic', 'legibility'] as const)('blocks policy-stage narrative flow through another public %s across Gateway and website', (publicKind) => {
    const marker = `PRIVATE-POLICY-CHAIN-${publicKind.toUpperCase()}`
    const transcript = 'I wark today. It are blue. Then I left.'
    const payload = uncertainSpellingPayload(transcript)
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[1] = {
      dimensionId: 'legibility', score: publicKind === 'legibility' ? 0 : 0.75,
      reason: publicKind === 'legibility' ? 'One mark is unclear.' : 'Legible.',
      evidence: publicKind === 'legibility' ? 'left' : 'Then I left.',
      relatedIssueKeys: publicKind === 'legibility' ? ['legibility-policy-sink'] : [],
    }
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = transcript
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = transcript
    ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
      issueKey: 'logic-policy-source', originalText: 'It are blue.', contextBefore: 'wark', contextAfter: 'Then I left.',
      subType: 'unclear_logic', severity: 'low', diagnosis: marker, suggestedAction: 'add_bridge_sentence',
      conservativeSuggestion: marker, polishedSuggestion: marker, requiresTeacherReview: false,
    }]
    if (publicKind === 'issue') {
      ;(payload.issues as unknown[]).push({
        issueKey: 'grammar-policy-sink', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: marker,
        explanation: marker, evidenceCertainty: 'certain', requiresTeacherReview: false,
      })
    } else if (publicKind === 'logic') {
      ;((payload.fullTextRevision as Record<string, unknown>).logicIssues as unknown[]).push({
        issueKey: 'logic-policy-sink', originalText: 'Then I left.', contextBefore: 'It are blue.', contextAfter: '',
        subType: 'unclear_logic', severity: 'low', diagnosis: marker, suggestedAction: 'add_bridge_sentence',
        conservativeSuggestion: marker, polishedSuggestion: marker, requiresTeacherReview: false,
      })
    } else {
      payload.legibilityIssues = [{
        issueKey: 'legibility-policy-sink', transcriptText: 'left', possibleReadings: ['left', 'loft'], pageNumber: 1,
        regionDescription: marker, explanation: marker, defaultOutcome: 'count_as_legibility_error',
      }]
    }

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        ...(publicKind === 'issue' ? { issues: [] } : {}),
        ...(publicKind === 'logic' ? { fullTextRevision: { logicIssues: [] } } : {}),
        ...(publicKind === 'legibility' ? { legibilityIssues: [] } : {}),
      },
    })
    if (!normalized.ok) return
    expect(JSON.stringify(normalized.result)).not.toContain(marker)
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'partial' })
  })

  it.each([
    'A noun needs a plural ending.',
    'The predicate does not match the subject.',
    'A preposition is missing.',
    'This is a sentence fragment.',
  ])('keeps a bounded deduction without positive spelling attribution across Gateway and website: %s', (reason) => {
    const payload = uncertainSpellingPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].reason = reason

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 13.25, requiresTeacherReview: true })]),
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'partial', totalScore: 14 })
  })

  it.each([
    ['local spelling evidence', 'wark', 15, 'success'],
    ['wide evidence also covering grammar', 'I wark today. It are blue.', 14, 'partial'],
  ] as const)('uses local spelling evidence ahead of a stale wide grammar link across Gateway and website: %s', (_label, evidence, expectedTotal, expectedStatus) => {
    const transcript = 'I wark today. It are blue.'
    const payload = uncertainSpellingPayload(transcript)
    ;(payload.issues as unknown[]).push({
      issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: transcript,
      suggestion: 'I wark today. It is blue.', explanation: 'Fix agreement.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    })
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0] = {
      dimensionId: 'language', score: 13.25, reason: 'The spelling of wark is uncertain.', evidence, relatedIssueKeys: ['grammar-blue'],
    }
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[1].evidence = transcript
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = transcript
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = transcript

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: expectedStatus, totalScore: expectedTotal,
        issues: [expect.objectContaining({ type: 'grammar' })],
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: expectedTotal === 15 ? 14.25 : 13.25,
        })]),
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result)).toMatchObject({ status: expectedStatus, totalScore: expectedTotal })
  })

  it.each([
    ['unknown provider row', { dimensionId: 'provider_extra', score: 999, reason: 'SECRET-EXTRA', evidence: 'SECRET-EXTRA', relatedIssueKeys: [] }],
    ['malformed object row', { malformed: true, raw: 'SECRET-EXTRA' }],
    ['primitive row', 'SECRET-EXTRA'],
    ['null row', null],
  ] as const)('salvages complete known dimensions beside an extra %s across Gateway and website', (_label, extraRow) => {
    const payload = fullScorePayload('A complete response.')
    ;(payload.dimensionScores as unknown[]).push(extraRow)

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 15,
        dimensionScores: [expect.objectContaining({ dimensionId: 'language' }), expect.objectContaining({ dimensionId: 'legibility' })],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return
    expect(JSON.stringify(normalized.result)).not.toContain('SECRET-EXTRA')
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'partial', totalScore: 15 })
  })

  it.each([
    ['duplicate known dimension', (rows: unknown[]) => rows.push({ dimensionId: 'language', score: 14.25 })],
    ['malformed duplicate known dimension', (rows: unknown[]) => rows.push({ dimensionId: 'language' })],
    ['missing known dimension', (rows: unknown[]) => rows.pop()],
    ['non-finite known score', (rows: unknown[]) => { (rows[0] as Record<string, unknown>).score = Number.NaN }],
    ['out-of-bounds known score', (rows: unknown[]) => { (rows[0] as Record<string, unknown>).score = 14.251 }],
  ] as const)('keeps a core dimension failure hard across the Gateway boundary: %s', (_label, mutate) => {
    const payload = fullScorePayload('A complete response.')
    mutate(payload.dimensionScores as unknown[])
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: false, error: { code: 'provider_invalid_response', diagnosticCode: 'dimension_scores' },
    })
  })

  it('keeps a generic grammar deduction and review when its stale link names only uncertain spelling', () => {
    const payload = fullScorePayload()
    payload.reportedTotalScore = 14
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The spelling is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0] = {
      dimensionId: 'language', score: 13.25, reason: 'The spelling is uncertain, and subject-verb agreement is wrong.',
      evidence: 'wark', relatedIssueKeys: ['spelling-wark'],
    }

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 13.25, requiresTeacherReview: true })]),
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'partial', totalScore: 14 })
  })

  it('keeps wide-reference grammar, logic, revision, and pair feedback that preserves an ambiguous token', () => {
    const transcript = 'I wark today. It are blue.'
    const payload = fullScorePayload(transcript)
    payload.reportedTotalScore = 14
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The spelling is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }, {
      issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: transcript,
      suggestion: 'I wark today. It is blue.', explanation: 'Fix agreement and preserve the first word.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0] = {
      dimensionId: 'language', score: 13.25, reason: 'Fix agreement in the second sentence.', evidence: transcript, relatedIssueKeys: ['grammar-blue', 'logic-blue'],
    }
    payload.sentenceRevisions = [{
      originalText: transcript, revisedText: 'I wark today. It is blue.', note: 'Fix agreement.',
      relatedIssueKeys: ['grammar-blue', 'spelling-wark'], changeTypes: ['grammar', 'spelling'],
    }]
    ;(payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{
      originalText: transcript, correctedText: 'I wark today. It is blue.', improvedText: 'I wark today. It looks blue.',
      relatedIssueKeys: ['grammar-blue', 'spelling-wark'], changeTypes: ['grammar', 'spelling'], explanation: 'Fix agreement.', requiresTeacherReview: false,
    }]
    ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
      issueKey: 'logic-blue', originalText: 'It are blue.', contextBefore: 'I wark today.', contextAfter: '',
      subType: 'unclear_logic', severity: 'medium', diagnosis: 'The second sentence needs a clearer connection.',
      suggestedAction: 'replace_sentence', conservativeSuggestion: 'I wark today. It is blue.',
      polishedSuggestion: 'I wark today. It looks blue.', requiresTeacherReview: false,
    }]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        totalScore: 14, issues: [expect.objectContaining({ type: 'grammar' })],
        sentenceRevisions: [expect.objectContaining({ changeTypes: ['grammar'] })],
        fullTextRevision: {
          logicIssues: [expect.objectContaining({ originalText: 'It are blue.', contextBefore: 'I wark today.' })],
          sentencePairs: [expect.objectContaining({ changeTypes: ['grammar'] })],
        },
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result)).toMatchObject({ totalScore: 14, issues: [expect.objectContaining({ type: 'grammar' })] })
  })

  it.each(['ungrounded logic', 'malformed grounded logic', 'ungrounded legibility'] as const)('does not republish rejected %s content through any public auxiliary surface', (kind) => {
    const transcript = 'A safe sentence. Another safe sentence.'
    const payload = fullScorePayload(transcript)
    const fullText = payload.fullTextRevision as Record<string, unknown>
    const marker = kind === 'ungrounded legibility' ? 'SECRET-LEGIBILITY' : 'SECRET-LOGIC'
    const leakedNarrative = kind === 'ungrounded legibility' ? `${marker}-EXPLANATION` : `${marker}-SUGGESTION`
    if (kind === 'ungrounded logic') {
      fullText.logicIssues = [{
        issueKey: 'logic-secret', originalText: `${marker}-QUOTE`, contextBefore: '', contextAfter: '', subType: 'unclear_logic', severity: 'low',
        diagnosis: `${marker}-DIAGNOSIS`, suggestedAction: 'add_bridge_sentence', conservativeSuggestion: `${marker}-SUGGESTION`,
        polishedSuggestion: `${marker}-POLISHED`, requiresTeacherReview: false,
      }]
    } else if (kind === 'malformed grounded logic') {
      fullText.logicIssues = [{
        issueKey: 'logic-secret', originalText: 'A safe sentence.', contextBefore: '', contextAfter: '', subType: 'unclear_logic', severity: 'low',
        diagnosis: `${marker}-DIAGNOSIS`, suggestedAction: 'add_bridge_sentence', conservativeSuggestion: `${marker}-SUGGESTION`,
        polishedSuggestion: `${marker}-POLISHED`, requiresTeacherReview: false, extra: true,
      }]
    } else {
      payload.legibilityIssues = [{
        issueKey: 'legibility-secret', transcriptText: `${marker}-QUOTE`, possibleReadings: [`${marker}-READING-A`, `${marker}-READING-B`],
        pageNumber: 1, regionDescription: `${marker}-REGION`, explanation: `${marker}-EXPLANATION`, defaultOutcome: 'count_as_legibility_error',
      }]
    }
    payload.issues = [{
      issueKey: 'grammar-leak', type: 'grammar', severity: 'low', originalText: 'A safe sentence.', suggestion: leakedNarrative,
      explanation: leakedNarrative, evidenceCertainty: 'certain', requiresTeacherReview: false,
    }]
    payload.sentenceRevisions = [{
      originalText: 'A safe sentence.', revisedText: leakedNarrative, note: leakedNarrative,
      relatedIssueKeys: ['grammar-leak'], changeTypes: ['grammar'],
    }]
    fullText.sentencePairs = [{
      originalText: 'A safe sentence.', correctedText: leakedNarrative, improvedText: leakedNarrative,
      relatedIssueKeys: ['grammar-leak'], changeTypes: ['grammar'], explanation: leakedNarrative, requiresTeacherReview: false,
    }]
    ;(fullText.logicIssues as unknown[]).push({
      issueKey: 'logic-leak', originalText: 'Another safe sentence.', contextBefore: '', contextAfter: '', subType: 'unclear_logic', severity: 'low',
      diagnosis: leakedNarrative, suggestedAction: 'add_bridge_sentence', conservativeSuggestion: leakedNarrative,
      polishedSuggestion: leakedNarrative, requiresTeacherReview: false,
    })
    ;(payload.legibilityIssues as unknown[]).push({
      issueKey: 'legibility-leak', transcriptText: 'Another safe sentence.', possibleReadings: ['Another safe sentence.', 'Another safe sentence!'],
      pageNumber: 1, regionDescription: leakedNarrative, explanation: leakedNarrative, defaultOutcome: 'count_as_legibility_error',
    })
    payload.expressionUpgrades = [{ originalText: 'Another safe sentence.', upgradedText: leakedNarrative, note: leakedNarrative }]
    fullText.logicNotes = [{ quote: 'Another safe sentence.', note: leakedNarrative }]
    payload.recognitionWarnings = [{ scope: 'global_unreadable', message: leakedNarrative }]
    payload.overallComment = leakedNarrative
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].reason = leakedNarrative

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', issues: [], sentenceRevisions: [], expressionUpgrades: [], legibilityIssues: [], recognitionWarnings: [],
        fullTextRevision: { sentencePairs: [], logicNotes: [], logicIssues: [] },
      },
    })
    if (!normalized.ok) return
    expect(JSON.stringify(normalized.result)).not.toContain(marker)
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'partial', totalScore: 15 })
  })

  it('lets a valid same-range legibility ambiguity override a safely suppressed uncertain spelling candidate', () => {
    const payload = fullScorePayload()
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The spelling is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false, extra: true,
    }]
    payload.legibilityIssues = [{
      issueKey: 'legibility-wark', transcriptText: 'wark', possibleReadings: ['wark', 'work'], pageNumber: 1,
      regionDescription: 'first word', explanation: 'Two readings are genuinely plausible.', defaultOutcome: 'count_as_legibility_error',
    }]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        legibilityIssues: [expect.objectContaining({ transcriptText: 'wark', defaultOutcome: 'count_as_legibility_error' })],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'legibility', score: 0, requiresTeacherReview: true })]),
      },
    })
    if (!normalized.ok) return
    expect(projectNormalized(normalized.result)).toMatchObject({ status: 'partial', totalScore: 14, legibilityIssues: [expect.any(Object)] })
  })

  it('carries raw grammar, logic, local legibility, plural links, and review metadata through the real UI consumer chain', () => {
    const transcript = "I suggest you joins the club. The moon is made of green paper. I can't attend today."
    const verticalTask = {
      ...task,
      fullScore: 20,
      rubric: {
        ...task.rubric,
        dimensions: [
          { id: 'language', name: 'Language', weight: 55, description: 'Accuracy.', deductionFocus: [], sourceEvidence: [] },
          { id: 'relevance', name: 'Relevance', weight: 40, description: 'Logic.', deductionFocus: [], sourceEvidence: [] },
          { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] },
        ],
      },
    }
    const normalized = normalizeMultimodalResult({
      transcript,
      recognitionWarnings: [],
      printedTextExcluded: true,
      reportedTotalScore: 17,
      dimensionScores: [
        { dimensionId: 'language', score: 10, reason: 'One sentence needs a language correction.', evidence: 'I suggest you joins the club.', relatedIssueKeys: ['grammar-join', 'word-club'] },
        { dimensionId: 'relevance', score: 7, reason: 'One sentence is unrelated.', evidence: 'The moon is made of green paper.', relatedIssueKeys: ['logic-moon'] },
        { dimensionId: 'legibility', score: 0, reason: 'One local mark is unresolved.', evidence: "can't", relatedIssueKeys: ['legibility-cant'] },
      ],
      issues: [
        { issueKey: 'grammar-join', type: 'grammar', severity: 'medium', originalText: 'I suggest you joins the club.', suggestion: 'I suggest you join the club.', explanation: 'Use the base verb.', evidenceCertainty: 'certain', requiresTeacherReview: true },
        { issueKey: 'word-club', type: 'word_choice', severity: 'low', originalText: 'club', suggestion: 'activity club', explanation: 'Use a more specific phrase.', evidenceCertainty: 'certain', requiresTeacherReview: false },
      ],
      sentenceRevisions: [{ originalText: 'I suggest you joins the club.', revisedText: 'I suggest you join the activity club.', note: 'Clarify the logical bridge.', relatedIssueKeys: ['logic-moon'], changeTypes: ['logic_bridge'] }],
      expressionUpgrades: [],
      fullTextRevision: {
        correctedText: "I suggest you join the club. The moon is made of green paper. I can't attend today.",
        improvedText: "I suggest joining the activity club. The moon is made of green paper. I can't attend today.",
        sentencePairs: [{ originalText: 'I suggest you joins the club.', correctedText: 'I suggest you join the club.', improvedText: 'I suggest joining the activity club.', relatedIssueKeys: ['grammar-join', 'logic-moon'], changeTypes: ['grammar', 'logic_bridge'], explanation: 'Correct and refine the recommendation.', requiresTeacherReview: true }],
        logicNotes: [{ quote: 'The moon is made of green paper.', note: 'This sentence does not support the recommendation.' }],
        logicIssues: [{ issueKey: 'logic-moon', originalText: 'The moon is made of green paper.', contextBefore: 'I suggest you joins the club.', contextAfter: '', subType: 'irrelevant_sentence', severity: 'high', diagnosis: 'The claim is unrelated to the recommendation.', suggestedAction: 'delete_sentence', conservativeSuggestion: 'Delete this sentence.', polishedSuggestion: 'Keep the response focused on the club.', requiresTeacherReview: true }],
      },
      legibilityIssues: [{ issueKey: 'legibility-cant', transcriptText: "can't", possibleReadings: ['can', "can't"], pageNumber: 1, regionDescription: 'Apostrophe after can.', explanation: 'The local apostrophe cannot be resolved.', defaultOutcome: 'count_as_legibility_error' }],
      overallComment: 'The recommendation needs one language correction and one relevance edit.',
    }, { ...context, task: verticalTask })

    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(normalized.result).toMatchObject({ status: 'success', recognitionWarnings: [], reviewReasons: [] })
    const projected = projectGradingClientResponse(normalized.result, { httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true, inputMode: 'images', pageCount: 1, fullScore: 20, task: verticalTask })
    expect(projected.status).toBe('success')
    if (projected.status === 'failed') return
    const request = { requestVersion: 'multimodal-grading-request-v2' as const, requestId: context.requestId, essayId: context.essayId, pageIds: ['page-1'], task: verticalTask, pages: [{ pageId: 'page-1', file: new File(['synthetic'], 'essay.png', { type: 'image/png' }) }] }
    const adapted = adaptAiGradingResult(projected, request)
    expect(adapted.sentenceRevisions[0]).toMatchObject({ relatedErrorIds: ['essay-contract-logic-1'], changeTypes: ['logic_bridge'] })
    expect(adapted.fullTextRevision?.sentencePairs[0]).toMatchObject({ relatedErrorIds: ['essay-contract-issue-1', 'essay-contract-logic-1'], changeTypes: ['grammar', 'logic_bridge'], needsTeacherReview: true })
    expect(adapted.fullTextRevision).toMatchObject({ originalText: transcript, correctedText: "I suggest you join the club. The moon is made of green paper. I can't attend today.", polishedText: "I suggest joining the activity club. The moon is made of green paper. I can't attend today." })
    const cards = buildReviewIssueItems({ annotations: adapted.errorAnnotations, revisions: adapted.sentenceRevisions, logicIssues: adapted.fullTextRevision?.logicIssues, legibilityIssues: adapted.legibilityIssues })
    expect([...new Set(cards.map(({ source }) => source))]).toEqual(['language', 'logic', 'legibility'])
    expect(cards.filter(({ needsTeacherReview }) => needsTeacherReview).map(({ source }) => source)).toEqual(['language', 'logic'])
    const markers = buildSourceIssueMarkers(transcript, cards)
    expect([...new Set(markers.map(({ source }) => source))]).toEqual(['language', 'logic', 'legibility'])
    expect(markers.map(({ matchedText }) => matchedText)).toEqual(['I suggest you joins the ', 'club', '.', 'The moon is made of green paper.', "can't"])
  })

  it('takes a teacher-confirmed zero-page regrade through the real builder and client multipart boundary', async () => {
    const confirmedText = 'Teacher-confirmed synthetic response.'
    const websiteTask: Task = {
      id: 'task-zero-page', taskName: 'Synthetic task', className: '', essayType: '', fullScore: 20, scoringTemplateId: 'synthetic', status: 'processing', totalEssayCount: 1, completedEssayCount: 0, exceptionEssayCount: 0, createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', generateClassReview: false,
      materialContext: { materialSummary: 'Synthetic material.', writingRequirements: ['Write clearly.'], constraints: [], reviewWarnings: [] },
      rubricDraft: { source: 'teacher', writingGoal: 'Write clearly.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], status: 'confirmed', dimensions: [{ id: 'language', name: 'Language', weight: 95, description: 'Accuracy.', deductionFocus: [], sourceEvidence: [] }, { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] }] },
    }
    const websiteEssay: Essay = { id: 'essay-zero-page', taskId: websiteTask.id, essayNumber: 'Synthetic', pages: [], pageCount: 0, pageOrder: [], ocrText: confirmedText, transcriptSource: 'teacher_confirmed', ocrConfidence: 1, status: 'pending_grading', exceptionReasons: [], teacherReviewed: false, createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' }
    const taskWithHistoricalMaterial = {
      ...websiteTask,
      materialManifest: { originalFileName: 'prompt.pdf' },
      materialPdfText: 'Historical PDF text.',
      materialDocxText: 'Historical DOCX text.',
      ocrText: 'Historical OCR text.',
    }
    const built = buildMultimodalGradingRequest(taskWithHistoricalMaterial, websiteEssay, 'request-zero-page')
    expect(built).toMatchObject({ ok: true, request: { pageIds: [], pages: [], confirmedTranscript: confirmedText } })
    if (!built.ok) return
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: built.request.requestId, status: 'failed', error: { code: 'provider_unavailable', message: 'Safe.', retryable: true } }), { status: 503 }))
    await createRemoteGradingClient({ apiBase: 'http://gateway.test', fetchImpl }).gradeImages(built.request)
    const form = (fetchImpl.mock.calls[0]![1] as RequestInit).body as FormData
    expect(fetchImpl).toHaveBeenCalledWith('http://gateway.test/grading/grade-images', expect.objectContaining({ method: 'POST' }))
    expect([...form.keys()]).toEqual(['metadata'])
    const metadata = JSON.parse(String(form.get('metadata')))
    expect(metadata).toEqual({ requestVersion: 'multimodal-grading-request-v2', requestId: 'request-zero-page', essayId: 'essay-zero-page', pageIds: [], task: built.request.task, confirmedTranscript: confirmedText })
    expect(metadata.task).not.toHaveProperty('materialManifest')
    expect(metadata.task).not.toHaveProperty('materialPdfText')
    expect(metadata.task).not.toHaveProperty('materialDocxText')
    expect(metadata.task).not.toHaveProperty('ocrText')
    expect(form.getAll('pages')).toEqual([])
  })

  it('projects the actual multimodal normalizer result with certainty and multi-issue links intact', () => {
    const normalized = normalizeMultimodalResult({
      transcript: 'First synthetic sentence. Second synthetic sentence.', recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 12,
      dimensionScores: [
        { dimensionId: 'language', score: 11.6, reason: 'Synthetic reason.', evidence: 'Invented paraphrase.', relatedIssueKeys: ['grammar-first', 'word-second'] },
        { dimensionId: 'legibility', score: 0.75, reason: 'Synthetic readable text.', evidence: 'First synthetic sentence.', relatedIssueKeys: [] },
      ],
      issues: [
        { issueKey: 'grammar-first', type: 'grammar', severity: 'medium', originalText: 'First synthetic sentence.', suggestion: 'First corrected sentence.', explanation: 'Synthetic grammar.', evidenceCertainty: 'certain', requiresTeacherReview: false },
        { issueKey: 'word-second', type: 'word_choice', severity: 'low', originalText: 'Second synthetic sentence.', suggestion: 'Second refined sentence.', explanation: 'Synthetic word choice.', evidenceCertainty: 'certain', requiresTeacherReview: false },
      ],
      sentenceRevisions: [{ originalText: 'First synthetic sentence.', revisedText: 'First corrected sentence.', note: 'Synthetic revision.', relatedIssueKeys: ['grammar-first', 'word-second'], changeTypes: ['grammar', 'word_choice'] }],
      expressionUpgrades: [{ originalText: 'Second synthetic sentence.', upgradedText: 'A more polished second sentence.', note: 'Synthetic upgrade.' }],
      fullTextRevision: {
        correctedText: 'First corrected sentence. Second synthetic sentence.', improvedText: 'First corrected sentence. Second refined sentence.',
        sentencePairs: [{ originalText: 'First synthetic sentence.', correctedText: 'First corrected sentence.', improvedText: 'First corrected sentence.', relatedIssueKeys: ['grammar-first', 'word-second'], changeTypes: ['grammar', 'word_choice'], explanation: 'Synthetic pair.', requiresTeacherReview: false }],
        logicNotes: [], logicIssues: [],
      },
      legibilityIssues: [], overallComment: 'Synthetic overall comment.',
    }, context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(normalized.result).toMatchObject({
      status: 'partial',
      dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 11.6, evidence: 'First synthetic sentence.' })]),
      reviewReasons: expect.arrayContaining([
        '部分维度证据未能逐字定位，已改用可定位的原文证据。',
      ]),
    })
    const projected = projectGradingClientResponse(normalized.result, { httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true, inputMode: 'images', pageCount: 1, fullScore: 15, task })
    expect(projected.status).toBe('partial')
    if (projected.status === 'failed') return
    expect(projected.recognitionWarnings).toEqual([])
    expect(projected.legibilityIssues).toEqual([])
    expect(projected.issues[0]).toMatchObject({ id: 'essay-contract-issue-1', evidenceCertainty: 'certain' })
    expect(projected.sentenceRevisions[0]).toMatchObject({ relatedIssueIds: ['essay-contract-issue-1', 'essay-contract-issue-2'], changeTypes: ['grammar', 'word_choice'] })
    expect(projected.fullTextRevision?.sentencePairs[0]).toMatchObject({ relatedIssueIds: ['essay-contract-issue-1', 'essay-contract-issue-2'], changeTypes: ['grammar', 'word_choice'] })
    expect(projected.expressionUpgrades).toEqual([expect.objectContaining({ originalText: 'Second synthetic sentence.' })])
  })
})
