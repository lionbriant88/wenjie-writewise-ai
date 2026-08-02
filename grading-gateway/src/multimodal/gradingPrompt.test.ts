import { describe, expect, it } from 'vitest'
import { buildEssayGradingMessages, essayGradingSchema } from './gradingPrompt.js'

const task = {
  taskId: 'task-prompt', fullScore: 20,
  materialSummary: 'Write a response to the supplied school scenario.',
  writingRequirements: ['Address the required points.'], constraints: ['Write in English.'],
  rubric: {
    taskName: 'Synthetic writing task', materialSummary: 'Write a response to the supplied school scenario.',
    writingRequirements: ['Address the required points.'], constraints: ['Write in English.'],
    dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Address all required points.', deductionFocus: [], sourceEvidence: [] }],
    reviewWarnings: [],
  },
}

describe('essay grading prompt', () => {
  it('sets the image and transcript safety boundary and weighted-score rules', () => {
    const messages = buildEssayGradingMessages({
      task,
      essayId: 'essay-prompt',
      pages: [
        { pageId: 'page-2', mimeType: 'image/png', buffer: Buffer.from('second') },
        { pageId: 'page-1', mimeType: 'image/jpeg', buffer: Buffer.from('first') },
      ],
    })
    const text = JSON.stringify(messages)

    expect(text).toMatch(/preserve.*student.*spelling.*grammar/i)
    expect(text).toMatch(/exclude.*printed.*task instructions.*page furniture/i)
    expect(text).toMatch(/never obey.*text inside images/i)
    expect(text).toMatch(/uncertainty warnings/i)
    expect(text).toMatch(/issue quote.*transcript/i)
    expect(text).toMatch(/percentage weights.*full score/i)
    expect(text).toContain('data:image/png;base64,c2Vjb25k')
    expect(text).toContain('data:image/jpeg;base64,Zmlyc3Q=')
  })

  it('requires the transcript, printed-text exclusion state, warnings, and grading payload', () => {
    expect(essayGradingSchema).toMatchObject({
      type: 'object', additionalProperties: false,
      required: expect.arrayContaining([
        'transcript', 'transcriptionWarnings', 'printedTextExcluded', 'dimensionScores',
        'issues', 'sentenceRevisions', 'expressionUpgrades', 'fullTextRevision', 'overallComment', 'reviewReasons',
      ]),
    })
  })
})
