import { describe, expect, it } from 'vitest'
import { normalizeMultimodalResult } from '../../../../grading-gateway/src/multimodal/normalizeMultimodalResult'
import { projectGradingClientResponse } from './projectGradingClientResponse'

const task = { taskId: 'task-contract', fullScore: 15, materialSummary: 'Synthetic task.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic task.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [], dimensions: [{ id: 'language', name: 'Language', weight: 95, description: 'Accuracy.', deductionFocus: [], sourceEvidence: [] }, { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] }] } }
const context = { requestId: 'request-contract', essayId: 'essay-contract', task, provider: 'remote' as const, pageCount: 1, createdAt: '2026-08-15T00:00:00.000Z' }

describe('Gateway-to-website public grading contract', () => {
  it('projects the actual multimodal normalizer result with certainty and multi-issue links intact', () => {
    const normalized = normalizeMultimodalResult({ transcript: 'First synthetic sentence. Second synthetic sentence.', recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 12, dimensionScores: [{ dimensionId: 'language', score: 11.25, reason: 'Synthetic reason.', evidence: 'First synthetic sentence.' }, { dimensionId: 'legibility', score: 0.75, reason: 'Synthetic readable text.', evidence: 'First synthetic sentence.' }], issues: [{ issueKey: 'grammar-first', type: 'grammar', severity: 'medium', originalText: 'First synthetic sentence.', suggestion: 'First corrected sentence.', explanation: 'Synthetic grammar.', evidenceCertainty: 'certain', requiresTeacherReview: false }, { issueKey: 'word-second', type: 'word_choice', severity: 'low', originalText: 'Second synthetic sentence.', suggestion: 'Second refined sentence.', explanation: 'Synthetic word choice.', evidenceCertainty: 'certain', requiresTeacherReview: false }], sentenceRevisions: [{ originalText: 'First synthetic sentence.', revisedText: 'First corrected sentence.', note: 'Synthetic revision.', relatedIssueKeys: ['grammar-first', 'word-second'], changeTypes: ['grammar', 'word_choice'] }], expressionUpgrades: [], fullTextRevision: { correctedText: 'First corrected sentence. Second synthetic sentence.', improvedText: 'First corrected sentence. Second refined sentence.', sentencePairs: [{ originalText: 'First synthetic sentence.', correctedText: 'First corrected sentence.', improvedText: 'First corrected sentence.', relatedIssueKeys: ['grammar-first', 'word-second'], changeTypes: ['grammar', 'word_choice'], explanation: 'Synthetic pair.', requiresTeacherReview: false }], logicNotes: [], logicIssues: [] }, legibilityIssues: [], overallComment: 'Synthetic overall comment.', reviewReasons: [] }, context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    const projected = projectGradingClientResponse(normalized.result, { httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true, inputMode: 'images', pageCount: 1, fullScore: 15 })
    expect(projected.status).toBe('success')
    if (projected.status === 'failed') return
    expect(projected.recognitionWarnings).toEqual([])
    expect(projected.legibilityIssues).toEqual([])
    expect(projected.issues[0]).toMatchObject({ id: 'essay-contract-issue-1', evidenceCertainty: 'certain' })
    expect(projected.sentenceRevisions[0]).toMatchObject({ relatedIssueIds: ['essay-contract-issue-1', 'essay-contract-issue-2'], changeTypes: ['grammar', 'word_choice'] })
    expect(projected.fullTextRevision?.sentencePairs[0]).toMatchObject({ relatedIssueIds: ['essay-contract-issue-1', 'essay-contract-issue-2'], changeTypes: ['grammar', 'word_choice'] })
  })
})
