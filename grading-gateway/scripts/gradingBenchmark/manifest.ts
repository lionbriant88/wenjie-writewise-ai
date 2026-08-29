import { createHash } from 'node:crypto'
import path from 'node:path'

import {
  BENCHMARK_PAGE_MIME_TYPES,
  GRADING_BENCHMARK_MANIFEST_VERSION,
  type BenchmarkLegibilityStratum,
  type BenchmarkPageMimeType,
  type BenchmarkPageSourceKind,
  type BenchmarkPageStratum,
  type BenchmarkScoreBand,
  type DatasetComposition,
  type GradingBenchmarkManifest,
  type GradingBenchmarkPage,
  type GradingBenchmarkSample,
  type GradingBenchmarkStrata,
  type ManifestValidationErrorCode,
  type ManifestValidationOptions,
  type ValidatedDatasetManifest,
} from './types.js'

export interface BenchmarkDatasetDigestSample {
  reference: GradingBenchmarkSample
  pages: readonly {
    mimeType: BenchmarkPageMimeType
    buffer: Uint8Array
  }[]
}

const MANIFEST_FIELDS = ['manifestVersion', 'samples'] as const
const SAMPLE_FIELDS = [
  'id',
  'pages',
  'teacherTranscript',
  'fullScore',
  'teacherScore',
  'importantIssueLabels',
  'importantLegibilityLabels',
  'strata',
] as const
const PAGE_FIELDS = ['pageOrder', 'path', 'mimeType', 'sourceKind'] as const
const STRATA_FIELDS = ['page', 'legibility', 'scoreBand'] as const
const LABEL_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/
const SAMPLE_ID_PATTERN = /^sample-[0-9]{3}$/

const sampleIdForIndex = (sampleIndex: number): string =>
  `sample-${String(sampleIndex + 1).padStart(3, '0')}`

export class ManifestValidationError extends Error {
  readonly code: ManifestValidationErrorCode

  constructor(code: ManifestValidationErrorCode) {
    super(code)
    this.name = 'ManifestValidationError'
    this.code = code
  }
}

