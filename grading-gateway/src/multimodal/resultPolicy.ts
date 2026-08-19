import {
  containsBoundedTerm,
  exactUniqueTranscriptRange,
  locateUniqueNonOverlappingTranscriptRanges,
  narrativeExplicitlyReferencesLocalLegibility,
  rebuildTranscriptFromEdits,
  transcriptRangesOverlap,
} from './transcriptRange.js'
import type { TranscriptRange } from './transcriptRange.js'
import type {
  RawDimensionScoreV1,
  RawExpressionUpgradeV1,
  RawLegibilityIssueV1,
  RawLogicIssueV1,
  RawMultimodalIssueV1,
  RawRecognitionWarningV1,
  RawSentencePairV1,
  RawSentenceRevisionV1,
} from './types.js'

export interface ResultPolicyInput {
  issues: RawMultimodalIssueV1[]
  sentenceRevisions: RawSentenceRevisionV1[]
  sentencePairs: RawSentencePairV1[]
  expressionUpgrades: RawExpressionUpgradeV1[]
  logicIssues: RawLogicIssueV1[]
  legibilityIssues: RawLegibilityIssueV1[]
  dimensionScores: RawDimensionScoreV1[]
  recognitionWarnings: RawRecognitionWarningV1[]
  overallComment: string
  logicNotes: string[]
  logicNoteRecords?: Array<{ quote: string; note: string }>
}

export interface ResultPolicyOutcome extends ResultPolicyInput {
  correctedText: string
  improvedText: string
  reviewReasons: string[]
}

export interface CorrectedTextEdit {
  originalText: string
  correctedText: string
}

export type ResultPolicyRejectionReason =
  | 'warning'
  | 'keys'
  | 'grounding_issue'
  | 'grounding_logic_original'
  | 'grounding_logic_before'
  | 'grounding_logic_after'
  | 'grounding_legibility'
  | 'grounding_upgrade'
  | 'grounding_logic_note'
  | 'revision'
  | 'dimension_ids'
  | 'dimension_links'
  | 'dimension_evidence_linked'
  | 'dimension_evidence_unlinked'
  | 'dimension_relation'
  | 'dimension_filtered'
  | 'dimension_legibility'
  | 'narrative'
  | 'rebuild'

export type ResultPolicyRejectionSink = (reason: ResultPolicyRejectionReason) => void

function hasUniqueKeys(keys: string[]): boolean {
  return keys.every((key) => key.trim().length > 0) && new Set(keys).size === keys.length
}

function overlapsAny(range: TranscriptRange, blocked: TranscriptRange[]): boolean {
  return blocked.some((candidate) => transcriptRangesOverlap(range, candidate))
}

const FILTERED_REFERENCE_CUES = /\b(?:ambiguous|ambiguity|change|changed|correct|corrected|correction|form|handwriting|illegible|instead|legibility|misspell|misspelled|read|readable|readability|reading|replace|replaced|should|spell|spelling|uncertain|unclear|unreadable|word|written)\b|改为|拼写|应为|字迹|辨认|可读|难辨|不清/iu

function explicitlyReferencesFilteredSpelling(
  value: string,
  filtered: RawMultimodalIssueV1[],
): boolean {
  return filtered.some(({ originalText, suggestion }) => {
    const mentionsOriginal = containsBoundedTerm(value, originalText)
    return mentionsOriginal || (containsBoundedTerm(value, suggestion) && FILTERED_REFERENCE_CUES.test(value))
  })
}

function explicitlyReferencesFilteredSpellingWithCue(
  value: string,
  filtered: RawMultimodalIssueV1[],
): boolean {
  if (!FILTERED_REFERENCE_CUES.test(value)) return false
  return filtered.some(({ originalText, suggestion }) => (
    containsBoundedTerm(value, originalText) || containsBoundedTerm(value, suggestion)
  ))
}

function revisionKeysAreKnown(revision: RawSentenceRevisionV1 | RawSentencePairV1, allIssueKeys: Set<string>): boolean {
  return hasUniqueKeys(revision.relatedIssueKeys)
    && revision.relatedIssueKeys.every((key) => allIssueKeys.has(key))
}

