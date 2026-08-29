import { describe, expect, it } from 'vitest'
import type { Essay } from '../types'
import type { AiGradingResultV1, GradingFailureV1 } from '../services/grading/types'
import {
  beginGradingAttempt,
  confirmGradingTransition,
  invalidateGradingAfterTranscriptEdit,
  markEssayManualTransition,
  recordGradingPreflightFailure,
  settleGradingFailure,
  settleGradingSuccess,
} from './gradingStateTransitions'

function essay(
  status: Essay['status'] = 'pending_grading',
  sourceGeneration: number | undefined = 0,
): Essay {
  return {
    id: 'essay-1', taskId: 'task-1', essayNumber: 'Synthetic essay', pages: [], pageCount: 0,
    pageOrder: [], ocrText: 'Synthetic transcript.', ocrConfidence: 1, status,
    exceptionReasons: [], teacherReviewed: false,
    ...(sourceGeneration === undefined ? {} : { sourceGeneration }),
    createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  }
}

function attempt(requestId: string, sourceGeneration = 0, rubricGeneration = 0) {
  return { requestId, sourceGeneration, rubricGeneration }
}

function essayRunning(
  requestId: string,
  sourceGeneration: number | undefined = 0,
  rubricGeneration: number | undefined = 0,
): Essay {
  return {
    ...essay('grading', sourceGeneration),
    gradingRun: {
      status: 'running', requestId,
      ...(sourceGeneration === undefined ? {} : { sourceGeneration }),
      ...(rubricGeneration === undefined ? {} : { rubricGeneration }),
      startedAt: '2026-07-20T00:00:00.000Z',
    },
  }
}

const successResult: AiGradingResultV1 = {
  resultVersion: 'grading-result-v2', requestId: 'request-1', essayId: 'essay-1',
  provider: 'remote', status: 'success', totalScore: 12, maxScore: 15,
  dimensionScores: [], issues: [], sentenceRevisions: [], expressionUpgrades: [],
  recognitionWarnings: [], legibilityIssues: [],
  fullTextRevision: { originalText: 'Synthetic transcript.', correctedText: 'Synthetic transcript.', improvedText: 'Synthetic transcript.', sentencePairs: [], logicNotes: [], logicIssues: [] },
  overallComment: 'Synthetic.', reviewReasons: [], createdAt: '2026-07-20T00:01:00.000Z',
}

const failureResult: GradingFailureV1 = {
  requestId: 'request-1', status: 'failed',
  error: { code: 'provider_timeout', message: 'Timed out.', retryable: true },
}

