import type { OcrReviewTextMetrics } from './textMetrics'

export const OCR_AUDIT_VERSION = 'ocr-audit-v1' as const
export const OCR_SHADOW_ASSESSMENT_VERSION = 'ocr-shadow-v1' as const

export type OcrAuditSourceKind = 'mock' | 'remote' | 'manual'
export type OcrShadowOutcome = 'no_obvious_risk' | 'review_recommended' | 'insufficient_evidence'

export type OcrShadowReasonCode =
  | 'empty_text'
  | 'page_result_missing'
  | 'partial_page_failure'
  | 'failed_result'
  | 'confidence_observed'
  | 'confidence_unavailable'
  | 'suspected_hyphen_break_observed'

export interface OcrShadowReason {
  code: OcrShadowReasonCode
  severity: 'info' | 'warning' | 'critical'
  value?: number
}

export interface OcrShadowAssessment {
  assessmentVersion: typeof OCR_SHADOW_ASSESSMENT_VERSION
  outcome: OcrShadowOutcome
  reasons: OcrShadowReason[]
  assessedAt: string
}

export interface PendingOcrTranscriptAudit {
  auditVersion: typeof OCR_AUDIT_VERSION
  sourceKind: OcrAuditSourceKind
  sourceText: string
  shadowAssessment: OcrShadowAssessment
}

export type OcrReviewOutcome = OcrReviewTextMetrics

export interface OcrTranscriptAudit extends PendingOcrTranscriptAudit {
  confirmedTranscript: string
  reviewOutcome: OcrReviewOutcome
}