function fail(code: ManifestValidationErrorCode): never {
  throw new ManifestValidationError(code)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

const requireExactRecord = (
  value: unknown,
  expected: readonly string[],
  invalidShapeCode: ManifestValidationErrorCode,
  invalidFieldsCode: ManifestValidationErrorCode,
): Record<string, unknown> => {
  if (!isRecord(value)) {
    fail(invalidShapeCode)
  }
  if (!hasExactKeys(value, expected)) {
    fail(invalidFieldsCode)
  }
  return value
}

const parseLabels = (
  value: unknown,
  code: 'invalid_important_issue_labels' | 'invalid_important_legibility_labels',
): string[] => {
  if (
    !Array.isArray(value) ||
    value.some((label) => typeof label !== 'string' || !LABEL_PATTERN.test(label)) ||
    new Set(value).size !== value.length
  ) {
    fail(code)
  }
  return [...value]
}

const parsePage = (value: unknown, expectedOrder: number): GradingBenchmarkPage => {
  const pageValue = requireExactRecord(
    value,
    PAGE_FIELDS,
    'invalid_page_fields',
    'invalid_page_fields',
  )
  if (pageValue.pageOrder !== expectedOrder) {
    fail('invalid_page_order')
  }
  if (
    typeof pageValue.path !== 'string' ||
    pageValue.path.length === 0 ||
    pageValue.path.includes('\0')
  ) {
    fail('invalid_page_path')
  }
  if (!BENCHMARK_PAGE_MIME_TYPES.includes(pageValue.mimeType as BenchmarkPageMimeType)) {
    fail('invalid_page_mime_type')
  }
  if (pageValue.sourceKind !== 'image' && pageValue.sourceKind !== 'pdf_page') {
    fail('invalid_page_source_kind')
  }
  return {
    pageOrder: expectedOrder,
    path: pageValue.path.replaceAll('\\', '/'),
    mimeType: pageValue.mimeType as BenchmarkPageMimeType,
    sourceKind: pageValue.sourceKind as BenchmarkPageSourceKind,
  }
}

const parseStrata = (value: unknown): GradingBenchmarkStrata => {
  const strataValue = requireExactRecord(
    value,
    STRATA_FIELDS,
    'invalid_strata_fields',
    'invalid_strata_fields',
  )
  if (strataValue.page !== 'single_page' && strataValue.page !== 'multi_page_or_pdf') {
    fail('invalid_page_stratum')
  }
  if (strataValue.legibility !== 'clear' && strataValue.legibility !== 'difficult') {
    fail('invalid_legibility_stratum')
  }
  if (
    strataValue.scoreBand !== 'low' &&
    strataValue.scoreBand !== 'middle' &&
    strataValue.scoreBand !== 'high'
  ) {
    fail('invalid_score_band')
  }
  return {
    page: strataValue.page as BenchmarkPageStratum,
    legibility: strataValue.legibility as BenchmarkLegibilityStratum,
    scoreBand: strataValue.scoreBand as BenchmarkScoreBand,
  }
}

const parseSample = (value: unknown, sampleIndex: number): GradingBenchmarkSample => {
  const sampleValue = requireExactRecord(
    value,
    SAMPLE_FIELDS,
    'invalid_sample_fields',
    'invalid_sample_fields',
  )
  if (
    typeof sampleValue.id !== 'string' ||
    !SAMPLE_ID_PATTERN.test(sampleValue.id) ||
    sampleValue.id !== sampleIdForIndex(sampleIndex)
  ) {
    fail('invalid_sample_id')
  }
  if (!Array.isArray(sampleValue.pages) || sampleValue.pages.length === 0) {
    fail('invalid_pages')
  }
  const pages = sampleValue.pages.map((pageValue, index) => parsePage(pageValue, index + 1))
  if (
    typeof sampleValue.teacherTranscript !== 'string' ||
    sampleValue.teacherTranscript.trim().length === 0
  ) {
    fail('invalid_teacher_transcript')
  }
  if (
    typeof sampleValue.fullScore !== 'number' ||
    !Number.isFinite(sampleValue.fullScore) ||
    sampleValue.fullScore <= 0
  ) {
    fail('invalid_full_score')
  }
  if (
    typeof sampleValue.teacherScore !== 'number' ||
    !Number.isFinite(sampleValue.teacherScore) ||
    sampleValue.teacherScore < 0 ||
    sampleValue.teacherScore > sampleValue.fullScore
  ) {
    fail('invalid_teacher_score')
  }
  const strata = parseStrata(sampleValue.strata)
  const isMultiPageOrPdf = pages.length > 1 || pages.some((page) => page.sourceKind === 'pdf_page')
  if (
    (strata.page === 'single_page' && isMultiPageOrPdf) ||
    (strata.page === 'multi_page_or_pdf' && !isMultiPageOrPdf)
  ) {
    fail('invalid_page_stratum')
  }
  return {
    id: sampleValue.id,
    pages,
    teacherTranscript: sampleValue.teacherTranscript,
    fullScore: sampleValue.fullScore,
    teacherScore: sampleValue.teacherScore,
    importantIssueLabels: parseLabels(
      sampleValue.importantIssueLabels,
      'invalid_important_issue_labels',
    ),
    importantLegibilityLabels: parseLabels(
      sampleValue.importantLegibilityLabels,
      'invalid_important_legibility_labels',
    ),
    strata,
  }
}

const isAbsoluteOnAnySupportedPlatform = (candidate: string): boolean =>
  path.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate)

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/** Pure canonical-reference validation for already loaded benchmark samples. */
export const validateBenchmarkSampleReference = (
  value: unknown,
  sampleIndex: number,
): GradingBenchmarkSample | null => {
  try {
    const parsed = parseSample(value, sampleIndex)
    if (parsed.pages.length > 10) return null
    for (const page of parsed.pages) {
      const normalizedPath = path.posix.normalize(page.path)
      if (
        isAbsoluteOnAnySupportedPlatform(page.path) ||
        normalizedPath === '..' ||
        normalizedPath.startsWith('../')
      ) return null
    }
    return JSON.stringify(parsed) === JSON.stringify(value) ? parsed : null
  } catch {
    return null
  }
}

