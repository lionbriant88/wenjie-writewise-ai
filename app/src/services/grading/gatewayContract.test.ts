import { describe, expect, it } from 'vitest'
import { normalizeMultimodalResult } from '../../../../grading-gateway/src/multimodal/normalizeMultimodalResult'
import { normalizeGradingResult } from '../../../../grading-gateway/src/normalizeGradingResult'
import { projectGradingClientResponse } from './projectGradingClientResponse'

const task = { taskId: 'task-contract', fullScore: 15, materialSummary: 'Synthetic task.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic task.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [], dimensions: [{ id: 'language', name: 'Language', weight: 95, description: 'Accuracy.', deductionFocus: [], sourceEvidence: [] }, { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] }] } }
const context = { requestId: 'request-contract', essayId: 'essay-contract', task, provider: 'remote' as const, pageCount: 1, createdAt: '2026-08-15T00:00:00.000Z' }

describe('Gateway-to-website public grading contract', () => {
  it('projects the actual multimodal normalizer result with certainty and multi-issue links intact', () => {
    const normalized = normalizeMultimodalResult({
      transcript: 'First synthetic sentence. Second synthetic sentence.', recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 12,
      dimensionScores: [
        { dimensionId: 'language', score: 11.6, reason: 'Synthetic reason.', evidence: 'First synthetic sentence.', relatedIssueKeys: ['grammar-first', 'word-second'] },
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
      legibilityIssues: [], overallComment: 'Synthetic overall comment.', reviewReasons: [],
    }, context)
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
    expect(projected.expressionUpgrades).toEqual([expect.objectContaining({ originalText: 'Second synthetic sentence.' })])
  })

  it('projects the actual ordinary grading normalizer result', () => {
    const request = { requestVersion: 'grading-request-v1' as const, requestId: 'request-generic', task: { taskId: 'task-generic', writingGenre: 'practical_writing' as const, fullScore: 15, prompt: { writingGenre: 'practical_writing' as const, taskRequirement: 'Synthetic.' }, rubric: { status: 'confirmed' as const, writingGoal: 'Synthetic.', offTopicCriteria: [], dimensions: [{ id: 'language', name: 'Language', weight: 100, description: 'Accuracy.', deductionFocus: [] }], excellentFeatures: [], reviewTriggers: [] } }, essay: { essayId: 'essay-generic', confirmedTranscript: 'A synthetic sentence.', ocrContext: { sourceKind: 'manual' as const, hasKnownOcrRisk: false, riskCodes: [] } } }
    const normalized = normalizeGradingResult({
      reportedTotalScore: 12,
      dimensionScores: [{ dimensionId: 'language', score: 11.6, reason: 'Synthetic.', evidence: 'A synthetic sentence.', relatedIssueKeys: ['grammar-1'] }],
      recognitionWarnings: [], legibilityIssues: [],
      issues: [{ issueKey: 'grammar-1', type: 'grammar', severity: 'low', originalText: 'A synthetic sentence.', suggestion: 'A corrected sentence.', explanation: 'Synthetic.', evidenceCertainty: 'certain', requiresTeacherReview: false }],
      sentenceRevisions: [{ originalText: 'A synthetic sentence.', revisedText: 'A corrected sentence.', note: 'Synthetic.', relatedIssueKeys: ['grammar-1'], changeTypes: ['grammar'] }],
      expressionUpgrades: [],
      fullTextRevision: {
        correctedText: 'Provider aggregate.', improvedText: 'A corrected sentence.',
        sentencePairs: [{ originalText: 'A synthetic sentence.', correctedText: 'A corrected sentence.', improvedText: 'A corrected sentence.', relatedIssueKeys: ['grammar-1'], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }],
        logicNotes: [],
        logicIssues: [{ issueKey: 'logic-1', originalText: 'A synthetic sentence.', contextBefore: '', contextAfter: '', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic logic.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic conservative.', polishedSuggestion: 'Synthetic polished.', requiresTeacherReview: true }],
      },
      overallComment: 'Synthetic.', reviewReasons: [],
    }, request, { provider: 'remote', createdAt: '2026-08-15T00:00:00.000Z' })
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(normalized.result.fullTextRevision?.logicIssues[0]).not.toHaveProperty('issueKey')
    expect(projectGradingClientResponse(normalized.result, { httpOk: true, requestId: request.requestId, essayId: request.essay.essayId, inputMode: 'standard', fullScore: 15 })).toMatchObject({ status: 'success', totalScore: 12, recognitionWarnings: [], legibilityIssues: [], fullTextRevision: { logicIssues: [{ id: 'essay-generic-logic-1' }] } })
  })
})
