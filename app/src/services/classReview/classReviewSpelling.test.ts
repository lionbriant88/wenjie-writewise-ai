import { describe, expect, it } from 'vitest'
import type {
  ErrorAnnotation,
  FullTextChangeType,
  FullTextSentencePair,
  SentenceRevision,
} from '../../types'
import {
  classifyDefiniteSpellingCandidate,
  unrestrictedDamerauLevenshteinV1,
} from './classReviewSpelling'

function lexicalIssue(
  original: string,
  suggestion: string,
  type: 'spelling' | 'word_choice' | 'grammar' = 'spelling',
  overrides: Partial<ErrorAnnotation> = {},
): ErrorAnnotation {
  return {
    id: 'issue-1',
    type,
    original,
    suggestion,
    explanation: 'Synthetic lexical evidence.',
    severity: 'low',
    evidenceCertainty: 'certain',
    ...overrides,
  }
}

function revision(
  original: string,
  revised: string,
  changeTypes: FullTextChangeType[],
  overrides: Partial<SentenceRevision> = {},
): SentenceRevision {
  return {
    id: 'revision-1',
    relatedErrorIds: ['issue-1'],
    original,
    revised,
    note: '',
    changeTypes,
    ...overrides,
  }
}

function pair(
  original: string,
  corrected: string,
  changeTypes: FullTextChangeType[],
  overrides: Partial<FullTextSentencePair> = {},
): FullTextSentencePair {
  return {
    id: 'pair-1',
    relatedErrorIds: ['issue-1'],
    original,
    corrected,
    polished: corrected,
    changeTypes,
    explanation: '',
    ...overrides,
  }
}

function classify(
  candidate: ErrorAnnotation,
  options: {
    errorAnnotations?: ErrorAnnotation[]
    sentenceRevisions?: SentenceRevision[]
    sentencePairs?: FullTextSentencePair[]
    recognitionWarnings?: string[]
    legibilityIssues?: Array<{
      id: string
      transcriptText: string
      possibleReadings: string[]
      pageNumber: number
      regionDescription: string
      explanation: string
      defaultOutcome: 'count_as_legibility_error'
    }>
    logicIssues?: Array<{
      id: string
      sentenceId?: string
      original: string
      contextBefore: string
      contextAfter: string
      subType: 'unclear_logic'
      severity: 'medium'
      diagnosis: string
      suggestedAction: 'ask_student_to_explain'
      conservativeSuggestion: string
      polishedSuggestion: string
      needsTeacherReview: boolean
    }>
  } = {},
) {
  return classifyDefiniteSpellingCandidate({
    candidate,
    errorAnnotations: options.errorAnnotations ?? [candidate],
    sentenceRevisions: options.sentenceRevisions ?? [
      revision(candidate.original, candidate.suggestion, [candidate.type as FullTextChangeType]),
    ],
    sentencePairs: options.sentencePairs ?? [],
    recognitionWarnings: options.recognitionWarnings ?? [],
    legibilityIssues: options.legibilityIssues ?? [],
    logicIssues: options.logicIssues ?? [],
  })
}

