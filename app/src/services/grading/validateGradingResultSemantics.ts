import {
  exactUniqueTranscriptRange,
  GRADING_REVIEW_REASONS,
  hasDistinctNormalizedText,
  hasOrderedTranscriptContext,
  isWellFormedUnicode,
  locateUniqueNonOverlappingTranscriptRanges,
  narrativeExplicitlyReferencesLocalLegibility,
  rebuildTranscriptFromEdits,
  transcriptRangesOverlap,
} from './gradingResultSemantics'
import { calculateDimensionMaxScore } from './scoringRules'
import type { AiGradingResultV1, ConfirmedTaskPackageV2 } from './types'

export interface GradingResultSemanticExpectation {
  task: ConfirmedTaskPackageV2
  inputMode: 'images' | 'confirmed_text'
  confirmedTranscript?: string
  pageCount: number
}

const ALLOWED_REVIEW_REASONS = new Set<string>([
  GRADING_REVIEW_REASONS.scoreMismatch,
  GRADING_REVIEW_REASONS.recognitionUncertain,
  GRADING_REVIEW_REASONS.printedTextExclusionUncertain,
  GRADING_REVIEW_REASONS.logicNoteGroundingOmitted,
  GRADING_REVIEW_REASONS.expressionUpgradeGroundingOmitted,
  GRADING_REVIEW_REASONS.dimensionRelationAdjusted,
  GRADING_REVIEW_REASONS.dimensionEvidenceRegrounded,
])

function allQuotesAreGrounded(transcript: string, quotes: readonly string[]): boolean {
  return quotes.every((quote) => exactUniqueTranscriptRange(transcript, quote) !== null)
}

function rangesOverlapAny(
  transcript: string,
  quotes: readonly string[],
  blockedQuotes: readonly string[],
): boolean {
  const blocked = blockedQuotes.map((quote) => exactUniqueTranscriptRange(transcript, quote))
  return quotes.some((quote) => {
    const range = exactUniqueTranscriptRange(transcript, quote)
    return range !== null && blocked.some((candidate) => candidate !== null && transcriptRangesOverlap(range, candidate))
  })
}

function reviewStateIsConsistent(result: AiGradingResultV1): boolean {
  if (new Set(result.reviewReasons).size !== result.reviewReasons.length) return false
  if (result.reviewReasons.some((reason) => !ALLOWED_REVIEW_REASONS.has(reason))) return false
  const reasons = new Set(result.reviewReasons)
  if (reasons.has(GRADING_REVIEW_REASONS.recognitionUncertain) !== (result.recognitionWarnings.length > 0)) return false
  if (reasons.has(GRADING_REVIEW_REASONS.printedTextExclusionUncertain) !== (result.printedTextExcluded === false)) return false
  return result.status === (reasons.size === 0 ? 'success' : 'partial')
}

