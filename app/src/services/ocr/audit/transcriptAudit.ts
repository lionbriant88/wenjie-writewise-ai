import type { OcrEssayResult } from '../types'
import { assessOcrShadow } from './assessOcrShadow'
import { calculateReviewTextMetrics } from './textMetrics'
import {
  OCR_AUDIT_VERSION,
  type OcrAuditSourceKind,
  type OcrTranscriptAudit,
  type PendingOcrTranscriptAudit,
} from './types'

interface CreatePendingOcrAuditInput {
  sourceKind: Exclude<OcrAuditSourceKind, 'manual'>
  result: OcrEssayResult
  expectedPageIds: readonly string[]
  assessedAt: string
}

export function createPendingOcrAudit({
  sourceKind,
  result,
  expectedPageIds,
  assessedAt,
}: CreatePendingOcrAuditInput): PendingOcrTranscriptAudit {
  return {
    auditVersion: OCR_AUDIT_VERSION,
    sourceKind,
    sourceText: result.text,
    shadowAssessment: assessOcrShadow({ sourceKind, result, expectedPageIds, assessedAt }),
  }
}

export function createManualPendingOcrAudit(
  expectedPageIds: readonly string[],
  assessedAt: string,
): PendingOcrTranscriptAudit {
  return {
    auditVersion: OCR_AUDIT_VERSION,
    sourceKind: 'manual',
    sourceText: '',
    shadowAssessment: assessOcrShadow({
      sourceKind: 'manual',
      expectedPageIds,
      assessedAt,
    }),
  }
}

export function confirmOcrAudit(
  pending: PendingOcrTranscriptAudit | OcrTranscriptAudit,
  confirmedTranscript: string,
  confirmedAt: string,
): OcrTranscriptAudit {
  return {
    ...pending,
    confirmedTranscript,
    reviewOutcome: calculateReviewTextMetrics(pending.sourceText, confirmedTranscript, confirmedAt),
  }
}
