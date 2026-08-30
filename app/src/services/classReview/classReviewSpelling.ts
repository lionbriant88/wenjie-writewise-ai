import type {
  ErrorAnnotation,
  FullTextSentencePair,
  LegibilityIssue,
  LogicIssue,
  SentenceRevision,
} from '../../types'

const SPELLING_FINGERPRINT_VERSION = 'class-review-spelling-v1'
const MAX_SPELLING_TOKEN_CODE_POINTS = 128
const ENGLISH_TOKEN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/

export interface SpellingCandidateInput {
  candidate: ErrorAnnotation
  errorAnnotations: readonly ErrorAnnotation[]
  sentenceRevisions: readonly SentenceRevision[]
  sentencePairs: readonly FullTextSentencePair[]
  logicIssues: readonly LogicIssue[]
  recognitionWarnings: readonly string[]
  legibilityIssues: readonly LegibilityIssue[]
}

export interface DefiniteSpellingItem {
  fingerprint: string
  sourceSubtype: 'spelling' | 'word_choice'
  originalWord: string
  correctedWord: string
  sourceAssociation: {
    kind: 'sentence_revision' | 'sentence_pair'
    id: string
  }
}

type AlignedCorrection = {
  kind: DefiniteSpellingItem['sourceAssociation']['kind']
  id: string
  relatedErrorIds: readonly string[]
  original: string
  corrected: string
  changeTypes: readonly string[]
  needsTeacherReview?: boolean
}

function normalizeVisible(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function normalizeForComparison(value: string): string {
  return normalizeVisible(value).toLocaleLowerCase('en-US')
}

function isEnglishTokenCodePoint(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z'’-]/u.test(value)
}

function containsAtTokenBoundary(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false
  let start = haystack.indexOf(needle)
  while (start >= 0) {
    const before = start > 0 ? haystack[start - 1] : undefined
    const afterIndex = start + needle.length
    const after = afterIndex < haystack.length ? haystack[afterIndex] : undefined
    if (!isEnglishTokenCodePoint(before) && !isEnglishTokenCodePoint(after)) return true
    start = haystack.indexOf(needle, start + 1)
  }
  return false
}

function sourceLocationsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeForComparison(left)
  const normalizedRight = normalizeForComparison(right)
  return normalizedLeft === normalizedRight
    || containsAtTokenBoundary(normalizedLeft, normalizedRight)
    || containsAtTokenBoundary(normalizedRight, normalizedLeft)
}

function isBoundedEnglishToken(value: string): boolean {
  return Array.from(value).length <= MAX_SPELLING_TOKEN_CODE_POINTS && ENGLISH_TOKEN.test(value)
}

export function unrestrictedDamerauLevenshteinV1(left: string, right: string): number {
  const source = Array.from(left)
  const target = Array.from(right)
  const sourceLength = source.length
  const targetLength = target.length
  const maximumDistance = sourceLength + targetLength
  const distances = Array.from(
    { length: sourceLength + 2 },
    () => Array<number>(targetLength + 2).fill(0),
  )
  const lastRowByCodePoint = new Map<string, number>()

  distances[0][0] = maximumDistance
  for (let sourceIndex = 0; sourceIndex <= sourceLength; sourceIndex += 1) {
    distances[sourceIndex + 1][0] = maximumDistance
    distances[sourceIndex + 1][1] = sourceIndex
  }
  for (let targetIndex = 0; targetIndex <= targetLength; targetIndex += 1) {
    distances[0][targetIndex + 1] = maximumDistance
    distances[1][targetIndex + 1] = targetIndex
  }

  for (let sourceIndex = 1; sourceIndex <= sourceLength; sourceIndex += 1) {
    let lastMatchingTargetColumn = 0
    for (let targetIndex = 1; targetIndex <= targetLength; targetIndex += 1) {
      const lastMatchingSourceRow = lastRowByCodePoint.get(target[targetIndex - 1]) ?? 0
      const previousMatchingTargetColumn = lastMatchingTargetColumn
      let substitutionCost = 1
      if (source[sourceIndex - 1] === target[targetIndex - 1]) {
        substitutionCost = 0
        lastMatchingTargetColumn = targetIndex
      }

      distances[sourceIndex + 1][targetIndex + 1] = Math.min(
        distances[sourceIndex][targetIndex] + substitutionCost,
        distances[sourceIndex + 1][targetIndex] + 1,
        distances[sourceIndex][targetIndex + 1] + 1,
        distances[lastMatchingSourceRow][previousMatchingTargetColumn]
          + (sourceIndex - lastMatchingSourceRow - 1)
          + 1
          + (targetIndex - previousMatchingTargetColumn - 1),
      )
    }
    lastRowByCodePoint.set(source[sourceIndex - 1], sourceIndex)
  }

  return distances[sourceLength + 1][targetLength + 1]
}

