import type { OcrTextMetricsVersion } from '../../../app/src/services/ocr/audit/textMetrics.js'
import type { OcrStatus } from '../../src/types.js'

export type PrivateSampleCategory =
  | 'clear'
  | 'general_handwriting'
  | 'messy_handwriting'
  | 'tilted'
  | 'dark'
  | 'corrected'
  | 'multi_page'

export interface PrivateSampleManifest {
  sampleId: string
  category: PrivateSampleCategory
  pages: string[]
  reference: string
  confirmedMissingLineCount?: number
}

export interface AnonymousSampleResult {
  sampleId: string
  category: string
  pageCount: number
  benchmarkStatus: 'completed' | 'failed'
  ocrStatus?: OcrStatus
  warningCodes: string[]
  averageConfidence?: number
  cer: number | null
  wer: number | null
  invalidReason?: 'empty_reference' | 'invalid_manifest' | 'unreadable_sample' | 'provider_failed'
  confirmedMissingLineCount?: number
  durationMs: number
  metricsVersion: OcrTextMetricsVersion
}

export interface AnonymousBenchmarkSummary {
  benchmarkVersion: 'private-ocr-benchmark-v1'
  completedSampleCount: number
  failedSampleCount: number
  samples: AnonymousSampleResult[]
}

export const BENCHMARK_EXIT_SUCCESS = 0 as const
export const BENCHMARK_EXIT_FATAL = 1 as const
export const BENCHMARK_EXIT_SAMPLE_FAILURE = 2 as const
export type BenchmarkExitCode = 0 | 1 | 2
