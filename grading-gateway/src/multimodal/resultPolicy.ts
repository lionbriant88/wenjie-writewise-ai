import { exactUniqueTranscriptRange, transcriptRangesOverlap } from './transcriptRange.js'
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

function hasUniqueKeys(keys: string[]): boolean {
  return keys.every((key) => key.trim().length > 0) && new Set(keys).size === keys.length
}

function overlapsAny(range: TranscriptRange, blocked: TranscriptRange[]): boolean {
  return blocked.some((candidate) => transcriptRangesOverlap(range, candidate))
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value)
}

function containsTerm(value: string, term: string): boolean {
  let start = value.indexOf(term)
  while (start >= 0) {
    const end = start + term.length
    if (!isWordCharacter(value[start - 1]) && !isWordCharacter(value[end])) return true
    start = value.indexOf(term, start + 1)
  }
  return false
}

const FILTERED_REFERENCE_CUES = /\b(?:change|changed|correct|corrected|correction|form|handwriting|instead|misspell|misspelled|read|replace|should|spell|spelling|uncertain|unclear|word|written)\b|改为|拼写|应为|不清/iu

function explicitlyReferencesFilteredSpelling(
  value: string,
  filtered: RawMultimodalIssueV1[],
): boolean {
  return filtered.some(({ originalText, suggestion }) => {
    const mentionsOriginal = containsTerm(value, originalText)
    return mentionsOriginal || (containsTerm(value, suggestion) && FILTERED_REFERENCE_CUES.test(value))
  })
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
  const located: Array<TranscriptRange & { replacementText: string }> = []
  for (const edit of edits) {
    if (!edit.replacementText || !edit.replacementText.trim()) return null
    const range = exactUniqueTranscriptRange(transcript, edit.originalText)
    if (!range || overlapsAny(range, located)) return null
    located.push({ ...range, replacementText: edit.replacementText })
  }
  return located
    .sort((left, right) => right.start - left.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.replacementText + result.slice(edit.end), transcript)
}

function hasSafeEditLocations(transcript: string, edits: Array<{ originalText: string }>): boolean {
  const ranges: TranscriptRange[] = []
  for (const edit of edits) {
    const range = exactUniqueTranscriptRange(transcript, edit.originalText)
    if (!range || overlapsAny(range, ranges)) return false
    ranges.push(range)
  }
  return true
}

export function rebuildCorrectedText(transcript: string, edits: CorrectedTextEdit[]): string | null {
  return rebuildText(transcript, edits.map(({ originalText, correctedText }) => ({ originalText, replacementText: correctedText })))
}

