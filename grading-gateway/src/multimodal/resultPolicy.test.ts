import { describe, expect, it } from 'vitest'
import { applyResultPolicy, rebuildCorrectedText } from './resultPolicy.js'
import type { ResultPolicyInput } from './resultPolicy.js'
import type { RawLogicIssueV1 } from './types.js'

const transcript = 'I suggest you joins the club.'

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
    logicIssues: [], legibilityIssues: [], dimensionReasons: ['Language needs attention.'],
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
    logicIssues: [], legibilityIssues: [], dimensionReasons: ['Language needs attention.'],
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
    logicIssues: [], legibilityIssues: [], dimensionReasons: ['Language needs attention.'],
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
    dimensionReasons: ['Language needs attention.'], overallComment: 'Check the verb form.', logicNotes: [],
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
  if (field === 'diagnosis') return { ...issue, diagnosis: filteredSpellingNarrative }
  if (field === 'conservativeSuggestion') return { ...issue, conservativeSuggestion: filteredSpellingNarrative }
  return { ...issue, polishedSuggestion: filteredSpellingNarrative }
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

  it('isolates grammar that overlaps legibility evidence', () => {
    expect(applyResultPolicy(payloadWithLegibilityOverlap(), transcript)?.issues).toHaveLength(0)
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
    expect(applyResultPolicy(payload, transcript)).toMatchObject({ issues: [payload.issues[0]], sentenceRevisions: [] })
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

  it.each([
    'originalText', 'contextBefore', 'contextAfter', 'diagnosis', 'conservativeSuggestion', 'polishedSuggestion',
  ] as const)('rejects filtered spelling leaked through logic issue %s', (field) => {
    const payload = payloadWithUncertainSpelling()
    payload.logicIssues = [logicIssueWithNarrative(field)]
    expect(applyResultPolicy(payload, transcript)).toBeNull()
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
