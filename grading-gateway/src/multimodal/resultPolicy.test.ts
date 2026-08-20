import { describe, expect, it } from 'vitest'
import { applyResultPolicy, rebuildCorrectedText } from './resultPolicy.js'
import type { ResultPolicyInput } from './resultPolicy.js'
import type { RawLogicIssueV1 } from './types.js'

const transcript = 'I suggest you joins the club.'

function fullDimensionScores() {
  return [{ dimensionId: 'language', score: 1, maxScore: 1, reason: 'Language reviewed.', evidence: 'the club.', relatedIssueKeys: [] }]
}

function payloadWithUncertainSpelling(): ResultPolicyInput {
  return {
    issues: [{
      issueKey: 'spelling-joins', type: 'spelling', severity: 'low', originalText: 'joins',
      suggestion: 'join', explanation: 'The verb is misspelled.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }],
    sentenceRevisions: [{
      originalText: 'you joins', revisedText: 'you join', note: 'Correct the spelling.',
      relatedIssueKeys: ['spelling-joins'], changeTypes: ['spelling'],
    }],
    sentencePairs: [{
      originalText: 'you joins', correctedText: 'you join', improvedText: 'you should join',
      relatedIssueKeys: ['spelling-joins'], changeTypes: ['spelling'], explanation: 'Correct the spelling.', requiresTeacherReview: false,
    }],
    expressionUpgrades: [], logicIssues: [], legibilityIssues: [], dimensionScores: fullDimensionScores(), recognitionWarnings: [],
    overallComment: 'Check the verb form.', logicNotes: [],
  }
}

function payloadWithCertainSpelling(): ResultPolicyInput {
  return {
    issues: [{
      issueKey: 'spelling-joins', type: 'spelling', severity: 'low', originalText: 'joins',
      suggestion: 'join', explanation: 'The verb form is incorrect.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }],
    sentenceRevisions: [{
      originalText: 'you joins', revisedText: 'you join', note: 'Correct the verb form.',
      relatedIssueKeys: ['spelling-joins'], changeTypes: ['spelling'],
    }],
    sentencePairs: [{
      originalText: 'you joins', correctedText: 'you join', improvedText: 'you should join',
      relatedIssueKeys: ['spelling-joins'], changeTypes: ['spelling'], explanation: 'Correct the verb form.', requiresTeacherReview: false,
    }],
    expressionUpgrades: [], logicIssues: [], legibilityIssues: [], dimensionScores: [{ dimensionId: 'language', score: 0.5, maxScore: 1, reason: 'Language needs attention.', evidence: 'joins', relatedIssueKeys: ['spelling-joins'] }], recognitionWarnings: [],
    overallComment: 'Check the verb form.', logicNotes: [],
  }
}

function payloadWithGrammarIssue(): ResultPolicyInput {
  return {
    issues: [{
      issueKey: 'grammar-joins', type: 'grammar', severity: 'medium', originalText: 'joins',
      suggestion: 'join', explanation: 'The subject and verb do not agree.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }],
    sentenceRevisions: [{
      originalText: 'you joins', revisedText: 'you join', note: 'Use the base verb after you.',
      relatedIssueKeys: ['grammar-joins'], changeTypes: ['grammar'],
    }],
    sentencePairs: [{
      originalText: 'you joins', correctedText: 'you join', improvedText: 'you should join',
      relatedIssueKeys: ['grammar-joins'], changeTypes: ['grammar'], explanation: 'Use the base verb after you.', requiresTeacherReview: false,
    }],
    expressionUpgrades: [], logicIssues: [], legibilityIssues: [], dimensionScores: [{ dimensionId: 'language', score: 0.5, maxScore: 1, reason: 'Language needs attention.', evidence: 'joins', relatedIssueKeys: ['grammar-joins'] }], recognitionWarnings: [],
    overallComment: 'Check the verb form.', logicNotes: [],
  }
}

function payloadWithLegibilityOverlap(): ResultPolicyInput {
  return {
    issues: [{
      issueKey: 'grammar-joins', type: 'grammar', severity: 'medium', originalText: 'joins',
      suggestion: 'join', explanation: 'The subject and verb do not agree.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }],
    sentenceRevisions: [{
      originalText: 'you joins', revisedText: 'you join', note: 'Use the base verb after you.',
      relatedIssueKeys: ['grammar-joins'], changeTypes: ['grammar'],
    }],
    sentencePairs: [{
      originalText: 'you joins', correctedText: 'you join', improvedText: 'you should join',
      relatedIssueKeys: ['grammar-joins'], changeTypes: ['grammar'], explanation: 'Use the base verb after you.', requiresTeacherReview: false,
    }],
    logicIssues: [],
    legibilityIssues: [{
      issueKey: 'legibility-joins', transcriptText: 'joins', possibleReadings: ['joins', 'joins?'], pageNumber: 1,
      regionDescription: 'line 1', explanation: 'The final letters are ambiguous.', defaultOutcome: 'count_as_legibility_error',
    }],
    expressionUpgrades: [],
    dimensionScores: [
      { dimensionId: 'language', score: 1, maxScore: 1, reason: 'Language reviewed.', evidence: 'the club.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.5, maxScore: 1, reason: 'The word is unclear.', evidence: 'joins', relatedIssueKeys: ['legibility-joins'] },
    ], recognitionWarnings: [], overallComment: 'Check the verb form.', logicNotes: [],
  }
}

const filteredSpellingNarrative = 'Change joins to join.'

function logicIssueWithNarrative(
  field: 'originalText' | 'contextBefore' | 'contextAfter' | 'diagnosis' | 'conservativeSuggestion' | 'polishedSuggestion',
): RawLogicIssueV1 {
  const issue: RawLogicIssueV1 = {
    issueKey: 'logic-joins', originalText: 'joins', contextBefore: 'you', contextAfter: 'the club.',
    subType: 'unclear_logic', severity: 'low', diagnosis: 'The wording is unclear.',
    suggestedAction: 'ask_student_to_explain', conservativeSuggestion: 'Explain the wording.',
    polishedSuggestion: 'Clarify the sentence.', requiresTeacherReview: false,
  }
  if (field === 'originalText') return { ...issue, originalText: filteredSpellingNarrative }
  if (field === 'contextBefore') return { ...issue, contextBefore: filteredSpellingNarrative }
  if (field === 'contextAfter') return { ...issue, contextAfter: filteredSpellingNarrative }
  const safelyGrounded = { ...issue, originalText: 'the club.', contextAfter: '' }
  if (field === 'diagnosis') return { ...safelyGrounded, diagnosis: filteredSpellingNarrative }
  if (field === 'conservativeSuggestion') return { ...safelyGrounded, conservativeSuggestion: filteredSpellingNarrative }
  return { ...safelyGrounded, polishedSuggestion: filteredSpellingNarrative }
}

describe('applyResultPolicy', () => {
  it('accepts an unlinked deduction only when the normalizer explicitly marks it for teacher review', () => {
    const payload = payloadWithGrammarIssue()
    payload.dimensionScores[0] = {
      ...payload.dimensionScores[0],
      relatedIssueKeys: [],
      requiresTeacherReview: true,
    }

    expect(applyResultPolicy(payload, transcript)).toMatchObject({
      dimensionScores: [expect.objectContaining({ score: 0.5, relatedIssueKeys: [], requiresTeacherReview: true })],
    })
  })

  it.each([
    ['warning', (payload: ResultPolicyInput) => { payload.recognitionWarnings = [{ scope: 'local', message: 'PRIVATE-STUDENT-TEXT' } as never] }],
    ['keys', (payload: ResultPolicyInput) => { payload.issues.push({ ...payload.issues[0], type: 'word_choice' }) }],
    ['grounding_issue', (payload: ResultPolicyInput) => { payload.issues[0].originalText = 'PRIVATE-STUDENT-TEXT' }],
    ['grounding_logic_original', (payload: ResultPolicyInput) => { payload.logicIssues = [logicIssueWithNarrative('originalText')] }],
    ['grounding_logic_before', (payload: ResultPolicyInput) => { payload.logicIssues = [logicIssueWithNarrative('contextBefore')] }],
    ['grounding_logic_after', (payload: ResultPolicyInput) => { payload.logicIssues = [logicIssueWithNarrative('contextAfter')] }],
    ['grounding_legibility', (payload: ResultPolicyInput) => { payload.legibilityIssues = [{ issueKey: 'legibility-private', transcriptText: 'PRIVATE-STUDENT-TEXT', possibleReadings: ['one', 'two'], pageNumber: 1, regionDescription: 'Synthetic.', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }] }],
    ['grounding_upgrade', (payload: ResultPolicyInput) => { payload.expressionUpgrades = [{ originalText: 'PRIVATE-STUDENT-TEXT', upgradedText: 'Synthetic.', note: 'Synthetic.' }] }],
    ['grounding_logic_note', (payload: ResultPolicyInput) => { payload.logicNoteRecords = [{ quote: 'PRIVATE-STUDENT-TEXT', note: 'Synthetic.' }] }],
    ['revision', (payload: ResultPolicyInput) => { payload.sentencePairs = []; payload.sentenceRevisions[0].relatedIssueKeys = ['missing-issue'] }],
    ['dimension_relation', (payload: ResultPolicyInput) => { payload.dimensionScores[0].relatedIssueKeys = [] }],
    ['dimension_evidence_linked', (payload: ResultPolicyInput) => { payload.dimensionScores[0].evidence = 'PRIVATE-STUDENT-TEXT' }],
    ['narrative', (payload: ResultPolicyInput) => { const uncertain = payloadWithUncertainSpelling(); Object.assign(payload, uncertain, { overallComment: 'Change joins to join.' }) }],
  ] as const)('reports the privacy-safe %s rejection reason without echoing Provider data', (expectedReason, mutate) => {
    const payload = payloadWithGrammarIssue()
    mutate(payload)
    const reasons: string[] = []

    expect(applyResultPolicy(payload, transcript, (reason) => reasons.push(reason))).toBeNull()
    expect(reasons).toEqual([expectedReason])
    expect(JSON.stringify(reasons)).not.toMatch(/PRIVATE-STUDENT-TEXT|joins|missing-issue/)
  })

  it('silently removes uncertain spelling and every linked change', () => {
    expect(applyResultPolicy(payloadWithUncertainSpelling(), transcript)).toMatchObject({
      issues: [], sentenceRevisions: [], sentencePairs: [], reviewReasons: [], correctedText: transcript,
    })
  })

  it('keeps certain spelling that does not need teacher review', () => {
    expect(applyResultPolicy(payloadWithCertainSpelling(), transcript)?.issues[0]).toMatchObject({
      type: 'spelling', evidenceCertainty: 'certain',
    })
  })

  it('does not filter grammar under the spelling rule', () => {
    expect(applyResultPolicy(payloadWithGrammarIssue(), transcript)?.issues[0].type).toBe('grammar')
  })

  it('suppresses a spelling issue whose quote overlaps a retained grammar issue', () => {
    const payload = payloadWithGrammarIssue()
    payload.issues.push({
      issueKey: 'spelling-joins', type: 'spelling', severity: 'low', originalText: 'joins',
      suggestion: 'join', explanation: 'Synthetic duplicate.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    })

    expect(applyResultPolicy(payload, transcript)?.issues).toEqual([
      expect.objectContaining({ issueKey: 'grammar-joins', type: 'grammar' }),
    ])
  })

  it('rejects a recognition warning scope outside the global provider-only contract', () => {
    const payload = payloadWithGrammarIssue()
    payload.recognitionWarnings = [{ scope: 'local', message: 'Local warning.' } as never]
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('isolates grammar that overlaps legibility evidence', () => {
    expect(applyResultPolicy(payloadWithLegibilityOverlap(), transcript)?.issues).toHaveLength(0)
  })

  it.each(['contextBefore', 'contextAfter'] as const)('removes a logic issue whose %s intersects filtered spelling and cascades its key', (field) => {
    const source = 'Before wark. Core claim. After wark.'
    const payload: ResultPolicyInput = {
      issues: [{ issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: field === 'contextBefore' ? 'wark' : 'wark.', suggestion: 'work', explanation: 'Uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false }],
      logicIssues: [{ issueKey: 'logic-core', originalText: 'Core claim.', contextBefore: 'Before wark.', contextAfter: 'After wark.', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'ask_student_to_explain', conservativeSuggestion: 'Explain.', polishedSuggestion: 'Clarify.', requiresTeacherReview: false }],
      sentenceRevisions: [{ originalText: 'Core claim.', revisedText: 'Clear claim.', note: 'Synthetic.', relatedIssueKeys: ['logic-core'], changeTypes: ['coherence'] }],
      sentencePairs: [{ originalText: 'Core claim.', correctedText: 'Core claim.', improvedText: 'Clear claim.', explanation: 'Synthetic.', requiresTeacherReview: false, relatedIssueKeys: ['logic-core'], changeTypes: ['coherence'] }],
      expressionUpgrades: [], legibilityIssues: [], dimensionScores: [{ dimensionId: 'logic', score: 1, maxScore: 1, reason: 'Reviewed.', evidence: 'Core claim.', relatedIssueKeys: [] }], recognitionWarnings: [], overallComment: 'Synthetic.', logicNotes: [], logicNoteRecords: [],
    }
    if (field === 'contextBefore') payload.issues[0].originalText = 'Before wark.'
    else payload.issues[0].originalText = 'After wark.'
    expect(applyResultPolicy(payload, source)).toMatchObject({ logicIssues: [], sentenceRevisions: [], sentencePairs: [] })
    payload.dimensionScores[0] = { ...payload.dimensionScores[0], score: 0.5, relatedIssueKeys: ['logic-core'] }
    expect(applyResultPolicy(payload, source)).toBeNull()
  })

  it('removes a logic issue when its context intersects local legibility', () => {
    const source = 'Before blur. Core claim. After.'
    const payload: ResultPolicyInput = {
      issues: [],
      logicIssues: [{ issueKey: 'logic-core', originalText: 'Core claim.', contextBefore: 'Before blur.', contextAfter: 'After.', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'ask_student_to_explain', conservativeSuggestion: 'Explain.', polishedSuggestion: 'Clarify.', requiresTeacherReview: false }],
      sentenceRevisions: [], sentencePairs: [], expressionUpgrades: [],
      legibilityIssues: [{ issueKey: 'legibility-blur', transcriptText: 'blur', possibleReadings: ['blur', 'blue'], pageNumber: 1, regionDescription: 'line', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }],
      dimensionScores: [
        { dimensionId: 'logic', score: 1, maxScore: 1, reason: 'Reviewed.', evidence: 'Core claim.', relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0.5, maxScore: 1, reason: 'Unclear.', evidence: 'blur', relatedIssueKeys: ['legibility-blur'] },
      ], recognitionWarnings: [], overallComment: 'Synthetic.', logicNotes: [], logicNoteRecords: [],
    }
    expect(applyResultPolicy(payload, source)).toMatchObject({ logicIssues: [] })
  })

  it('rejects out-of-order or overlapping logic context ranges', () => {
    const payload = payloadWithGrammarIssue()
    payload.logicIssues = [{ issueKey: 'logic-joins', originalText: 'you joins', contextBefore: 'suggest you', contextAfter: 'joins the club.', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'ask_student_to_explain', conservativeSuggestion: 'Explain.', polishedSuggestion: 'Clarify.', requiresTeacherReview: false }]
    payload.dimensionScores = fullDimensionScores()
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('rejects duplicate issue keys instead of joining them arbitrarily', () => {
    const payload = payloadWithGrammarIssue()
    payload.issues.push({ ...payload.issues[0], type: 'word_choice' })
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('rejects a revision that names an unknown issue key', () => {
    const payload = payloadWithGrammarIssue()
    payload.sentencePairs = []
    payload.sentenceRevisions[0].relatedIssueKeys = ['missing-issue']
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('silently drops a revision that mixes uncertain spelling with grammar', () => {
    const payload = payloadWithGrammarIssue()
    payload.issues.push({
      issueKey: 'spelling-joins', type: 'spelling', severity: 'low', originalText: 'joins',
      suggestion: 'join', explanation: 'The verb is misspelled.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    })
    payload.sentenceRevisions[0].relatedIssueKeys = ['grammar-joins', 'spelling-joins']
    payload.sentencePairs = []
    payload.dimensionScores = fullDimensionScores()
    expect(applyResultPolicy(payload, transcript)).toMatchObject({ issues: [], sentenceRevisions: [] })
  })

  it('rejects duplicate source quotes for retained edits', () => {
    const payload = payloadWithGrammarIssue()
    payload.sentenceRevisions.push({ ...payload.sentenceRevisions[0] })
    payload.sentencePairs = []
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('rejects overlapping retained edits', () => {
    const payload = payloadWithGrammarIssue()
    payload.sentencePairs = []
    payload.sentenceRevisions.push({
      originalText: 'suggest you', revisedText: 'ask you', note: 'Use a more direct verb.',
      relatedIssueKeys: ['grammar-joins'], changeTypes: ['grammar'],
    })
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('rejects a filtered spelling suggestion that leaks into the overall comment', () => {
    const payload = payloadWithUncertainSpelling()
    payload.overallComment = 'Change joins to join.'
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('keeps a bare filtered original when the overall comment has no correction cue', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0] = { ...payload.issues[0], originalText: 'wark', suggestion: 'work' }
    payload.overallComment = 'wark'
    expect(applyResultPolicy(payload, 'I suggest you joins the club. wark')).toMatchObject({ overallComment: 'wark' })
  })

  it('rejects an explicit filtered spelling correction', () => {
    const explicit = payloadWithUncertainSpelling()
    explicit.issues[0] = { ...explicit.issues[0], originalText: 'wark', suggestion: 'work' }
    explicit.overallComment = 'wark should be work.'
    expect(applyResultPolicy(explicit, 'I suggest you joins the club. wark')).toBeNull()
  })

  it('keeps a benign suggestion-only phrase (regression: suggestion overblocking)', () => {
    const ordinary = payloadWithUncertainSpelling()
    ordinary.issues[0] = { ...ordinary.issues[0], originalText: 'joins', suggestion: 'work' }
    ordinary.overallComment = 'Good work overall.'
    expect(applyResultPolicy(ordinary, transcript)).toMatchObject({ overallComment: 'Good work overall.' })
  })

  it('rejects a recognition warning that explicitly leaks a filtered spelling correction', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0] = { ...payload.issues[0], originalText: 'wark', suggestion: 'work' }
    payload.recognitionWarnings = [{
      scope: 'global_unreadable',
      message: 'The handwritten word wark is unclear and should be read as work.',
    }]

    expect(applyResultPolicy(payload, `${transcript} wark`)).toBeNull()
  })

  it('treats strong readability wording as an explicit filtered-spelling warning cue', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0] = { ...payload.issues[0], originalText: 'wark', suggestion: 'work' }
    payload.recognitionWarnings = [{ scope: 'global_unreadable', message: 'The token wark is unreadable.' }]

    expect(applyResultPolicy(payload, `${transcript} wark`)).toBeNull()
  })

  it('keeps benign positive prose and an independent global warning after filtering spelling', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0] = { ...payload.issues[0], originalText: 'wark', suggestion: 'work' }
    payload.overallComment = 'Good work overall.'
    payload.recognitionWarnings = [{
      scope: 'printed_boundary',
      message: 'The bottom page border cannot be classified confidently.',
    }]

    expect(applyResultPolicy(payload, `${transcript} wark`)).toMatchObject({
      issues: [],
      overallComment: 'Good work overall.',
      recognitionWarnings: [{ scope: 'printed_boundary' }],
    })
  })

  it('rejects a local legibility item that republishes a filtered spelling span', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark',
      suggestion: 'work', explanation: 'Uncertain handwriting.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.sentenceRevisions = []
    payload.sentencePairs = []
    payload.legibilityIssues = [{
      issueKey: 'legibility-blur', transcriptText: 'blur', possibleReadings: ['blur', 'blue'], pageNumber: 1,
      regionDescription: 'line 1', explanation: 'The handwritten word wark could be read as work.', defaultOutcome: 'count_as_legibility_error',
    }]
    payload.dimensionScores = [
      { dimensionId: 'language', score: 1, maxScore: 1, reason: 'Language reviewed.', evidence: 'beside', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.5, maxScore: 1, reason: 'One local mark is unclear.', evidence: 'blur', relatedIssueKeys: ['legibility-blur'] },
    ]

    expect(applyResultPolicy(payload, 'A wark appears beside blur.')).toBeNull()
  })

  it('keeps an ordinary evaluation that repeats the filtered original token', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0] = { ...payload.issues[0], originalText: 'club', suggestion: 'clue' }
    payload.dimensionScores = [{ dimensionId: 'language', score: 1, maxScore: 1, reason: 'Reviewed.', evidence: 'I suggest', relatedIssueKeys: [] }]
    payload.overallComment = 'The club response addresses the task.'
    expect(applyResultPolicy(payload, transcript)).toMatchObject({ overallComment: 'The club response addresses the task.' })
  })

  it('does not let a suggestion equal to word act as its own correction cue', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0] = { ...payload.issues[0], originalText: 'work', suggestion: 'word' }
    payload.dimensionScores = [{ dimensionId: 'language', score: 1, maxScore: 1, reason: 'Reviewed.', evidence: 'I suggest', relatedIssueKeys: [] }]
    payload.overallComment = 'This word is vivid.'
    const withWork = `${transcript} Your work is clear.`
    expect(applyResultPolicy(payload, withWork)).toMatchObject({ overallComment: 'This word is vivid.' })

    payload.overallComment = 'Replace work with word.'
    expect(applyResultPolicy(payload, withWork)).toBeNull()
  })

  it('rejects filtered spelling leaked through a retained language issue narrative', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0] = { ...payload.issues[0], originalText: 'wark', suggestion: 'work' }
    payload.issues.push({ issueKey: 'grammar-club', type: 'grammar', severity: 'low', originalText: 'the club.', suggestion: 'wark should be work.', explanation: 'The wording explicitly repeats the filtered correction.', evidenceCertainty: 'certain', requiresTeacherReview: false })
    expect(applyResultPolicy(payload, `${transcript} wark`)).toBeNull()
  })

  it.each([
    'originalText', 'contextBefore', 'contextAfter', 'diagnosis', 'conservativeSuggestion', 'polishedSuggestion',
  ] as const)('rejects filtered spelling leaked through logic issue %s', (field) => {
    const payload = payloadWithUncertainSpelling()
    payload.logicIssues = [logicIssueWithNarrative(field)]
    const result = applyResultPolicy(payload, transcript)
    expect(result).toBeNull()
  })

  it('rejects an uncertain spelling whose own quote is ungrounded', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0].originalText = 'missing spelling'
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('rejects an ungrounded revision linked to uncertain spelling', () => {
    const payload = payloadWithUncertainSpelling()
    payload.sentencePairs = []
    payload.sentenceRevisions[0].originalText = 'missing revision'
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('rejects an ambiguous pair linked to uncertain spelling', () => {
    const payload = payloadWithUncertainSpelling()
    payload.sentenceRevisions = []
    payload.sentencePairs[0].originalText = 'joins'
    expect(applyResultPolicy(payload, 'suggest joins joins')).toBeNull()
  })

  it('rejects an empty revision change type list', () => {
    const payload = payloadWithGrammarIssue()
    payload.sentencePairs = []
    payload.sentenceRevisions[0].changeTypes = []
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('rejects an empty sentence-pair change type list', () => {
    const payload = payloadWithGrammarIssue()
    payload.sentenceRevisions = []
    payload.sentencePairs[0].changeTypes = []
    expect(applyResultPolicy(payload, transcript)).toBeNull()
  })

  it('does not treat a bounded local quote as a substring of ordinary prose', () => {
    const source = 'The student can improve.'
    const payload: ResultPolicyInput = {
      issues: [], sentenceRevisions: [], sentencePairs: [], expressionUpgrades: [], logicIssues: [],
      legibilityIssues: [{
        issueKey: 'legibility-can', transcriptText: 'can', possibleReadings: ['can', "can't"], pageNumber: 1,
        regionDescription: 'line 1', explanation: 'The apostrophe is unclear.', defaultOutcome: 'count_as_legibility_error',
      }],
      dimensionScores: [
        { dimensionId: 'language', score: 1, maxScore: 1, reason: 'The student can improve.', evidence: 'improve', relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0.5, maxScore: 1, reason: 'One local mark needs review.', evidence: 'can', relatedIssueKeys: ['legibility-can'] },
      ],
      recognitionWarnings: [], overallComment: 'The student cannot be faulted elsewhere.', logicNotes: [],
    }

    expect(applyResultPolicy(payload, source)).toMatchObject({ legibilityIssues: [{ transcriptText: 'can' }] })
  })

  it('rejects correction/readability prose that explicitly republishes a local legibility quote', () => {
    const source = 'The student can improve.'
    const payload: ResultPolicyInput = {
      issues: [], sentenceRevisions: [], sentencePairs: [], expressionUpgrades: [], logicIssues: [],
      legibilityIssues: [{
        issueKey: 'legibility-can', transcriptText: 'can', possibleReadings: ['can', "can't"], pageNumber: 1,
        regionDescription: 'line 1', explanation: 'The apostrophe is unclear.', defaultOutcome: 'count_as_legibility_error',
      }],
      dimensionScores: [
        { dimensionId: 'language', score: 1, maxScore: 1, reason: 'Language reviewed.', evidence: 'improve', relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0.5, maxScore: 1, reason: 'One local mark needs review.', evidence: 'can', relatedIssueKeys: ['legibility-can'] },
      ],
      recognitionWarnings: [], overallComment: 'The word can is unclear and may need correction.', logicNotes: [],
    }

    expect(applyResultPolicy(payload, source)).toBeNull()
  })

  it('allows an ordinary linguistic explanation that uses the bounded local term', () => {
    const source = 'The student can improve.'
    const payload: ResultPolicyInput = {
      issues: [], sentenceRevisions: [], sentencePairs: [], expressionUpgrades: [], logicIssues: [],
      legibilityIssues: [{
        issueKey: 'legibility-can', transcriptText: 'can', possibleReadings: ['can', "can't"], pageNumber: 1,
        regionDescription: 'line 1', explanation: 'The apostrophe is unclear.', defaultOutcome: 'count_as_legibility_error',
      }],
      dimensionScores: [
        { dimensionId: 'language', score: 1, maxScore: 1, reason: 'The word can expresses ability.', evidence: 'improve', relatedIssueKeys: [] },
        { dimensionId: 'legibility', score: 0.5, maxScore: 1, reason: 'One local mark needs review.', evidence: 'can', relatedIssueKeys: ['legibility-can'] },
      ],
      recognitionWarnings: [], overallComment: 'The response is otherwise clear.', logicNotes: [],
    }

    expect(applyResultPolicy(payload, source)).toMatchObject({ legibilityIssues: [{ transcriptText: 'can' }] })
  })
})

describe('rebuildCorrectedText', () => {
  it('rebuilds corrected text from a unique sentence-pair replacement', () => {
    expect(rebuildCorrectedText(
      'I suggest you joins the club.',
      [{ originalText: 'you joins', correctedText: 'you join' }],
    )).toBe('I suggest you join the club.')
  })

  it('rejects an ambiguous replacement', () => {
    expect(rebuildCorrectedText(
      'work and work',
      [{ originalText: 'work', correctedText: 'walk' }],
    )).toBeNull()
  })

  it('rejects an ASCII quote with overlapping occurrences', () => {
    expect(rebuildCorrectedText('aaa', [{ originalText: 'aa', correctedText: 'b' }])).toBeNull()
  })

  it('rejects a Unicode quote with overlapping occurrences', () => {
    expect(rebuildCorrectedText('你好你好你', [{ originalText: '你好你', correctedText: '甲' }])).toBeNull()
  })
})