describe('grading state transitions', () => {
  it('begins only from a matching actionable source and rubric generation', () => {
    const started = beginGradingAttempt(
      [essay()], 'essay-1', attempt('request-1'), 0, '2026-07-20T00:00:00.000Z',
    )
    expect(started.applied).toBe(true)
    expect(started.essays[0]).toMatchObject({
      status: 'grading', teacherReviewed: false,
      gradingRun: {
        status: 'running', requestId: 'request-1', sourceGeneration: 0, rubricGeneration: 0,
      },
    })
    expect(beginGradingAttempt([essay('manual')], 'essay-1', attempt('request-1'), 0, 'now').applied).toBe(false)
    expect(beginGradingAttempt([essay('pending_grading', 1)], 'essay-1', attempt('request-1'), 0, 'now').applied).toBe(false)
    expect(beginGradingAttempt([essay()], 'essay-1', attempt('request-1'), 1, 'now').applied).toBe(false)
  })

  it('treats absent legacy generations as zero when beginning an attempt', () => {
    const started = beginGradingAttempt(
      [essay('pending_grading', undefined)], 'essay-1', attempt('request-1'), 0, 'started',
    )

    expect(started.applied).toBe(true)
    expect(started.essays[0].gradingRun).toMatchObject({
      sourceGeneration: 0,
      rubricGeneration: 0,
    })
  })

  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed when a begin generation is invalid: %s',
    (invalidGeneration) => {
      expect(beginGradingAttempt(
        [essay('pending_grading', invalidGeneration)],
        'essay-1',
        attempt('request-1', invalidGeneration, 0),
        0,
        'started',
      ).applied).toBe(false)
      expect(beginGradingAttempt(
        [essay()],
        'essay-1',
        attempt('request-1', 0, invalidGeneration),
        invalidGeneration,
        'started',
      ).applied).toBe(false)
    },
  )

  it('settles a matching success as unreviewed grading_ready and preserves captured generations', () => {
    const transition = settleGradingSuccess(
      [essayRunning('request-1')], 'essay-1', attempt('request-1'), 0, 'essay-1-result', successResult,
    )
    expect(transition.applied).toBe(true)
    expect(transition.essays[0]).toMatchObject({
      status: 'grading_ready', aiResultId: 'essay-1-result', teacherReviewed: false,
      gradingRun: {
        status: 'success', requestId: 'request-1', source: 'remote',
        sourceGeneration: 0, rubricGeneration: 0,
      },
    })
  })

  it('copies a Kimi transcript to the compatible essay text without inventing an OCR audit', () => {
    const transition = settleGradingSuccess(
      [{ ...essayRunning('request-1'), ocrText: '', ocrAudit: undefined }],
      'essay-1', attempt('request-1'), 0, 'essay-1-result',
      { ...successResult, transcript: 'Kimi faithfully read this.', recognitionWarnings: [], printedTextExcluded: true },
      { transcriptSource: 'kimi_vision' },
    )

    expect(transition.essays[0]).toMatchObject({
      ocrText: 'Kimi faithfully read this.', transcriptSource: 'kimi_vision',
    })
    expect(transition.essays[0].ocrAudit).toBeUndefined()
  })

  it('does not let a legacy grading response overwrite text or claim Kimi vision provenance', () => {
    const current = { ...essayRunning('request-1'), ocrText: 'Teacher-confirmed legacy text.' }
    const transition = settleGradingSuccess(
      [current], 'essay-1', attempt('request-1'), 0, 'essay-1-result',
      { ...successResult, transcript: 'Unexpected legacy transcript.', recognitionWarnings: [], printedTextExcluded: true },
      {},
    )

    expect(transition.essays[0].ocrText).toBe('Teacher-confirmed legacy text.')
    expect(transition.essays[0].transcriptSource).toBeUndefined()
  })

  it('keeps the exact teacher-confirmed transcript even when a response differs', () => {
    const teacherText = 'Teacher corrected transcript.'
    const transition = settleGradingSuccess(
      [{ ...essayRunning('request-1'), ocrText: teacherText, transcriptSource: 'teacher_confirmed' }],
      'essay-1', attempt('request-1'), 0, 'essay-1-result',
      { ...successResult, transcript: 'Kimi transcript.', recognitionWarnings: [], printedTextExcluded: true },
      { transcriptSource: 'teacher_confirmed', confirmedTranscript: teacherText },
    )
    expect(transition.essays[0]).toMatchObject({ ocrText: teacherText, transcriptSource: 'teacher_confirmed' })
    expect(transition.essays[0].ocrText).not.toBe('Kimi transcript.')
  })

  it('settles a matching failure into an actionable pending state and preserves captured generations', () => {
    const transition = settleGradingFailure(
      [essayRunning('request-1')], 'essay-1', attempt('request-1'), 0,
      failureResult, '2026-07-20T00:01:00.000Z',
    )
    expect(transition.applied).toBe(true)
    expect(transition.essays[0]).toMatchObject({
      status: 'pending_grading', teacherReviewed: false,
      gradingRun: {
        status: 'failed', requestId: 'request-1', errorCode: 'provider_timeout', retryable: true,
        sourceGeneration: 0, rubricGeneration: 0,
      },
    })
  })

  it('ignores a late success from an older request', () => {
    const current = essayRunning('request-new')
    const transition = settleGradingSuccess(
      [current], 'essay-1', attempt('request-old'), 0, 'essay-1-result',
      { ...successResult, requestId: 'request-old' },
    )
    expect(transition.applied).toBe(false)
    expect(transition.essays).toEqual([current])
  })

  it('ignores a late failure from an older request', () => {
    const current = essayRunning('request-new')
    const transition = settleGradingFailure(
      [current], 'essay-1', attempt('request-old'), 0,
      { ...failureResult, requestId: 'request-old' }, 'later',
    )
    expect(transition.applied).toBe(false)
    expect(transition.essays).toEqual([current])
  })

  it('ignores success and failure after the essay moved to manual handling', () => {
    const manual = markEssayManualTransition(
      [essayRunning('request-1')], 'essay-1', '2026-07-20T00:00:30.000Z',
    ).essays[0]
    expect(settleGradingSuccess(
      [manual], 'essay-1', attempt('request-1'), 0, 'result', successResult,
    ).applied).toBe(false)
    expect(settleGradingFailure(
      [manual], 'essay-1', attempt('request-1'), 0, failureResult, 'later',
    ).applied).toBe(false)
    expect(manual).toMatchObject({
      status: 'manual', teacherReviewed: true,
      gradingRun: {
        status: 'failed', requestId: 'request-1', errorCode: 'manual_override',
        sourceGeneration: 0, rubricGeneration: 0,
      },
    })
  })

  it.each([
    { label: 'source', current: { sourceGeneration: 1, rubricGeneration: 0 } },
    { label: 'rubric', current: { sourceGeneration: 0, rubricGeneration: 1 } },
  ])('ignores a same-request late success after the $label generation changes', ({ current }) => {
    const inFlight = essayRunning('request-1', 0, 0)
    const changed = { ...inFlight, sourceGeneration: current.sourceGeneration }
    const transition = settleGradingSuccess(
      [changed], 'essay-1', attempt('request-1'), current.rubricGeneration,
      'essay-1-result', successResult,
    )

    expect(transition.applied).toBe(false)
    expect(transition.essays).toEqual([changed])
  })

  it.each([
    { label: 'source', current: { sourceGeneration: 1, rubricGeneration: 0 } },
    { label: 'rubric', current: { sourceGeneration: 0, rubricGeneration: 1 } },
  ])('ignores a same-request late failure after the $label generation changes', ({ current }) => {
    const inFlight = essayRunning('request-1', 0, 0)
    const changed = { ...inFlight, sourceGeneration: current.sourceGeneration }
    const transition = settleGradingFailure(
      [changed], 'essay-1', attempt('request-1'), current.rubricGeneration,
      failureResult, 'later',
    )

    expect(transition.applied).toBe(false)
    expect(transition.essays).toEqual([changed])
  })

  it('treats absent running generations as zero when settling a legacy attempt', () => {
    const transition = settleGradingSuccess(
      [essayRunning('request-1', undefined, undefined)],
      'essay-1', attempt('request-1'), 0, 'essay-1-result', successResult,
    )

    expect(transition.applied).toBe(true)
    expect(transition.essays[0].gradingRun).toMatchObject({
      sourceGeneration: 0,
      rubricGeneration: 0,
    })
  })

  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed when matching-looking settle generations are invalid: %s',
    (invalidGeneration) => {
      const current = essayRunning('request-1', invalidGeneration, invalidGeneration)
      expect(settleGradingSuccess(
        [current],
        'essay-1',
        attempt('request-1', invalidGeneration, invalidGeneration),
        invalidGeneration,
        'essay-1-result',
        successResult,
      ).applied).toBe(false)
      expect(settleGradingFailure(
        [current],
        'essay-1',
        attempt('request-1', invalidGeneration, invalidGeneration),
        invalidGeneration,
        failureResult,
        'later',
      ).applied).toBe(false)
    },
  )

  it('records a generation-bound preflight failure only for the current version', () => {
    const transition = recordGradingPreflightFailure(
      [essay('pending_grading', 2)], 'essay-1', attempt('request-1', 2, 3), 3,
      { code: 'invalid_request', message: 'Invalid.' }, 'completed',
    )

    expect(transition.applied).toBe(true)
    expect(transition.essays[0].gradingRun).toMatchObject({
      status: 'failed', requestId: 'request-1', sourceGeneration: 2, rubricGeneration: 3,
    })
    expect(recordGradingPreflightFailure(
      [essay('pending_grading', 3)], 'essay-1', attempt('request-1', 2, 3), 3,
      { code: 'invalid_request', message: 'Invalid.' }, 'completed',
    ).applied).toBe(false)
  })

  it('confirms only a ready essay that has a result id', () => {
    const ready = { ...essay('grading_ready'), aiResultId: 'essay-1-result' }
    const confirmed = confirmGradingTransition([ready], 'essay-1', 'confirmed-at')
    expect(confirmed.essays[0]).toMatchObject({ status: 'completed', teacherReviewed: true })
    expect(confirmGradingTransition([essay()], 'essay-1', 'confirmed-at').applied).toBe(false)
  })

  it('invalidates an AI grade when the teacher changes the Kimi transcript', () => {
    const gradedEssay: Essay = {
      ...essay('grading_ready'),
      aiResultId: 'essay-1-result',
      transcriptSource: 'kimi_vision',
      gradingRun: { status: 'success', requestId: 'request-1', source: 'remote', reviewReasons: [], startedAt: 'started', completedAt: 'finished' },
    }

    const result = invalidateGradingAfterTranscriptEdit([gradedEssay], gradedEssay.id, '2026-08-02T00:00:00.000Z')

    expect(result.essays[0]).toMatchObject({
      status: 'pending_grading', teacherReviewed: false, gradingRun: { status: 'idle' }, updatedAt: '2026-08-02T00:00:00.000Z',
    })
    expect(result.essays[0].aiResultId).toBeUndefined()
  })

  it('invalidates an in-flight attempt after the source generation has advanced', () => {
    const changedWhileRunning: Essay = {
      ...essayRunning('request-1', 0, 0),
      sourceGeneration: 1,
      aiResultId: 'obsolete-result',
    }

    const result = invalidateGradingAfterTranscriptEdit(
      [changedWhileRunning], changedWhileRunning.id, '2026-08-02T00:00:00.000Z',
    )

    expect(result.applied).toBe(true)
    expect(result.essays[0]).toMatchObject({
      sourceGeneration: 1,
      status: 'pending_grading',
      teacherReviewed: false,
      gradingRun: { status: 'idle' },
      updatedAt: '2026-08-02T00:00:00.000Z',
    })
    expect(result.essays[0].aiResultId).toBeUndefined()
  })

  it('leaves unrelated and already-pending essays by reference when transcript invalidation cannot apply', () => {
    const current = essay('pending_grading')
    const essays = [current]
    const unknown = invalidateGradingAfterTranscriptEdit(essays, 'missing', 'now')
    const pending = invalidateGradingAfterTranscriptEdit(essays, current.id, 'now')

    expect(unknown).toEqual({ applied: false, essays })
    expect(unknown.essays).toBe(essays)
    expect(pending).toEqual({ applied: false, essays })
    expect(pending.essays).toBe(essays)
  })
})
