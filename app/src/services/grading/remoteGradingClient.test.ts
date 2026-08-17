import { describe, expect, it, vi } from 'vitest'
import { createRemoteGradingClient } from './remoteGradingClient'
import type { MultimodalGradingRequestV2 } from './types'

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
      requestId: request.requestId, status: 'failed', error: { code: 'gateway_unavailable', retryable: false },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