export function validateGradingResultSemantics(
  result: AiGradingResultV1,
  expected: GradingResultSemanticExpectation,
): boolean {
  const transcript = result.transcript
  if (typeof transcript !== 'string' || !transcript.trim() || !isWellFormedUnicode(transcript)) return false
  if (result.fullTextRevision.originalText !== transcript || result.maxScore !== expected.task.fullScore) return false

  const requestedDimensions = expected.task.rubric.dimensions
  if (result.dimensionScores.length !== requestedDimensions.length) return false
  for (const [index, requested] of requestedDimensions.entries()) {
    const actual = result.dimensionScores[index]
    if (!actual
      || actual.dimensionId !== requested.id
      || actual.name !== requested.name
      || actual.weight !== requested.weight
      || actual.maxScore !== calculateDimensionMaxScore(expected.task.fullScore, requested.weight)
      || !exactUniqueTranscriptRange(transcript, actual.evidence)) return false
  }

  const fullRevision = result.fullTextRevision
  const quoteFields = [
    ...result.dimensionScores.map(({ evidence }) => evidence),
    ...result.issues.map(({ originalText }) => originalText),
    ...result.sentenceRevisions.map(({ originalText }) => originalText),
    ...result.expressionUpgrades.map(({ originalText }) => originalText),
    ...fullRevision.sentencePairs.map(({ originalText }) => originalText),
    ...fullRevision.logicIssues.flatMap(({ originalText, contextBefore, contextAfter }) => (
      [originalText, ...(contextBefore ? [contextBefore] : []), ...(contextAfter ? [contextAfter] : [])]
    )),
    ...result.legibilityIssues.map(({ transcriptText }) => transcriptText),
  ]
  if (!allQuotesAreGrounded(transcript, quoteFields)) return false
  if (!locateUniqueNonOverlappingTranscriptRanges(transcript, result.sentenceRevisions.map(({ originalText }) => originalText))) return false
  if (!locateUniqueNonOverlappingTranscriptRanges(transcript, fullRevision.sentencePairs.map(({ originalText }) => originalText))) return false
  if (fullRevision.logicIssues.some(({ originalText, contextBefore, contextAfter }) => (
    !hasOrderedTranscriptContext(transcript, originalText, contextBefore, contextAfter)
  ))) return false

  const correctedText = rebuildTranscriptFromEdits(transcript, fullRevision.sentencePairs.map(({ originalText, correctedText: replacementText }) => ({ originalText, replacementText })))
  const improvedText = rebuildTranscriptFromEdits(transcript, fullRevision.sentencePairs.map(({ originalText, improvedText: replacementText }) => ({ originalText, replacementText })))
  if (correctedText !== fullRevision.correctedText || improvedText !== fullRevision.improvedText) return false

  const publicIssueIds = [...result.issues.map(({ id }) => id), ...fullRevision.logicIssues.map(({ id }) => id)]
  const knownIssueIds = new Set(publicIssueIds)
  if (knownIssueIds.size !== publicIssueIds.length) return false
  const linkedItems = [...result.sentenceRevisions, ...fullRevision.sentencePairs]
  if (linkedItems.some(({ relatedIssueIds }) => relatedIssueIds.some((id) => !knownIssueIds.has(id)))) return false

  if (result.legibilityIssues.some(({ possibleReadings }) => (
    !hasDistinctNormalizedText(possibleReadings) || possibleReadings.some((reading) => !isWellFormedUnicode(reading))
  ))) return false

  const legibilityQuotes = result.legibilityIssues.map(({ transcriptText }) => transcriptText)
  if (legibilityQuotes.length > 0) {
    const legibilityDimension = result.dimensionScores.find(({ dimensionId }) => dimensionId === 'legibility')
    if (!legibilityDimension || legibilityDimension.score >= legibilityDimension.maxScore) return false
    if (!rangesOverlapAny(transcript, [legibilityDimension.evidence], legibilityQuotes)) return false
    const nonLegibilityQuotes = [
      ...result.dimensionScores.filter(({ dimensionId }) => dimensionId !== 'legibility').map(({ evidence }) => evidence),
      ...result.issues.map(({ originalText }) => originalText),
      ...result.sentenceRevisions.map(({ originalText }) => originalText),
      ...result.expressionUpgrades.map(({ originalText }) => originalText),
      ...fullRevision.sentencePairs.map(({ originalText }) => originalText),
      ...fullRevision.logicIssues.flatMap(({ originalText, contextBefore, contextAfter }) => (
        [originalText, ...(contextBefore ? [contextBefore] : []), ...(contextAfter ? [contextAfter] : [])]
      )),
    ]
    if (rangesOverlapAny(transcript, nonLegibilityQuotes, legibilityQuotes)) return false
    const nonLegibilityNarratives = [
      ...result.dimensionScores.filter(({ dimensionId }) => dimensionId !== 'legibility').flatMap(({ reason, evidence }) => [reason, evidence]),
      result.overallComment,
      ...result.issues.flatMap(({ suggestion, explanation }) => [suggestion, explanation]),
      ...fullRevision.logicNotes,
      ...fullRevision.logicIssues.flatMap(({ diagnosis, conservativeSuggestion, polishedSuggestion }) => [diagnosis, conservativeSuggestion, polishedSuggestion]),
      ...result.sentenceRevisions.flatMap(({ revisedText, note }) => [revisedText, note]),
      ...fullRevision.sentencePairs.flatMap(({ correctedText, improvedText, explanation }) => [correctedText, improvedText, explanation]),
      ...result.expressionUpgrades.flatMap(({ upgradedText, note }) => [upgradedText, note]),
    ]
    if (nonLegibilityNarratives.some((value) => narrativeExplicitlyReferencesLocalLegibility(value, result.legibilityIssues))) return false
  }

  if (!reviewStateIsConsistent(result)) return false
  if (expected.inputMode === 'confirmed_text') {
    return expected.pageCount === 0
      && typeof expected.confirmedTranscript === 'string'
      && isWellFormedUnicode(expected.confirmedTranscript)
      && transcript === expected.confirmedTranscript
      && result.recognitionWarnings.length === 0
      && result.legibilityIssues.length === 0
      && result.printedTextExcluded === true
  }
  return Number.isInteger(expected.pageCount)
    && expected.pageCount >= 1
    && expected.pageCount <= 10
    && expected.confirmedTranscript === undefined
    && result.legibilityIssues.every(({ pageNumber }) => pageNumber <= expected.pageCount)
}
