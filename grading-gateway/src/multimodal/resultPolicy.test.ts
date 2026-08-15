import { describe, expect, it } from 'vitest'
import { applyResultPolicy, rebuildCorrectedText } from './resultPolicy.js'
import type { ResultPolicyInput } from './resultPolicy.js'

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
})
