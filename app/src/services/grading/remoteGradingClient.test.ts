import { describe, expect, it, vi } from 'vitest'
import { attachSafeFailureMetadata, createRemoteGradingClient } from './remoteGradingClient'
import type { GradingFailureV1, MultimodalGradingRequestV2 } from './types'

function successBody(originalText: string) {
  return {
    resultVersion: 'grading-result-v2', requestId: 'request-1', essayId: 'essay-1',
    provider: 'remote', status: 'success', totalScore: 12, maxScore: 15,
    dimensionScores: [{
      dimensionId: 'content', name: 'Content', score: 12, maxScore: 15, weight: 100,
      reason: 'Accurate.', evidence: originalText,
    }],
    issues: [], sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { originalText, correctedText: originalText, improvedText: originalText, sentencePairs: [], logicNotes: [], logicIssues: [] },
    overallComment: 'Synthetic.',
    recognitionWarnings: [], legibilityIssues: [], reviewReasons: [], createdAt: '2026-07-20T00:00:00.000Z',
  }
}

function imageRequest(): MultimodalGradingRequestV2 {
  return {
    requestVersion: 'multimodal-grading-request-v2', requestId: 'image-request', essayId: 'image-essay', pageIds: ['page-1', 'page-2'],
    task: { taskId: 'task-image', fullScore: 15, materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Image task', materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: ['Material.'] }] } },
    pages: [{ pageId: 'page-1', file: new File(['first'], 'first.png', { type: 'image/png' }) }, { pageId: 'page-2', file: new File(['second'], 'second.png', { type: 'image/png' }) }],
  }
}

describe('createRemoteGradingClient', () => {
  it('posts ordered image files to the multimodal endpoint without binary metadata and projects transcript fields', async () => {
    const request = imageRequest()
    const body = { ...successBody('Student text.'), requestId: request.requestId, essayId: request.essayId, status: 'partial', transcript: 'Student text.', recognitionWarnings: ['One word unclear.'], printedTextExcluded: true, reviewReasons: ['recognition_uncertain'] }
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
    const result = await createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl }).gradeImages!(request)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const form = init.body as FormData
    const metadata = JSON.parse(String(form.get('metadata')))
    expect(fetchImpl).toHaveBeenCalledWith('http://gateway/grading/grade-images', expect.objectContaining({ method: 'POST' }))
    expect(metadata).toEqual({ requestVersion: 'multimodal-grading-request-v2', requestId: request.requestId, essayId: request.essayId, pageIds: ['page-1', 'page-2'], task: request.task })
    expect(JSON.stringify(metadata)).not.toContain('first')
    expect(form.getAll('pages').map((file) => (file as File).name)).toEqual(['first.png', 'second.png'])
    expect(result).toMatchObject({ status: 'partial', transcript: 'Student text.', recognitionWarnings: ['One word unclear.'], printedTextExcluded: true, reviewReasons: ['recognition_uncertain'] })
  })

  it('sends a teacher-confirmed transcript without page IDs or image files', async () => {
    const request = {
      ...imageRequest(),
      pageIds: [],
      pages: [],
      confirmedTranscript: 'Teacher \u{1F600} corrected transcript.',
    }
    const body = { ...successBody(request.confirmedTranscript), requestId: request.requestId, essayId: request.essayId, transcript: request.confirmedTranscript, recognitionWarnings: [], printedTextExcluded: true }
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
    await createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl }).gradeImages!(request)
    const form = (fetchImpl.mock.calls[0][1] as RequestInit).body as FormData
    const metadata = JSON.parse(String(form.get('metadata')))
    expect(metadata.confirmedTranscript).toBe('Teacher \u{1F600} corrected transcript.')
    expect(metadata.pageIds).toEqual([])
    expect(form.getAll('pages')).toEqual([])
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects mixed confirmed-text and image mode before configuration or fetch', async () => {
    const request = { ...imageRequest(), confirmedTranscript: 'Teacher-confirmed text.' }
    const fetchImpl = vi.fn()

    await expect(createRemoteGradingClient({ fetchImpl }).gradeImages(request)).resolves.toMatchObject({
      requestId: request.requestId,
      status: 'failed',
      error: { code: 'invalid_request', retryable: false },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['lone high surrogate', `Teacher ${'\uD800'} text.`],
    ['lone low surrogate', `Teacher ${'\uDC00'} text.`],
  ])('rejects a %s in confirmed text before configuration or fetch', async (_label, confirmedTranscript) => {
    const request = { ...imageRequest(), pageIds: [], pages: [], confirmedTranscript }
    const fetchImpl = vi.fn()

    await expect(createRemoteGradingClient({ fetchImpl }).gradeImages(request)).resolves.toMatchObject({
      requestId: request.requestId,
      status: 'failed',
      error: { code: 'invalid_request', retryable: false },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps multimodal network and malformed responses to safe local failures', async () => {
    const request = imageRequest()
    const unavailable = await createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl: vi.fn().mockRejectedValue(new Error('SECRET')) }).gradeImages!(request)
    expect(unavailable).toMatchObject({ status: 'failed', error: { code: 'gateway_unavailable' } })
    const malformed = await createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) }).gradeImages!(request)
    expect(malformed).toMatchObject({ status: 'failed', error: { code: 'gateway_invalid_response' } })
  })
  it('fails without attempting fetch when the base URL is missing', async () => {
    const request = imageRequest()
    const fetchImpl = vi.fn()
    await expect(createRemoteGradingClient({ fetchImpl }).gradeImages(request)).resolves.toMatchObject({
      requestId: request.requestId, status: 'failed', error: { code: 'provider_not_configured', retryable: false },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('adds a valid Retry-After only as local client metadata after strict body projection', async () => {
    const request = imageRequest()
    const rawMessage = 'PRIVATE-UPSTREAM-RATE-LIMIT'
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_rate_limited', message: rawMessage, retryable: true },
      }), { status: 429, headers: { 'Retry-After': '7' } }))
    const result = await createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl }).gradeImages(request)

    expect(result).toEqual({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_rate_limited', message: '批改服务繁忙，请稍后重试。', retryable: true },
      clientMeta: { retryAfterMs: 7_000 },
    })
    expect(JSON.stringify(result)).not.toContain(rawMessage)
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData
    expect(String(form.get('metadata'))).not.toContain('clientMeta')
  })

  it('does not attach Retry-After metadata when the Gateway failure body fails strict projection', async () => {
    const request = imageRequest()
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId,
      status: 'failed',
      error: { code: 'provider_rate_limited', message: 'PRIVATE', retryable: true },
      unexpected: 'PRIVATE',
    }), { status: 429, headers: { 'Retry-After': '7' } }))

    const result = await createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl }).gradeImages(request)

    expect(result).toEqual({
      requestId: request.requestId,
      status: 'failed',
      error: {
        code: 'gateway_invalid_response',
        message: '批改服务返回了无法安全使用的响应，请重试。',
        retryable: true,
      },
    })
    expect(result).not.toHaveProperty('clientMeta')
  })

  it('classifies result-unknown as same-logical-work reattachment only', async () => {
    const request = imageRequest()
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_result_unknown', message: 'PRIVATE-UNKNOWN-DETAIL', retryable: false },
    }), { status: 503 }))
    const result = await createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl }).gradeImages(request)

    expect(result).toEqual({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_result_unknown', message: '批改结果仍在确认中，请检查同一任务。', retryable: false },
      clientMeta: { reattachOnly: true },
    })
  })

  it.each([
    ['leading-zero delay seconds', '007', 7_000],
    ['IMF-fixdate', 'Tue, 01 Jan 2030 00:00:05 GMT', 5_000],
    ['obsolete RFC850 date', 'Tuesday, 01-Jan-30 00:00:05 GMT', 5_000],
    ['asctime date', 'Tue Jan  1 00:00:05 2030', 5_000],
  ])('parses %s Retry-After without shortening it or mutating the public failure', (_label, header, expectedMs) => {
    const failure: GradingFailureV1 = {
      requestId: 'request-date', status: 'failed',
      error: { code: 'provider_rate_limited', message: 'Safe.', retryable: true },
    }
    const result = attachSafeFailureMetadata(
      failure,
      new Headers({ 'Retry-After': header }),
      Date.UTC(2030, 0, 1, 0, 0, 0),
    )
    expect(result).toEqual({ ...failure, clientMeta: { retryAfterMs: expectedMs } })
    expect(failure).not.toHaveProperty('clientMeta')
  })

  it.each([
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['non-finite', 'Infinity'],
    ['overflow', '99999999999999999999999999999999'],
    ['non-HTTP date', '2030-01-01T00:00:05.000Z'],
    ['past date', 'Mon, 31 Dec 2029 23:59:59 GMT'],
  ])('ignores malformed or unsafe Retry-After: %s', (_label, header) => {
    const failure: GradingFailureV1 = {
      requestId: 'request-invalid-header', status: 'failed',
      error: { code: 'provider_rate_limited', message: 'Safe.', retryable: true },
    }
    expect(attachSafeFailureMetadata(
      failure,
      new Headers({ 'Retry-After': header }),
      Date.UTC(2030, 0, 1),
    )).toEqual(failure)
  })
})
