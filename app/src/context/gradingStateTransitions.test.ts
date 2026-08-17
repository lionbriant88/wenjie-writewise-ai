import { describe, expect, it } from 'vitest'
import type { Essay } from '../types'
import type { AiGradingResultV1, GradingFailureV1 } from '../services/grading/types'
import {
  beginGradingAttempt,
  confirmGradingTransition,
  invalidateGradingAfterTranscriptEdit,
  markEssayManualTransition,
  settleGradingFailure,
  settleGradingSuccess,
} from './gradingStateTransitions'

function essay(status: Essay['status'] = 'pending_grading'): Essay {
  return {
    id: 'essay-1', taskId: 'task-1', essayNumber: 'Synthetic essay', pages: [], pageCount: 0,
    pageOrder: [], ocrText: 'Synthetic transcript.', ocrConfidence: 1, status,
    exceptionReasons: [], teacherReviewed: false,
    createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  }
}

function essayRunning(requestId: string): Essay {
  return {
    ...essay('grading'),
    gradingRun: { status: 'running', requestId, startedAt: '2026-07-20T00:00:00.000Z' },
  }
}

const successResult: AiGradingResultV1 = {
  resultVersion: 'grading-result-v2', requestId: 'request-1', essayId: 'essay-1',
  provider: 'remote', status: 'success', totalScore: 12, maxScore: 15,
  dimensionScores: [], issues: [], sentenceRevisions: [], expressionUpgrades: [],
  recognitionWarnings: [], legibilityIssues: [],
  overallComment: 'Synthetic.', reviewReasons: [], createdAt: '2026-07-20T00:01:00.000Z',
}

const failureResult: GradingFailureV1 = {
  requestId: 'request-1', status: 'failed',
  error: { code: 'provider_timeout', message: 'Timed out.', retryable: true },
}

describe('grading state transitions', () => {
  it('begins only from an actionable state and stores the request id', () => {
    const started = beginGradingAttempt([essay()], 'essay-1', 'request-1', '2026-07-20T00:00:00.000Z')
    expect(started.applied).toBe(true)
    expect(started.essays[0]).toMatchObject({
      status: 'grading', teacherReviewed: false,
      gradingRun: { status: 'running', requestId: 'request-1' },
    })
    expect(beginGradingAttempt([essay('manual')], 'essay-1', 'request-1', 'now').applied).toBe(false)
  })

  it('settles a matching success as unreviewed grading_ready', () => {
    const transition = settleGradingSuccess(
      [essayRunning('request-1')], 'essay-1', 'request-1', 'essay-1-result', successResult,
    )
    expect(transition.applied).toBe(true)
    expect(transition.essays[0]).toMatchObject({
      status: 'grading_ready', aiResultId: 'essay-1-result', teacherReviewed: false,
      gradingRun: { status: 'success', requestId: 'request-1', source: 'remote' },
    })
  })

  it('copies a Kimi transcript to the compatible essay text without inventing an OCR audit', () => {
    const transition = settleGradingSuccess(
      [{ ...essayRunning('request-1'), ocrText: '', ocrAudit: undefined }],
      'essay-1', 'request-1', 'essay-1-result',
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
      [current], 'essay-1', 'request-1', 'essay-1-result',
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
      'essay-1', 'request-1', 'essay-1-result',
      { ...successResult, transcript: 'Kimi transcript.', recognitionWarnings: [], printedTextExcluded: true },
      { transcriptSource: 'teacher_confirmed', confirmedTranscript: teacherText },
    )
    expect(transition.essays[0]).toMatchObject({ ocrText: teacherText, transcriptSource: 'teacher_confirmed' })
    expect(transition.essays[0].ocrText).not.toBe('Kimi transcript.')
  })

  it('settles a matching failure into an actionable pending state', () => {
    const transition = settleGradingFailure(
      [essayRunning('request-1')], 'essay-1', 'request-1', failureResult, '2026-07-20T00:01:00.000Z',
    )
    expect(transition.applied).toBe(true)
    expect(transition.essays[0]).toMatchObject({
      status: 'pending_grading', teacherReviewed: false,
      gradingRun: { status: 'failed', requestId: 'request-1', errorCode: 'provider_timeout', retryable: true },
    })
  })

  it('ignores a late success from an older request', () => {
    const current = essayRunning('request-new')
    const transition = settleGradingSuccess(
      [current], 'essay-1', 'request-old', 'essay-1-result',
      { ...successResult, requestId: 'request-old' },
    )
    expect(transition.applied).toBe(false)
    expect(transition.essays).toEqual([current])
  })

  it('ignores a late failure from an older request', () => {
    const current = essayRunning('request-new')
    const transition = settleGradingFailure(
      [current], 'essay-1', 'request-old', { ...failureResult, requestId: 'request-old' }, 'later',
    )
    expect(transition.applied).toBe(false)
    expect(transition.essays).toEqual([current])
  })

  it('ignores success and failure after the essay moved to manual handling', () => {
    const manual = markEssayManualTransition(
      [essayRunning('request-1')], 'essay-1', '2026-07-20T00:00:30.000Z',
    ).essays[0]
    expect(settleGradingSuccess([manual], 'essay-1', 'request-1', 'result', successResult).applied).toBe(false)
    expect(settleGradingFailure([manual], 'essay-1', 'request-1', failureResult, 'later').applied).toBe(false)
    expect(manual).toMatchObject({
      status: 'manual', teacherReviewed: true,
      gradingRun: { status: 'failed', requestId: 'request-1', errorCode: 'manual_override' },
    })
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
