import { isWellFormedUnicode } from './gradingResultSemantics.js'

interface MultimodalGradingRequestModeInput {
  confirmedTranscript?: unknown
  pageIds: readonly unknown[]
  pages: readonly unknown[]
}

export type MultimodalGradingRequestModeValidation =
  | { ok: true; mode: 'images' | 'confirmed_text' }
  | { ok: false }

export function validateMultimodalGradingRequestMode(
  request: MultimodalGradingRequestModeInput,
): MultimodalGradingRequestModeValidation {
  if (request.confirmedTranscript !== undefined) {
    return typeof request.confirmedTranscript === 'string'
      && request.confirmedTranscript.trim().length > 0
      && request.confirmedTranscript.length <= 50_000
      && isWellFormedUnicode(request.confirmedTranscript)
      && request.pageIds.length === 0
      && request.pages.length === 0
      ? { ok: true, mode: 'confirmed_text' }
      : { ok: false }
  }

  return request.pageIds.length > 0
    && request.pages.length === request.pageIds.length
    ? { ok: true, mode: 'images' }
    : { ok: false }
}
