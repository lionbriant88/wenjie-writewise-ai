import type { OcrEssayResult } from '../types'
import {
  OCR_SHADOW_ASSESSMENT_VERSION,
  type OcrAuditSourceKind,
  type OcrShadowAssessment,
  type OcrShadowReason,
} from './types'

interface AssessOcrShadowInput {
  sourceKind: OcrAuditSourceKind
  result?: OcrEssayResult
  expectedPageIds: readonly string[]
  assessedAt: string
}

export function assessOcrShadow({
  sourceKind,
  result,
  expectedPageIds,
  assessedAt,
}: AssessOcrShadowInput): OcrShadowAssessment {
  if (sourceKind !== 'remote' || !result) {
    return {
      assessmentVersion: OCR_SHADOW_ASSESSMENT_VERSION,
      outcome: 'insufficient_evidence',
      reasons: [],
      assessedAt,
    }
  }

  const reasons: OcrShadowReason[] = []
  const expectedPageIdSet = new Set(expectedPageIds)
  const actualPageIdSet = new Set(result.pages.map((page) => page.pageId))
  const missingPageCount = [...expectedPageIdSet].filter((pageId) => !actualPageIdSet.has(pageId)).length

  if (missingPageCount > 0) {
    reasons.push({ code: 'page_result_missing', severity: 'critical', value: missingPageCount })
  }
  if (result.text.trim().length === 0) {
    reasons.push({ code: 'empty_text', severity: 'critical' })
  }
  if (result.status === 'partial') {
    reasons.push({ code: 'partial_page_failure', severity: 'critical' })
  }
  if (result.status === 'failed') {
    reasons.push({ code: 'failed_result', severity: 'critical' })
  }

  const confidences = result.pages
    .map((page) => page.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (confidences.length === 0) {
    reasons.push({ code: 'confidence_unavailable', severity: 'info' })
  } else {
    reasons.push({
      code: 'confidence_observed',
      severity: 'info',
      value: confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
    })
  }

  const suspectedHyphenCount = Array.from(result.text.matchAll(/-\n(?=[a-z])/g)).length
  if (suspectedHyphenCount > 0) {
    reasons.push({
      code: 'suspected_hyphen_break_observed',
      severity: 'info',
      value: suspectedHyphenCount,
    })
  }

  return {
    assessmentVersion: OCR_SHADOW_ASSESSMENT_VERSION,
    outcome: reasons.some((reason) => reason.severity === 'critical') ? 'review_recommended' : 'no_obvious_risk',
    reasons,
    assessedAt,
  }
}