export function applyResultPolicy(raw: ResultPolicyInput, transcript: string): ResultPolicyOutcome | null {
  if (raw.recognitionWarnings.some(({ scope, message }) => (
    (scope !== 'global_unreadable' && scope !== 'printed_boundary')
    || !message.trim()
    || message.length > 1_000
  ))) return null
  const allKeyValues = [
    ...raw.issues.map(({ issueKey }) => issueKey),
    ...raw.logicIssues.map(({ issueKey }) => issueKey),
    ...raw.legibilityIssues.map(({ issueKey }) => issueKey),
  ]
  if (!hasUniqueKeys(allKeyValues)) return null

  const allIssueKeys = new Set(allKeyValues)
  const rangesByKey = new Map<string, TranscriptRange>()
  const logicRangesByIssue = new Map<RawLogicIssueV1, TranscriptRange[]>()
  for (const issue of raw.issues) {
    const range = exactUniqueTranscriptRange(transcript, issue.originalText)
    if (!range) return null
    rangesByKey.set(issue.issueKey, range)
  }
  for (const issue of raw.logicIssues) {
    const originalRange = exactUniqueTranscriptRange(transcript, issue.originalText)
    if (!originalRange) return null
    const issueRanges = [originalRange]
    if (issue.contextBefore) {
      const beforeRange = exactUniqueTranscriptRange(transcript, issue.contextBefore)
      if (!beforeRange || beforeRange.end > originalRange.start) return null
      issueRanges.push(beforeRange)
    }
    if (issue.contextAfter) {
      const afterRange = exactUniqueTranscriptRange(transcript, issue.contextAfter)
      if (!afterRange || afterRange.start < originalRange.end) return null
      issueRanges.push(afterRange)
    }
    rangesByKey.set(issue.issueKey, originalRange)
    logicRangesByIssue.set(issue, issueRanges)
  }
  for (const issue of raw.legibilityIssues) {
    const range = exactUniqueTranscriptRange(transcript, issue.transcriptText)
    if (!range) return null
    rangesByKey.set(issue.issueKey, range)
  }

  const filteredSpelling = raw.issues.filter((issue) => (
    issue.type === 'spelling' && (issue.evidenceCertainty !== 'certain' || issue.requiresTeacherReview)
  ))
  const filteredSpellingKeys = new Set(filteredSpelling.map(({ issueKey }) => issueKey))
  const filteredSpellingRanges = filteredSpelling.map(({ issueKey }) => rangesByKey.get(issueKey)!)
  const legibilityKeys = new Set(raw.legibilityIssues.map(({ issueKey }) => issueKey))
  const legibilityRanges = raw.legibilityIssues.map(({ issueKey }) => rangesByKey.get(issueKey)!)
  const contaminatedRanges = [...filteredSpellingRanges, ...legibilityRanges]

  const keptIssues = raw.issues.filter((issue) => (
    !filteredSpellingKeys.has(issue.issueKey)
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
    if (revision.changeTypes.length === 0 || !range || !revisionKeysAreKnown(revision, allIssueKeys)) return null
    revisionRanges.set(revision, range)
  }
  const keepRevision = (revision: RawSentenceRevisionV1 | RawSentencePairV1) => (
    !overlapsAny(revisionRanges.get(revision)!, contaminatedRanges)
    && revisionIsAllowed(revision, keptKeys, keptCertainSpellingKeys)
  )
  const keptSentenceRevisions = raw.sentenceRevisions.filter(keepRevision)
  const keptSentencePairs = raw.sentencePairs.filter(keepRevision)
  if (!hasSafeEditLocations(transcript, keptSentenceRevisions) || !hasSafeEditLocations(transcript, keptSentencePairs)) return null

  const upgradeRanges = new Map<RawExpressionUpgradeV1, TranscriptRange>()
  for (const upgrade of raw.expressionUpgrades) {
    const range = exactUniqueTranscriptRange(transcript, upgrade.originalText)
    if (!range) return null
    upgradeRanges.set(upgrade, range)
  }
  const keptExpressionUpgrades = raw.expressionUpgrades.filter((upgrade) => !overlapsAny(upgradeRanges.get(upgrade)!, contaminatedRanges))

  const keptLogicNoteRecords: Array<{ quote: string; note: string }> = []
  for (const record of raw.logicNoteRecords ?? []) {
    const range = exactUniqueTranscriptRange(transcript, record.quote)
    if (!range) return null
    if (!overlapsAny(range, contaminatedRanges)) keptLogicNoteRecords.push(record)
  }
  const keptLogicNotes = raw.logicNoteRecords ? keptLogicNoteRecords.map(({ note }) => note) : raw.logicNotes

  if (!hasUniqueKeys(raw.dimensionScores.map(({ dimensionId }) => dimensionId))) return null
  for (const dimension of raw.dimensionScores) {
    if (!hasUniqueKeys(dimension.relatedIssueKeys) || !dimension.relatedIssueKeys.every((key) => allIssueKeys.has(key))) return null
    const evidenceRange = exactUniqueTranscriptRange(transcript, dimension.evidence)
    if (!evidenceRange) return null
    const atMaximum = dimension.score === dimension.maxScore
    if ((atMaximum && dimension.relatedIssueKeys.length > 0) || (!atMaximum && dimension.relatedIssueKeys.length === 0)) return null
    if (dimension.relatedIssueKeys.some((key) => filteredSpellingKeys.has(key) || !keptKeys.has(key))) return null
    if (overlapsAny(evidenceRange, filteredSpellingRanges)) return null
    if (dimension.dimensionId === 'legibility') {
      if (dimension.relatedIssueKeys.some((key) => !legibilityKeys.has(key))) return null
    } else if (dimension.relatedIssueKeys.some((key) => legibilityKeys.has(key)) || overlapsAny(evidenceRange, legibilityRanges)) {
      return null
    }
  }
  if (raw.legibilityIssues.length > 0) {
    const legibilityDimension = raw.dimensionScores.find(({ dimensionId }) => dimensionId === 'legibility')
    if (!legibilityDimension || legibilityDimension.score >= legibilityDimension.maxScore) return null
    if (raw.legibilityIssues.some(({ issueKey }) => !legibilityDimension.relatedIssueKeys.includes(issueKey))) return null
    const evidenceRange = exactUniqueTranscriptRange(transcript, legibilityDimension.evidence)!
    if (!overlapsAny(evidenceRange, legibilityRanges)) return null
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
  ]
  if (narratives.some((value) => explicitlyReferencesFilteredSpelling(value, filteredSpelling))) return null

  const legibilityWords = raw.legibilityIssues.map(({ transcriptText }) => transcriptText)
  const leaksLegibility = (value: string) => legibilityWords.some((word) => value.includes(word))
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
  if (legibilityWords.length > 0 && nonLegibilityNarratives.some(leaksLegibility)) return null

  const correctedText = rebuildText(transcript, keptSentencePairs.map(({ originalText, correctedText }) => ({ originalText, replacementText: correctedText })))
  const improvedText = rebuildText(transcript, keptSentencePairs.map(({ originalText, improvedText }) => ({ originalText, replacementText: improvedText })))
  if (correctedText === null || improvedText === null) return null

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
