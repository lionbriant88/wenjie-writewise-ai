import { gatewayInvalidResponse, projectGradingClientResponse } from './projectGradingClientResponse'
import type { GradingClient } from './types'
import { validateMultimodalGradingRequestMode } from './validateMultimodalGradingRequestMode'

interface RemoteClientOptions {
  apiBase?: string
  fetchImpl?: typeof fetch
}

export function createRemoteGradingClient({
  apiBase,
  fetchImpl = fetch,
}: RemoteClientOptions): GradingClient {
  return {
    async gradeImages(request) {
      const requestMode = validateMultimodalGradingRequestMode(request)
      if (!requestMode.ok) {
        return { requestId: request.requestId, status: 'failed', error: { code: 'invalid_request', message: 'Grading request is invalid.', retryable: false } }
      }
      if (!apiBase) {
        return { requestId: request.requestId, status: 'failed', error: { code: 'gateway_unavailable', message: '未配置批改服务地址，请使用 mock 回退。', retryable: false } }
      }
      const form = new FormData()
      const isConfirmedTextRegrade = requestMode.mode === 'confirmed_text'
      form.append('metadata', JSON.stringify({
        requestVersion: request.requestVersion,
        requestId: request.requestId, essayId: request.essayId, pageIds: isConfirmedTextRegrade ? [] : request.pageIds, task: request.task,
        ...(request.confirmedTranscript !== undefined ? { confirmedTranscript: request.confirmedTranscript } : {}),
      }))
      if (!isConfirmedTextRegrade) request.pages.forEach(({ file }) => form.append('pages', file, file.name))
      let response: Response
      try {
        response = await fetchImpl(`${apiBase.replace(/\/$/, '')}/grading/grade-images`, {
          method: 'POST', headers: { 'X-Grading-Request-Id': request.requestId }, body: form,
        })
      } catch {
        return { requestId: request.requestId, status: 'failed', error: { code: 'gateway_unavailable', message: '批改服务暂时不可用，请重试或使用 mock 回退。', retryable: true } }
      }
      let body: unknown
      try { body = await response.json() } catch { return gatewayInvalidResponse(request.requestId) }
      return projectGradingClientResponse(body, {
        httpOk: response.ok,
        requestId: request.requestId,
        essayId: request.essayId,
        task: request.task,
        requireMultimodal: true,
        inputMode: isConfirmedTextRegrade ? 'confirmed_text' : 'images',
        ...(request.confirmedTranscript !== undefined ? { confirmedTranscript: request.confirmedTranscript } : {}),
        pageCount: request.pages.length,
        fullScore: request.task.fullScore,
      })
    },
  }
}
