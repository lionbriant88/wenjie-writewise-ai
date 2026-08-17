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

describe('Gateway-to-website public grading contract', () => {
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
      sentenceRevisions: [{ originalText: 'I suggest you joins the club.', revisedText: 'I suggest you join the activity club.', note: 'Correct the verb and clarify the noun.', relatedIssueKeys: ['grammar-join', 'word-club'], changeTypes: ['grammar', 'word_choice'] }],
      expressionUpgrades: [],
      fullTextRevision: {
        correctedText: "I suggest you join the club. The moon is made of green paper. I can't attend today.",
        improvedText: "I suggest joining the activity club. The moon is made of green paper. I can't attend today.",
        sentencePairs: [{ originalText: 'I suggest you joins the club.', correctedText: 'I suggest you join the club.', improvedText: 'I suggest joining the activity club.', relatedIssueKeys: ['grammar-join', 'word-club'], changeTypes: ['grammar', 'word_choice'], explanation: 'Correct and refine the recommendation.', requiresTeacherReview: true }],
        logicNotes: [{ quote: 'The moon is made of green paper.', note: 'This sentence does not support the recommendation.' }],
        logicIssues: [{ issueKey: 'logic-moon', originalText: 'The moon is made of green paper.', contextBefore: 'I suggest you joins the club.', contextAfter: '', subType: 'irrelevant_sentence', severity: 'high', diagnosis: 'The claim is unrelated to the recommendation.', suggestedAction: 'delete_sentence', conservativeSuggestion: 'Delete this sentence.', polishedSuggestion: 'Keep the response focused on the club.', requiresTeacherReview: true }],
      },
      legibilityIssues: [{ issueKey: 'legibility-cant', transcriptText: "can't", possibleReadings: ['can', "can't"], pageNumber: 1, regionDescription: 'Apostrophe after can.', explanation: 'The local apostrophe cannot be resolved.', defaultOutcome: 'count_as_legibility_error' }],
      overallComment: 'The recommendation needs one language correction and one relevance edit.',
    }, { ...context, task: verticalTask })

    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(normalized.result).toMatchObject({ status: 'success', recognitionWarnings: [], reviewReasons: [] })
    const projected = projectGradingClientResponse(normalized.result, { httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true, inputMode: 'images', pageCount: 1, fullScore: 20 })
    expect(projected.status).toBe('success')
    if (projected.status === 'failed') return
    const request = { requestVersion: 'multimodal-grading-request-v2' as const, requestId: context.requestId, essayId: context.essayId, pageIds: ['page-1'], task: verticalTask, pages: [{ pageId: 'page-1', file: new File(['synthetic'], 'essay.png', { type: 'image/png' }) }] }
    const adapted = adaptAiGradingResult(projected, request)
    expect(adapted.sentenceRevisions[0]).toMatchObject({ relatedErrorIds: ['essay-contract-issue-1', 'essay-contract-issue-2'], changeTypes: ['grammar', 'word_choice'] })
    expect(adapted.fullTextRevision?.sentencePairs[0]).toMatchObject({ relatedErrorIds: ['essay-contract-issue-1', 'essay-contract-issue-2'], needsTeacherReview: true })
    expect(adapted.fullTextRevision).toMatchObject({ originalText: transcript, correctedText: "I suggest you join the club. The moon is made of green paper. I can't attend today.", polishedText: "I suggest joining the activity club. The moon is made of green paper. I can't attend today." })
    const cards = buildReviewIssueItems({ annotations: adapted.errorAnnotations, revisions: adapted.sentenceRevisions, logicIssues: adapted.fullTextRevision?.logicIssues, legibilityIssues: adapted.legibilityIssues })
    expect([...new Set(cards.map(({ source }) => source))]).toEqual(['language', 'logic', 'legibility'])
    expect(cards.filter(({ needsTeacherReview }) => needsTeacherReview).map(({ source }) => source)).toEqual(['language', 'logic'])
    const markers = buildSourceIssueMarkers(transcript, cards)
    expect([...new Set(markers.map(({ source }) => source))]).toEqual(['language', 'logic', 'legibility'])
    expect(markers.map(({ matchedText }) => matchedText)).toEqual(['I suggest you joins the club.', 'club', 'The moon is made of green paper.', "can't"])
  })

  it('takes a teacher-confirmed zero-page regrade through the real builder and client multipart boundary', async () => {
    const confirmedText = 'Teacher-confirmed synthetic response.'
    const websiteTask: Task = {
      id: 'task-zero-page', taskName: 'Synthetic task', className: '', essayType: '', fullScore: 20, scoringTemplateId: 'synthetic', status: 'processing', totalEssayCount: 1, completedEssayCount: 0, exceptionEssayCount: 0, createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', generateClassReview: false,
      materialContext: { materialSummary: 'Synthetic material.', writingRequirements: ['Write clearly.'], constraints: [], reviewWarnings: [] },
      rubricDraft: { source: 'teacher', writingGoal: 'Write clearly.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], status: 'confirmed', dimensions: [{ id: 'language', name: 'Language', weight: 95, description: 'Accuracy.', deductionFocus: [], sourceEvidence: [] }, { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] }] },
    }
    const websiteEssay: Essay = { id: 'essay-zero-page', taskId: websiteTask.id, essayNumber: 'Synthetic', pages: [], pageCount: 0, pageOrder: [], ocrText: confirmedText, transcriptSource: 'teacher_confirmed', ocrConfidence: 1, status: 'pending_grading', exceptionReasons: [], teacherReviewed: false, createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' }
    const built = buildMultimodalGradingRequest(websiteTask, websiteEssay, 'request-zero-page')
    expect(built).toMatchObject({ ok: true, request: { pageIds: [], pages: [], confirmedTranscript: confirmedText } })
    if (!built.ok) return
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: built.request.requestId, status: 'failed', error: { code: 'provider_unavailable', message: 'Safe.', retryable: true } }), { status: 503 }))
    await createRemoteGradingClient({ apiBase: 'http://gateway.test', fetchImpl }).gradeImages(built.request)
    const form = (fetchImpl.mock.calls[0]![1] as RequestInit).body as FormData
    expect(JSON.parse(String(form.get('metadata')))).toEqual({ requestVersion: 'multimodal-grading-request-v2', requestId: 'request-zero-page', essayId: 'essay-zero-page', pageIds: [], task: built.request.task, confirmedTranscript: confirmedText })
    expect(form.getAll('pages')).toEqual([])
  })

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
      legibilityIssues: [], overallComment: 'Synthetic overall comment.',
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
})