describe('classifyDefiniteSpellingCandidate', () => {
  it('accepts a certain spelling issue with one exact sentence revision', () => {
    const item = classify(lexicalIssue('feelling', 'feeling'))

    expect(item).toMatchObject({
      sourceSubtype: 'spelling',
      originalWord: 'feelling',
      correctedWord: 'feeling',
      sourceAssociation: { kind: 'sentence_revision', id: 'revision-1' },
    })
  })

  it('accepts a certain near-form word choice with one exact sentence pair', () => {
    const candidate = lexicalIssue('filling', 'feeling', 'word_choice')
    const item = classify(candidate, {
      sentenceRevisions: [],
      sentencePairs: [pair('filling', 'feeling', ['word_choice'])],
    })

    expect(item).toMatchObject({
      sourceSubtype: 'word_choice',
      originalWord: 'filling',
      correctedWord: 'feeling',
      sourceAssociation: { kind: 'sentence_pair', id: 'pair-1' },
    })
  })

  it.each([
    ['form', 'from', true],
    ['abcd', 'abcx', true],
    ['abcd', 'abxy', false],
    ['abcdef', 'abcdxy', true],
    ['abcdef', 'abcxyz', false],
    ['abcdefghi', 'abcdefgxy', true],
    ['abcdefghi', 'abcdefxyz', false],
  ])('applies the exact near-form boundary for %s -> %s', (original, corrected, accepted) => {
    const candidate = lexicalIssue(original, corrected, 'word_choice')
    expect(classify(candidate) !== null).toBe(accepted)
  })

  it('uses unrestricted Damerau-Levenshtein over Unicode code points', () => {
    expect(unrestrictedDamerauLevenshteinV1('CA', 'ABC')).toBe(2)
    expect(unrestrictedDamerauLevenshteinV1('a😀b', 'ab😀')).toBe(1)
  })

  it.each([
    ['missing association', { sentenceRevisions: [], sentencePairs: [] }],
    ['two associations', {
      sentenceRevisions: [revision('feelling', 'feeling', ['spelling'])],
      sentencePairs: [pair('feelling', 'feeling', ['spelling'])],
    }],
    ['different target', {
      sentenceRevisions: [revision('feelling', 'feelings', ['spelling'])],
    }],
    ['multiple targets', {
      sentenceRevisions: [
        revision('feelling', 'feeling', ['spelling'], { relatedErrorIds: ['issue-1', 'issue-2'] }),
      ],
      errorAnnotations: [
        lexicalIssue('feelling', 'feeling'),
        lexicalIssue('feelling', 'feeling', 'grammar', { id: 'issue-2' }),
      ],
    }],
    ['presentation overlap', {
      sentenceRevisions: [revision('feelling', 'feeling', ['spelling', 'sentence_upgrade'])],
    }],
  ])('rejects %s', (_label, options) => {
    expect(classify(lexicalIssue('feelling', 'feeling'), options)).toBeNull()
  })

  it.each([
    lexicalIssue('feelling', 'feeling', 'spelling', { evidenceCertainty: 'uncertain' }),
    lexicalIssue('feelling', 'feeling', 'spelling', { needsTeacherReview: true }),
  ])('rejects uncertain or review-required issue evidence', (candidate) => {
    expect(classify(candidate)).toBeNull()
  })

  it('rejects review-required aligned corrections', () => {
    const candidate = lexicalIssue('feelling', 'feeling')
    expect(classify(candidate, {
      sentenceRevisions: [revision('feelling', 'feeling', ['spelling'], { needsTeacherReview: true })],
    })).toBeNull()
  })

  it.each([
    ['attached punctuation', lexicalIssue('feelling,', 'feeling')],
    ['case-only change', lexicalIssue('Feeling', 'feeling')],
    ['multi-token change', lexicalIssue('feel good', 'feeling good')],
    ['sentence change', lexicalIssue('I feel good.', 'I am feeling good.')],
    ['short near-form', lexicalIssue('cat', 'cut', 'word_choice')],
    ['distant semantic replacement', lexicalIssue('happy', 'joyful', 'word_choice')],
  ])('rejects %s', (_label, candidate) => {
    expect(classify(candidate)).toBeNull()
  })

  it('rejects lexical overlap at the same source association', () => {
    const candidate = lexicalIssue('feelling', 'feeling')
    const grammar = lexicalIssue('feelling', 'feeling', 'grammar', { id: 'issue-2' })
    expect(classify(candidate, {
      errorAnnotations: [candidate, grammar],
      sentenceRevisions: [
        revision('feelling', 'feeling', ['spelling', 'grammar'], {
          relatedErrorIds: ['issue-1', 'issue-2'],
        }),
      ],
    })).toBeNull()
  })

  it.each([
    ['spelling', 'grammar'],
    ['spelling', 'word_choice'],
    ['word_choice', 'grammar'],
    ['word_choice', 'spelling'],
  ] as const)('rejects unlinked %s versus %s evidence at the same mechanical source', (
    candidateType,
    conflictType,
  ) => {
    const original = candidateType === 'word_choice' ? 'filling' : 'feelling'
    const candidate = lexicalIssue(original, 'feeling', candidateType)
    const conflict = lexicalIssue(
      `The source contains ${original} here`,
      'A separate correction.',
      conflictType,
      { id: 'issue-2' },
    )

    expect(classify(candidate, {
      errorAnnotations: [candidate, conflict],
      sentenceRevisions: [
        revision(original, 'feeling', [candidateType]),
        revision(conflict.original, conflict.suggestion, [conflictType], {
          id: 'revision-2',
          relatedErrorIds: ['issue-2'],
        }),
      ],
    })).toBeNull()
  })

  it('allows mechanically disjoint unlinked lexical evidence', () => {
    const candidate = lexicalIssue('feelling', 'feeling')
    const disjoint = lexicalIssue('go school', 'go to school', 'grammar', { id: 'issue-2' })

    expect(classify(candidate, {
      errorAnnotations: [candidate, disjoint],
      sentenceRevisions: [
        revision('feelling', 'feeling', ['spelling']),
        revision('go school', 'go to school', ['grammar'], {
          id: 'revision-2',
          relatedErrorIds: ['issue-2'],
        }),
      ],
    })).not.toBeNull()
  })

  it.each([
    'sentence_upgrade',
    'coherence',
    'logic_bridge',
    'delete_suggestion',
    'replace_sentence',
    'reference_clarification',
  ] as const)('rejects an unlinked overlapping %s association anywhere in the correction union', (
    changeType,
  ) => {
    const candidate = lexicalIssue('feelling', 'feeling')
    expect(classify(candidate, {
      sentencePairs: [pair(
        'The sentence contains feelling here.',
        'The sentence contains feeling here.',
        [changeType],
        { id: `pair-${changeType}`, relatedErrorIds: [] },
      )],
    })).toBeNull()
  })

  it.each([
    ['spelling', 'word_choice', 'feelling'],
    ['word_choice', 'spelling', 'filling'],
  ] as const)('rejects a separately linked overlapping %s versus %s association', (
    candidateType,
    competingType,
    original,
  ) => {
    const candidate = lexicalIssue(original, 'feeling', candidateType)
    expect(classify(candidate, {
      sentenceRevisions: [
        revision(original, 'feeling', [candidateType]),
        revision(
          `The sentence contains ${original} here.`,
          'A competing correction.',
          [competingType],
          { id: 'revision-competing', relatedErrorIds: ['different-issue'] },
        ),
      ],
    })).toBeNull()
  })

  it('rejects a duplicate same-source correction that cannot prove an isolated occurrence', () => {
    const candidate = lexicalIssue('feelling', 'feeling')
    expect(classify(candidate, {
      sentenceRevisions: [
        revision('feelling', 'feeling', ['spelling']),
        revision('feelling', 'feeling', ['spelling'], {
          id: 'revision-duplicate-source',
          relatedErrorIds: ['different-issue'],
        }),
      ],
    })).toBeNull()
  })

  it('rejects logic, handwriting and recognition overlap', () => {
    const candidate = lexicalIssue('feelling', 'feeling')
    const baseOptions = {
      logicIssues: [{
        id: 'logic-1',
        sentenceId: 'revision-1',
        original: 'feelling',
        contextBefore: '',
        contextAfter: '',
        subType: 'unclear_logic' as const,
        severity: 'medium' as const,
        diagnosis: '',
        suggestedAction: 'ask_student_to_explain' as const,
        conservativeSuggestion: '',
        polishedSuggestion: '',
        needsTeacherReview: false,
      }],
    }
    expect(classify(candidate, baseOptions)).toBeNull()
    expect(classify(candidate, {
      legibilityIssues: [{
        id: 'legibility-1',
        transcriptText: 'feelling',
        possibleReadings: ['feeling'],
        pageNumber: 1,
        regionDescription: 'line 1',
        explanation: '',
        defaultOutcome: 'count_as_legibility_error',
      }],
    })).toBeNull()
    expect(classify(candidate, { recognitionWarnings: ['Uncertain handwriting.'] })).toBeNull()
  })

  it('rejects containing-sentence logic evidence without a shared association id', () => {
    const candidate = lexicalIssue('feelling', 'feeling')
    expect(classify(candidate, {
      logicIssues: [{
        id: 'logic-containing',
        sentenceId: 'different-revision',
        original: 'The sentence contains feelling here.',
        contextBefore: '',
        contextAfter: '',
        subType: 'unclear_logic',
        severity: 'medium',
        diagnosis: '',
        suggestedAction: 'ask_student_to_explain',
        conservativeSuggestion: '',
        polishedSuggestion: '',
        needsTeacherReview: false,
      }],
    })).toBeNull()
  })

  it('normalizes only NFKC, surrounding whitespace and English case in fingerprints', () => {
    const normalized = classify(lexicalIssue('  Ｆｅｅｌｌｉｎｇ  ', ' Ｆｅｅｌｉｎｇ '))
    const plain = classify(lexicalIssue('feelling', 'feeling'))
    const differentSubtype = classify(lexicalIssue('feelling', 'feeling', 'word_choice'))

    expect(normalized?.fingerprint).toBe(plain?.fingerprint)
    expect(differentSubtype?.fingerprint).not.toBe(plain?.fingerprint)
  })
})