const assertPagePathsInsidePrivateRoot = async (
  manifest: GradingBenchmarkManifest,
  options: ManifestValidationOptions,
): Promise<void> => {
  if (!path.isAbsolute(options.privateRoot)) {
    fail('page_path_outside_private_root')
  }
  const lexicalRoot = path.resolve(options.privateRoot)
  const realRoot = path.resolve(await options.fileSystem.realpath(lexicalRoot))

  for (const sample of manifest.samples) {
    for (const page of sample.pages) {
      if (isAbsoluteOnAnySupportedPlatform(page.path)) {
        fail('page_path_outside_private_root')
      }
      const lexicalPage = path.resolve(lexicalRoot, page.path)
      if (!isWithin(lexicalRoot, lexicalPage)) {
        fail('page_path_outside_private_root')
      }
      const realPage = path.resolve(await options.fileSystem.realpath(lexicalPage))
      if (!isWithin(realRoot, realPage)) {
        fail('page_realpath_outside_private_root')
      }
    }
  }
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const computeManifestSha256 = (manifest: GradingBenchmarkManifest): string =>
  createHash('sha256').update(canonicalJson(manifest), 'utf8').digest('hex')

const updateFramedHash = (hash: ReturnType<typeof createHash>, value: Uint8Array): void => {
  const length = Buffer.allocUnsafe(8)
  length.writeBigUInt64BE(BigInt(value.byteLength))
  hash.update(length)
  hash.update(value)
}

const utf8Frame = (value: string): Buffer => Buffer.from(value, 'utf8')

/** Matches the private-bundle framing contract without retaining any source path. */
export const computeDatasetSha256 = (
  manifestSha256: string,
  samples: readonly BenchmarkDatasetDigestSample[],
): string => {
  const manifest: GradingBenchmarkManifest = {
    manifestVersion: GRADING_BENCHMARK_MANIFEST_VERSION,
    samples: samples.map(({ reference }) => reference),
  }
  const hash = createHash('sha256')
  updateFramedHash(hash, utf8Frame('grading-benchmark-dataset-v1'))
  updateFramedHash(hash, utf8Frame(manifestSha256))
  updateFramedHash(hash, utf8Frame(JSON.stringify(manifest)))
  updateFramedHash(hash, utf8Frame(String(samples.length)))
  for (const sample of samples) {
    updateFramedHash(hash, utf8Frame(sample.reference.id))
    updateFramedHash(hash, utf8Frame(String(sample.pages.length)))
    for (let pageIndex = 0; pageIndex < sample.pages.length; pageIndex += 1) {
      const page = sample.pages[pageIndex]
      updateFramedHash(hash, utf8Frame(String(pageIndex + 1)))
      updateFramedHash(hash, utf8Frame(page.mimeType))
      updateFramedHash(hash, page.buffer)
    }
  }
  return hash.digest('hex')
}

export const validateDatasetManifest = async (
  input: unknown,
  options: ManifestValidationOptions,
): Promise<ValidatedDatasetManifest> => {
  const manifestValue = requireExactRecord(
    input,
    MANIFEST_FIELDS,
    'invalid_manifest',
    'invalid_manifest_fields',
  )
  if (manifestValue.manifestVersion !== GRADING_BENCHMARK_MANIFEST_VERSION) {
    fail('invalid_manifest_version')
  }
  if (!Array.isArray(manifestValue.samples) || manifestValue.samples.length === 0) {
    fail('invalid_samples')
  }
  const manifest: GradingBenchmarkManifest = {
    manifestVersion: GRADING_BENCHMARK_MANIFEST_VERSION,
    samples: manifestValue.samples.map((sample, sampleIndex) => parseSample(sample, sampleIndex)),
  }
  await assertPagePathsInsidePrivateRoot(manifest, options)
  return {
    manifest,
    manifestSha256: computeManifestSha256(manifest),
  }
}

export const validateDatasetComposition = (
  manifest: GradingBenchmarkManifest,
): DatasetComposition => {
  const ids = new Set<string>()
  for (const sample of manifest.samples) {
    if (ids.has(sample.id)) {
      fail('duplicate_sample_id')
    }
    ids.add(sample.id)
  }

  const composition: DatasetComposition = {
    essayCount: manifest.samples.length,
    strataCounts: {
      singlePage: 0,
      multiPageOrPdf: 0,
      clear: 0,
      difficult: 0,
      low: 0,
      middle: 0,
      high: 0,
    },
  }
  for (const sample of manifest.samples) {
    composition.strataCounts[
      sample.strata.page === 'single_page' ? 'singlePage' : 'multiPageOrPdf'
    ] += 1
    composition.strataCounts[sample.strata.legibility] += 1
    composition.strataCounts[sample.strata.scoreBand] += 1
  }

  if (
    composition.essayCount < 40 ||
    Object.values(composition.strataCounts).some((count) => count < 8)
  ) {
    fail('invalid_dataset_composition')
  }
  return composition
}