function allCorrections(input: SpellingCandidateInput): AlignedCorrection[] {
  const revisions = input.sentenceRevisions
    .map<AlignedCorrection>((item) => ({
      kind: 'sentence_revision',
      id: item.id,
      relatedErrorIds: item.relatedErrorIds,
      original: item.original,
      corrected: item.revised,
      changeTypes: item.changeTypes,
      needsTeacherReview: item.needsTeacherReview,
    }))
  const pairs = input.sentencePairs
    .map<AlignedCorrection>((item) => ({
      kind: 'sentence_pair',
      id: item.id,
      relatedErrorIds: item.relatedErrorIds,
      original: item.original,
      corrected: item.corrected,
      changeTypes: item.changeTypes,
      needsTeacherReview: item.needsTeacherReview,
    }))
  return [...revisions, ...pairs]
}

function alignedCorrections(input: SpellingCandidateInput): AlignedCorrection[] {
  return allCorrections(input).filter((item) => item.relatedErrorIds.includes(input.candidate.id))
}

function overlapsLogic(input: SpellingCandidateInput, association: AlignedCorrection): boolean {
  return input.logicIssues.some((logicIssue) => (
    logicIssue.sentenceId === association.id
    || sourceLocationsOverlap(logicIssue.original, association.original)
  ))
}

function overlapsConflictingLexicalEvidence(
  input: SpellingCandidateInput,
  association: AlignedCorrection,
): boolean {
  const conflictingTypes = input.candidate.type === 'spelling'
    ? new Set<ErrorAnnotation['type']>(['grammar', 'word_choice', 'structure'])
    : new Set<ErrorAnnotation['type']>(['grammar', 'spelling', 'structure'])

  return input.errorAnnotations.some((issue) => {
    if (issue.id === input.candidate.id || !conflictingTypes.has(issue.type)) return false
    if (sourceLocationsOverlap(issue.original, association.original)) return true

    const linkedSources = [
      ...input.sentenceRevisions
        .filter((revision) => revision.relatedErrorIds.includes(issue.id))
        .map((revision) => revision.original),
      ...input.sentencePairs
        .filter((pair) => pair.relatedErrorIds.includes(issue.id))
        .map((pair) => pair.original),
    ]
    return linkedSources.some((source) => sourceLocationsOverlap(source, association.original))
  })
}

function overlapsAnotherCorrectionAssociation(
  input: SpellingCandidateInput,
  association: AlignedCorrection,
): boolean {
  return allCorrections(input).some((candidate) => (
    (candidate.kind !== association.kind || candidate.id !== association.id)
    && sourceLocationsOverlap(candidate.original, association.original)
  ))
}

export function classifyDefiniteSpellingCandidate(
  input: SpellingCandidateInput,
): DefiniteSpellingItem | null {
  const { candidate } = input
  if (candidate.type !== 'spelling' && candidate.type !== 'word_choice') return null
  if (candidate.evidenceCertainty !== 'certain' || candidate.needsTeacherReview === true) return null
  if (input.recognitionWarnings.length > 0 || input.legibilityIssues.length > 0) return null
  if (input.errorAnnotations.filter((issue) => issue.id === candidate.id).length !== 1) return null

  const originalWord = normalizeVisible(candidate.original)
  const correctedWord = normalizeVisible(candidate.suggestion)
  const normalizedOriginal = normalizeForComparison(originalWord)
  const normalizedCorrection = normalizeForComparison(correctedWord)
  if (!isBoundedEnglishToken(originalWord) || !isBoundedEnglishToken(correctedWord)) return null
  if (normalizedOriginal === normalizedCorrection) return null

  if (candidate.type === 'word_choice') {
    const maximumLength = Math.max(
      Array.from(normalizedOriginal).length,
      Array.from(normalizedCorrection).length,
    )
    if (maximumLength < 4) return null
    const maximumDistance = Math.min(2, Math.floor(maximumLength / 3))
    if (
      unrestrictedDamerauLevenshteinV1(normalizedOriginal, normalizedCorrection)
      > maximumDistance
    ) return null
  }

  const associations = alignedCorrections(input)
  if (associations.length !== 1) return null
  const association = associations[0]
  if (association.needsTeacherReview === true) return null
  if (association.relatedErrorIds.length !== 1 || association.relatedErrorIds[0] !== candidate.id) {
    return null
  }
  if (
    association.changeTypes.length !== 1
    || association.changeTypes[0] !== candidate.type
  ) return null
  if (
    normalizeForComparison(association.original) !== normalizedOriginal
    || normalizeForComparison(association.corrected) !== normalizedCorrection
  ) return null
  if (overlapsConflictingLexicalEvidence(input, association)) return null
  if (overlapsAnotherCorrectionAssociation(input, association)) return null
  if (overlapsLogic(input, association)) return null

  return {
    fingerprint: JSON.stringify([
      SPELLING_FINGERPRINT_VERSION,
      candidate.type,
      normalizedOriginal,
      normalizedCorrection,
    ]),
    sourceSubtype: candidate.type,
    originalWord,
    correctedWord,
    sourceAssociation: { kind: association.kind, id: association.id },
  }
}
