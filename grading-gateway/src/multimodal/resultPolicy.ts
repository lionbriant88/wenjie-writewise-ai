import type {
  RawLegibilityIssueV1,
  RawLogicIssueV1,
  RawMultimodalIssueV1,
  RawSentencePairV1,
  RawSentenceRevisionV1,
} from './types.js'

export interface ResultPolicyInput {
  issues: RawMultimodalIssueV1[]
  sentenceRevisions: RawSentenceRevisionV1[]
  sentencePairs: RawSentencePairV1[]
  logicIssues: RawLogicIssueV1[]
  legibilityIssues: RawLegibilityIssueV1[]
  dimensionReasons: string[]
  overallComment: string
  logicNotes: string[]
  logicNoteRecords?: Array<{ quote: string; note: string }>
}

export interface ResultPolicyOutcome extends ResultPolicyInput {
  correctedText: string
  reviewReasons: string[]
}

export interface CorrectedTextEdit {
  originalText: string
  correctedText: string
}

interface LocatedEdit extends CorrectedTextEdit {
  start: number
  end: number
}

function uniqueIndex(source: string, quote: string): number | null {
  if (!quote || !quote.trim()) return null
  const start = source.indexOf(quote)
  if (start < 0 || source.indexOf(quote, start + 1) >= 0) return null
  return start
}

function hasUniqueKeys(keys: string[]): boolean {
  return keys.every((key) => key.trim().length > 0) && new Set(keys).size === keys.length
}

function filteredSpellingLeaks(issue: RawMultimodalIssueV1, input: ResultPolicyInput): boolean {
  const containsBoth = (value: string) => value.includes(issue.originalText) && value.includes(issue.suggestion)
  const logicNarratives = input.logicIssues.flatMap((logicIssue) => [
    logicIssue.originalText,
    logicIssue.contextBefore,
    logicIssue.contextAfter,
    logicIssue.diagnosis,
    logicIssue.conservativeSuggestion,
    logicIssue.polishedSuggestion,
  ])
  const logicNoteNarratives = input.logicNoteRecords?.flatMap(({ quote, note }) => [quote, note]) ?? []
  return input.dimensionReasons.some(containsBoth)
    || containsBoth(input.overallComment)
    || input.logicNotes.some(containsBoth)
    || logicNarratives.some(containsBoth)
    || logicNoteNarratives.some(containsBoth)
}

function revisionKeysAreKnown(revision: RawSentenceRevisionV1 | RawSentencePairV1, allIssueKeys: Set<string>): boolean {
  return revision.relatedIssueKeys.length > 0
    && new Set(revision.relatedIssueKeys).size === revision.relatedIssueKeys.length
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

function hasSafeEditLocations(transcript: string, edits: Array<{ originalText: string }>): boolean {
  const ranges: Array<{ start: number; end: number }> = []
  for (const edit of edits) {
    const start = uniqueIndex(transcript, edit.originalText)
    if (start === null) return false
    const end = start + edit.originalText.length
    if (ranges.some((range) => start < range.end && end > range.start)) return false
    ranges.push({ start, end })
  }
  return true
}

export function rebuildCorrectedText(transcript: string, edits: CorrectedTextEdit[]): string | null {
  const located: LocatedEdit[] = []
  for (const edit of edits) {
    if (!edit.correctedText || !edit.correctedText.trim()) return null
    const start = uniqueIndex(transcript, edit.originalText)
    if (start === null) return null
    const end = start + edit.originalText.length
    if (located.some((other) => start < other.end && end > other.start)) return null
    located.push({ ...edit, start, end })
  }
  return located
    .sort((left, right) => right.start - left.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.correctedText + result.slice(edit.end), transcript)
}

export function applyResultPolicy(raw: ResultPolicyInput, transcript: string): ResultPolicyOutcome | null {
  const allKeyValues = [
    ...raw.issues.map(({ issueKey }) => issueKey),
    ...raw.logicIssues.map(({ issueKey }) => issueKey),
    ...raw.legibilityIssues.map(({ issueKey }) => issueKey),
  ]
  if (!hasUniqueKeys(allKeyValues)) return null

  const allIssueKeys = new Set(raw.issues.map(({ issueKey }) => issueKey))
  const filteredSpelling = raw.issues.filter((issue) => (
    issue.type === 'spelling' && (issue.evidenceCertainty !== 'certain' || issue.requiresTeacherReview)
  ))
  if (filteredSpelling.some((issue) => filteredSpellingLeaks(issue, raw))) return null

  if (raw.issues.some((issue) => uniqueIndex(transcript, issue.originalText) === null)) return null
  if (raw.logicIssues.some((issue) => uniqueIndex(transcript, issue.originalText) === null)) return null
  if (raw.logicNoteRecords?.some((note) => uniqueIndex(transcript, note.quote) === null)) return null

  const legibilityQuotes = new Set<string>()
  for (const issue of raw.legibilityIssues) {
    if (uniqueIndex(transcript, issue.transcriptText) === null) return null
    legibilityQuotes.add(issue.transcriptText)
  }

  const keptIssues = raw.issues.filter((issue) => (
    (issue.type !== 'spelling' || (issue.evidenceCertainty === 'certain' && issue.requiresTeacherReview === false))
    && !(['grammar', 'word_choice'].includes(issue.type) && legibilityQuotes.has(issue.originalText))
  ))
  const keptKeys = new Set(keptIssues.map((issue) => issue.issueKey))
  const keptCertainSpellingKeys = new Set(keptIssues
    .filter((issue) => issue.type === 'spelling' && issue.evidenceCertainty === 'certain')
    .map((issue) => issue.issueKey))

  const revisions = [...raw.sentenceRevisions, ...raw.sentencePairs]
  if (revisions.some((revision) => (
    revision.changeTypes.length === 0
    || uniqueIndex(transcript, revision.originalText) === null
    || !revisionKeysAreKnown(revision, allIssueKeys)
  ))) return null

  const keptSentenceRevisions = raw.sentenceRevisions.filter((revision) => revisionIsAllowed(revision, keptKeys, keptCertainSpellingKeys))
  const keptSentencePairs = raw.sentencePairs.filter((pair) => revisionIsAllowed(pair, keptKeys, keptCertainSpellingKeys))
  if (!hasSafeEditLocations(transcript, keptSentenceRevisions) || !hasSafeEditLocations(transcript, keptSentencePairs)) return null

  const keptLogicIssues = raw.logicIssues.filter((issue) => !legibilityQuotes.has(issue.originalText))

  const correctedText = rebuildCorrectedText(transcript, keptSentencePairs)
  if (correctedText === null) return null

  return {
    ...raw,
    issues: keptIssues,
    sentenceRevisions: keptSentenceRevisions,
    sentencePairs: keptSentencePairs,
    logicIssues: keptLogicIssues,
    correctedText,
    reviewReasons: [],
  }
}
