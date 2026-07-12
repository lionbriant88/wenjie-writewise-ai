import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { calculateBenchmarkMetrics, OCR_TEXT_METRICS_VERSION } from '../../../app/src/services/ocr/audit/textMetrics.js'
import type { OcrProvider } from '../../src/providers/providerTypes.js'
import type { GatewayPageInput } from '../../src/types.js'
import type {
  AnonymousBenchmarkSummary,
  AnonymousSampleResult,
  PrivateSampleCategory,
  PrivateSampleManifest,
} from './types.js'

const anonymousSampleIdPattern = /^sample-\d{3,4}$/
const privateSampleCategories = new Set<PrivateSampleCategory>([
  'clear',
  'general_handwriting',
  'messy_handwriting',
  'tilted',
  'dark',
  'corrected',
  'multi_page',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseManifest(rawText: string): PrivateSampleManifest {
  const value: unknown = JSON.parse(rawText)
  if (
    !isRecord(value) ||
    typeof value.sampleId !== 'string' ||
    !anonymousSampleIdPattern.test(value.sampleId) ||
    typeof value.category !== 'string' ||
    !privateSampleCategories.has(value.category as PrivateSampleCategory) ||
    !Array.isArray(value.pages) ||
    value.pages.length === 0 ||
    !value.pages.every((page) => typeof page === 'string' && page.length > 0) ||
    typeof value.reference !== 'string' ||
    value.reference.length === 0 ||
    (value.confirmedMissingLineCount !== undefined &&
      (typeof value.confirmedMissingLineCount !== 'number' ||
        !Number.isInteger(value.confirmedMissingLineCount) ||
        value.confirmedMissingLineCount < 0))
  ) {
    throw new Error('invalid_manifest')
  }

  return value as unknown as PrivateSampleManifest
}

function resolveWithin(root: string, relativePath: string): string {
  const candidate = resolve(root, relativePath)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (candidate !== root && !candidate.startsWith(prefix)) throw new Error('invalid_manifest')
  return candidate
}

function mimeTypeFor(path: string): GatewayPageInput['mimeType'] {
  const extension = extname(path).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.png') return 'image/png'
  throw new Error('unsupported_image_type')
}

export interface RunPrivateBenchmarkInput {
  samplesRoot: string
  manifests: readonly string[]
  provider: OcrProvider
  nowMs?: () => number
}

export async function runPrivateBenchmark({
  samplesRoot,
  manifests,
  provider,
  nowMs = () => performance.now(),
}: RunPrivateBenchmarkInput): Promise<AnonymousBenchmarkSummary> {
  const samples: AnonymousSampleResult[] = []

  for (const manifestName of manifests) {
    const startedAt = nowMs()
    let manifest: PrivateSampleManifest | undefined

    try {
      manifest = parseManifest(await readFile(resolveWithin(samplesRoot, manifestName), 'utf8'))

      const sampleRoot = resolve(samplesRoot, manifest.sampleId)
      const pages = await Promise.all(
        manifest.pages.map(async (relativePath, index): Promise<GatewayPageInput> => {
          const imagePath = resolveWithin(sampleRoot, relativePath)
          const buffer = await readFile(imagePath)
          return {
            pageId: `page-${index + 1}`,
            originalName: `page-${index + 1}${extname(relativePath).toLowerCase()}`,
            mimeType: mimeTypeFor(relativePath),
            size: buffer.byteLength,
            buffer,
          }
        }),
      )
      const referenceText = await readFile(resolveWithin(sampleRoot, manifest.reference), 'utf8')
      const result = await provider.recognize({ essayGroupId: manifest.sampleId, pages })
      const metrics = calculateBenchmarkMetrics(result.text, referenceText)
      const warningCodes = [...new Set(result.pages.flatMap((page) => page.warnings ?? []))]
      const confidences = result.pages
        .map((page) => page.confidence)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

      samples.push({
        sampleId: manifest.sampleId,
        category: manifest.category,
        pageCount: pages.length,
        benchmarkStatus: result.status === 'failed' ? 'failed' : 'completed',
        ocrStatus: result.status,
        warningCodes,
        averageConfidence:
          confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : undefined,
        cer: metrics.cer,
        wer: metrics.wer,
        invalidReason: result.status === 'failed' ? 'provider_failed' : metrics.invalidReason,
        ...(manifest.confirmedMissingLineCount === undefined
          ? {}
          : { confirmedMissingLineCount: manifest.confirmedMissingLineCount }),
        durationMs: nowMs() - startedAt,
        metricsVersion: OCR_TEXT_METRICS_VERSION,
      })
    } catch (error) {
      const invalidReason =
        error instanceof Error && error.message === 'invalid_manifest' ? 'invalid_manifest' : 'unreadable_sample'
      samples.push({
        sampleId: manifest?.sampleId && anonymousSampleIdPattern.test(manifest.sampleId) ? manifest.sampleId : 'sample-000',
        category: manifest?.category ?? 'unknown',
        pageCount: manifest?.pages?.length ?? 0,
        benchmarkStatus: 'failed',
        warningCodes: [],
        cer: null,
        wer: null,
        invalidReason,
        durationMs: nowMs() - startedAt,
        metricsVersion: OCR_TEXT_METRICS_VERSION,
      })
    }
  }

  return {
    benchmarkVersion: 'private-ocr-benchmark-v1',
    completedSampleCount: samples.filter((sample) => sample.benchmarkStatus === 'completed').length,
    failedSampleCount: samples.filter((sample) => sample.benchmarkStatus === 'failed').length,
    samples,
  }
}
