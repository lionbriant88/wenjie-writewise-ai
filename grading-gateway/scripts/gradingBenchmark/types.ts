export const GRADING_BENCHMARK_MANIFEST_VERSION = 'grading-benchmark-manifest-v1' as const

export const BENCHMARK_PAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type BenchmarkPageMimeType = (typeof BENCHMARK_PAGE_MIME_TYPES)[number]
export type BenchmarkPageSourceKind = 'image' | 'pdf_page'
export type BenchmarkPageStratum = 'single_page' | 'multi_page_or_pdf'
export type BenchmarkLegibilityStratum = 'clear' | 'difficult'
export type BenchmarkScoreBand = 'low' | 'middle' | 'high'

export type GradingBenchmarkPage = {
  pageOrder: number
  path: string
  mimeType: BenchmarkPageMimeType
  sourceKind: BenchmarkPageSourceKind
}

export type GradingBenchmarkStrata = {
  page: BenchmarkPageStratum
  legibility: BenchmarkLegibilityStratum
  scoreBand: BenchmarkScoreBand
}

export type GradingBenchmarkSample = {
  id: string
  pages: GradingBenchmarkPage[]
  teacherTranscript: string
  fullScore: number
  teacherScore: number
  importantIssueLabels: string[]
  importantLegibilityLabels: string[]
  strata: GradingBenchmarkStrata
}

export type GradingBenchmarkManifest = {
  manifestVersion: typeof GRADING_BENCHMARK_MANIFEST_VERSION
  samples: GradingBenchmarkSample[]
}

export type GradingBenchmarkFileSystem = {
  realpath(path: string): Promise<string>
}

export type ManifestValidationOptions = {
  privateRoot: string
  fileSystem: GradingBenchmarkFileSystem
}

export type ValidatedDatasetManifest = {
  manifest: GradingBenchmarkManifest
  manifestSha256: string
}

export type DatasetComposition = {
  essayCount: number
  strataCounts: {
    singlePage: number
    multiPageOrPdf: number
    clear: number
    difficult: number
    low: number
    middle: number
    high: number
  }
}

export type ManifestValidationErrorCode =
  | 'invalid_manifest'
  | 'invalid_manifest_fields'
  | 'invalid_manifest_version'
  | 'invalid_samples'
  | 'invalid_sample_fields'
  | 'invalid_sample_id'
  | 'invalid_pages'
  | 'invalid_page_fields'
  | 'invalid_page_order'
  | 'invalid_page_path'
  | 'page_path_outside_private_root'
  | 'page_realpath_outside_private_root'
  | 'invalid_page_mime_type'
  | 'invalid_page_source_kind'
  | 'invalid_teacher_transcript'
  | 'invalid_full_score'
  | 'invalid_teacher_score'
  | 'invalid_important_issue_labels'
  | 'invalid_important_legibility_labels'
  | 'invalid_strata_fields'
  | 'invalid_page_stratum'
  | 'invalid_legibility_stratum'
  | 'invalid_score_band'
  | 'duplicate_sample_id'
  | 'invalid_dataset_composition'