function revisionIsAllowed(
  revision: RawSentenceRevisionV1 | RawSentencePairV1,
  keptKeys: Set<string>,
  keptCertainSpellingKeys: Set<string>,
): boolean {
  return revision.relatedIssueKeys.every((key) => keptKeys.has(key))
    && (!revision.changeTypes.includes('spelling')
      || revision.relatedIssueKeys.some((key) => keptCertainSpellingKeys.has(key)))
}

function rebuildText(
  transcript: string,
  edits: Array<{ originalText: string; replacementText: string }>,
): string | null {
  return rebuildTranscriptFromEdits(transcript, edits)
}

function hasSafeEditLocations(transcript: string, edits: Array<{ originalText: string }>): boolean {
  return locateUniqueNonOverlappingTranscriptRanges(transcript, edits.map(({ originalText }) => originalText)) !== null
}

export function rebuildCorrectedText(transcript: string, edits: CorrectedTextEdit[]): string | null {
  return rebuildText(transcript, edits.map(({ originalText, correctedText }) => ({ originalText, replacementText: correctedText })))
}

export function applyResultPolicy(
  raw: ResultPolicyInput,
  transcript: string,
  onReject?: ResultPolicyRejectionSink,
): ResultPolicyOutcome | null {
  const reject = (reason: ResultPolicyRejectionReason): null => {
    try {
      onReject?.(reason)
    } catch {
      // Diagnostics must never change fail-closed policy behavior.
    }
    return null
  }
  if (raw.recognitionWarnings.some(({ scope, message }) => (
    (scope !== 'global_unreadable' && scope !== 'printed_boundary')
    || !message.trim()
    || message.length > 1_000
  ))) return reject('warning')
  const allKeyValues = [
    ...raw.issues.map(({ issueKey }) => issueKey),
    ...raw.logicIssues.map(({ issueKey }) => issueKey),
    ...raw.legibilityIssues.map(({ issueKey }) => issueKey),
  ]
  if (!hasUniqueKeys(allKeyValues)) return reject('keys')

  const allIssueKeys = new Set(allKeyValues)
  const rangesByKey = new Map<string, TranscriptRange>()
  const logicRangesByIssue = new Map<RawLogicIssueV1, TranscriptRange[]>()
  for (const issue of raw.issues) {
    const range = exactUniqueTranscriptRange(transcript, issue.originalText)
    if (!range) return reject('grounding_issue')
    rangesByKey.set(issue.issueKey, range)
  }
  for (const issue of raw.logicIssues) {
    const originalRange = exactUniqueTranscriptRange(transcript, issue.originalText)
    if (!originalRange) return reject('grounding_logic_original')
    const issueRanges = [originalRange]
    if (issue.contextBefore) {
      const beforeRange = exactUniqueTranscriptRange(transcript, issue.contextBefore)
      if (!beforeRange || beforeRange.end > originalRange.start) return reject('grounding_logic_before')
      issueRanges.push(beforeRange)
    }
    if (issue.contextAfter) {
      const afterRange = exactUniqueTranscriptRange(transcript, issue.contextAfter)
      if (!afterRange || afterRange.start < originalRange.end) return reject('grounding_logic_after')
      issueRanges.push(afterRange)
    }
    rangesByKey.set(issue.issueKey, originalRange)
    logicRangesByIssue.set(issue, issueRanges)
  }
  for (const issue of raw.legibilityIssues) {
    const range = exactUniqueTranscriptRange(transcript, issue.transcriptText)
    if (!range) return reject('grounding_legibility')
    rangesByKey.set(issue.issueKey, range)
  }

  const filteredSpelling = raw.issues.filter((issue) => (
    issue.type === 'spelling' && (issue.evidenceCertainty !== 'certain' || issue.requiresTeacherReview)
  ))
  const filteredSpellingKeys = new Set(filteredSpelling.map(({ issueKey }) => issueKey))
  const filteredSpellingRanges = filteredSpelling.map(({ issueKey }) => rangesByKey.get(issueKey)!)
  const nonSpellingRanges = raw.issues
    .filter(({ type }) => type !== 'spelling')
    .map(({ issueKey }) => rangesByKey.get(issueKey)!)
  const overlappingSpellingKeys = new Set(raw.issues
    .filter((issue) => issue.type === 'spelling' && overlapsAny(rangesByKey.get(issue.issueKey)!, nonSpellingRanges))
    .map(({ issueKey }) => issueKey))
  const legibilityKeys = new Set(raw.legibilityIssues.map(({ issueKey }) => issueKey))
  const legibilityRanges = raw.legibilityIssues.map(({ issueKey }) => rangesByKey.get(issueKey)!)
  const contaminatedRanges = [...filteredSpellingRanges, ...legibilityRanges]

  const keptIssues = raw.issues.filter((issue) => (
    !filteredSpellingKeys.has(issue.issueKey)
    && !overlappingSpellingKeys.has(issue.issueKey)
    && !overlapsAny(rangesByKey.get(issue.issueKey)!, contaminatedRanges)
  ))
  const keptLogicIssues = raw.logicIssues.filter((issue) => (
    !logicRangesByIssue.get(issue)!.some((range) => overlapsAny(range, contaminatedRanges))
  ))
  const keptKeys = new Set([
    ...keptIssues.map(({ issueKey }) => issueKey),
    ...keptLogicIssues.map(({ issueKey }) => issueKey),
    ...raw.legibilityIssues.map(({ issueKey }) => issueKey),
  ])
  const keptCertainSpellingKeys = new Set(keptIssues
    .filter((issue) => issue.type === 'spelling' && issue.evidenceCertainty === 'certain')
    .map(({ issueKey }) => issueKey))

  const revisions = [...raw.sentenceRevisions, ...raw.sentencePairs]
  const revisionRanges = new Map<RawSentenceRevisionV1 | RawSentencePairV1, TranscriptRange>()
  for (const revision of revisions) {
    const range = exactUniqueTranscriptRange(transcript, revision.originalText)
    if (revision.changeTypes.length === 0 || !range || !revisionKeysAreKnown(revision, allIssueKeys)) return reject('revision')
    revisionRanges.set(revision, range)
  }
  const keepRevision = (revision: RawSentenceRevisionV1 | RawSentencePairV1) => (
    !overlapsAny(revisionRanges.get(revision)!, contaminatedRanges)
    && revisionIsAllowed(revision, keptKeys, keptCertainSpellingKeys)
  )
  const keptSentenceRevisions = raw.sentenceRevisions.filter(keepRevision)
  const keptSentencePairs = raw.sentencePairs.filter(keepRevision)
  if (!hasSafeEditLocations(transcript, keptSentenceRevisions) || !hasSafeEditLocations(transcript, keptSentencePairs)) return reject('revision')

  const upgradeRanges = new Map<RawExpressionUpgradeV1, TranscriptRange>()
  for (const upgrade of raw.expressionUpgrades) {
    const range = exactUniqueTranscriptRange(transcript, upgrade.originalText)
    if (!range) return reject('grounding_upgrade')
    upgradeRanges.set(upgrade, range)
  }
  const keptExpressionUpgrades = raw.expressionUpgrades.filter((upgrade) => !overlapsAny(upgradeRanges.get(upgrade)!, contaminatedRanges))

  const keptLogicNoteRecords: Array<{ quote: string; note: string }> = []
  for (const record of raw.logicNoteRecords ?? []) {
    const range = exactUniqueTranscriptRange(transcript, record.quote)
    if (!range) return reject('grounding_logic_note')
    if (!overlapsAny(range, contaminatedRanges)) keptLogicNoteRecords.push(record)
  }
  const keptLogicNotes = raw.logicNoteRecords ? keptLogicNoteRecords.map(({ note }) => note) : raw.logicNotes

  if (!hasUniqueKeys(raw.dimensionScores.map(({ dimensionId }) => dimensionId))) return reject('dimension_ids')
  for (const dimension of raw.dimensionScores) {
    if (!hasUniqueKeys(dimension.relatedIssueKeys) || !dimension.relatedIssueKeys.every((key) => allIssueKeys.has(key))) return reject('dimension_links')
    const evidenceRange = exactUniqueTranscriptRange(transcript, dimension.evidence)
    if (!evidenceRange) return reject(dimension.relatedIssueKeys.length > 0
      ? 'dimension_evidence_linked'
      : 'dimension_evidence_unlinked')
    const atMaximum = dimension.score === dimension.maxScore
    if ((atMaximum && dimension.relatedIssueKeys.length > 0) || (!atMaximum && dimension.relatedIssueKeys.length === 0)) return reject('dimension_relation')
    if (dimension.relatedIssueKeys.some((key) => filteredSpellingKeys.has(key) || !keptKeys.has(key))) return reject('dimension_filtered')
    if (overlapsAny(evidenceRange, filteredSpellingRanges)) return reject('dimension_filtered')
    if (dimension.dimensionId === 'legibility') {
      if (dimension.relatedIssueKeys.some((key) => !legibilityKeys.has(key))) return reject('dimension_legibility')
    } else if (dimension.relatedIssueKeys.some((key) => legibilityKeys.has(key)) || overlapsAny(evidenceRange, legibilityRanges)) {
      return reject('dimension_legibility')
    }
  }
  if (raw.legibilityIssues.length > 0) {
    const legibilityDimension = raw.dimensionScores.find(({ dimensionId }) => dimensionId === 'legibility')
    if (!legibilityDimension || legibilityDimension.score >= legibilityDimension.maxScore) return reject('dimension_legibility')
    if (raw.legibilityIssues.some(({ issueKey }) => !legibilityDimension.relatedIssueKeys.includes(issueKey))) return reject('dimension_legibility')
    const evidenceRange = exactUniqueTranscriptRange(transcript, legibilityDimension.evidence)!
    if (!overlapsAny(evidenceRange, legibilityRanges)) return reject('dimension_legibility')
  }

  const narratives = [
    ...raw.dimensionScores.flatMap(({ reason, evidence }) => [reason, evidence]),
    raw.overallComment,
    ...keptIssues.flatMap(({ suggestion, explanation }) => [suggestion, explanation]),
    ...keptLogicNotes,
    ...keptLogicIssues.flatMap((issue) => [issue.diagnosis, issue.conservativeSuggestion, issue.polishedSuggestion]),
    ...keptSentenceRevisions.flatMap(({ revisedText, note }) => [revisedText, note]),
    ...keptSentencePairs.flatMap(({ correctedText, improvedText, explanation }) => [correctedText, improvedText, explanation]),
    ...keptExpressionUpgrades.flatMap(({ upgradedText, note }) => [upgradedText, note]),
    ...raw.legibilityIssues.flatMap(({ transcriptText, possibleReadings, regionDescription, explanation }) => (
      [transcriptText, ...possibleReadings, regionDescription, explanation]
    )),
  ]
  if (narratives.some((value) => explicitlyReferencesFilteredSpelling(value, filteredSpelling))) return reject('narrative')
  if (raw.recognitionWarnings.some(({ message }) => explicitlyReferencesFilteredSpellingWithCue(message, filteredSpelling))) return reject('narrative')

  const nonLegibilityNarratives = [
    ...raw.dimensionScores.filter(({ dimensionId }) => dimensionId !== 'legibility').flatMap(({ reason, evidence }) => [reason, evidence]),
    raw.overallComment,
    ...keptIssues.flatMap(({ suggestion, explanation }) => [suggestion, explanation]),
    ...keptLogicNotes,
    ...keptLogicIssues.flatMap((issue) => [issue.diagnosis, issue.conservativeSuggestion, issue.polishedSuggestion]),
    ...keptSentenceRevisions.flatMap(({ revisedText, note }) => [revisedText, note]),
    ...keptSentencePairs.flatMap(({ correctedText, improvedText, explanation }) => [correctedText, improvedText, explanation]),
    ...keptExpressionUpgrades.flatMap(({ upgradedText, note }) => [upgradedText, note]),
  ]
  if (raw.legibilityIssues.length > 0 && nonLegibilityNarratives.some((value) => narrativeExplicitlyReferencesLocalLegibility(value, raw.legibilityIssues))) return reject('narrative')

  const correctedText = rebuildText(transcript, keptSentencePairs.map(({ originalText, correctedText }) => ({ originalText, replacementText: correctedText })))
  const improvedText = rebuildText(transcript, keptSentencePairs.map(({ originalText, improvedText }) => ({ originalText, replacementText: improvedText })))
  if (correctedText === null || improvedText === null) return reject('rebuild')

  return {
    ...raw,
    issues: keptIssues,
    sentenceRevisions: keptSentenceRevisions,
    sentencePairs: keptSentencePairs,
    expressionUpgrades: keptExpressionUpgrades,
    logicIssues: keptLogicIssues,
    logicNotes: keptLogicNotes,
    ...(raw.logicNoteRecords ? { logicNoteRecords: keptLogicNoteRecords } : {}),
    correctedText,
    improvedText,
    reviewReasons: [],
  }
}
