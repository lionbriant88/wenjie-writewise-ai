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

  it('rejects an explicit filtered spelling correction but does not reject ordinary suggestion use', () => {
    const explicit = payloadWithUncertainSpelling()
    explicit.issues[0] = { ...explicit.issues[0], originalText: 'wark', suggestion: 'work' }
    explicit.overallComment = 'wark should be work.'
    expect(applyResultPolicy(explicit, 'I suggest you joins the club. wark')).toBeNull()

    const ordinary = payloadWithUncertainSpelling()
    ordinary.issues[0] = { ...ordinary.issues[0], originalText: 'joins', suggestion: 'work' }
    ordinary.overallComment = 'Good work overall.'
    expect(applyResultPolicy(ordinary, transcript)).toMatchObject({ overallComment: 'Good work overall.' })
  })

  it('does not reject an ordinary evaluation when the filtered original is also a common word', () => {
    const payload = payloadWithUncertainSpelling()
    payload.issues[0] = { ...payload.issues[0], originalText: 'club', suggestion: 'clue' }
    payload.dimensionScores = [{ dimensionId: 'language', score: 1, maxScore: 1, reason: 'Reviewed.', evidence: 'I suggest', relatedIssueKeys: [] }]
    payload.overallComment = 'The club response addresses the task.'
    expect(applyResultPolicy(payload, transcript)).toMatchObject({ overallComment: payload.overallComment })
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
