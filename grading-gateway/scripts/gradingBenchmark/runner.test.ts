import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'
import { ESSAY_PROVIDER_SCHEMA_VERSION, LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION } from '../../src/multimodal/modelTaskContext.js'

import type { ConfirmedTaskPackageV2 } from '../../src/multimodal/types.js'
import type {
  GatewayImageInput,
  GradeEssayProviderInput,
  MultimodalProvider,
} from '../../src/providers/multimodalProviderTypes.js'
import type {
  ProviderAttemptObservation,
  ProviderCallResult,
} from '../../src/providers/providerTypes.js'
import type { GradingBenchmarkSample } from './types.js'
import { computeManifestSha256 } from './manifest.js'
import {
  isBenchmarkAggregateReport,
  runGradingBenchmark as runGradingBenchmarkImpl,
  type BenchmarkProvenance,
  type BenchmarkRunnerDependencies,
  type BenchmarkRunnerInput,
  type BenchmarkRunnerSample,
} from './runner.js'

const PRIVATE_TRANSCRIPT = 'PRIVATE_TEACHER_TRANSCRIPT_MARKER'
const PRIVATE_PATH = 'nested/private-student-file-marker.png'
const PRIVATE_IMAGE = 'PRIVATE_IMAGE_BYTES_MARKER'
const PRIVATE_TASK = 'PRIVATE_TASK_CONTENT_MARKER'
const PRIVATE_UPSTREAM = 'PRIVATE_UPSTREAM_RESPONSE_MARKER'

const task: ConfirmedTaskPackageV2 = {
  taskId: 'task-benchmark',
  fullScore: 15,
  materialSummary: 'Write a short English response.',
  writingRequirements: ['Address the scenario.'],
  constraints: ['Use English.'],
  rubric: {
    taskName: 'Synthetic benchmark task',
    materialSummary: 'Write a short English response.',
    writingRequirements: ['Address the scenario.'],
    constraints: ['Use English.'],
    dimensions: [
      {
        id: 'content',
        name: 'Content',
        weight: 40,
        description: 'Relevant.',
        deductionFocus: [],
        sourceEvidence: [],
      },
      {
        id: 'language',
        name: 'Language',
        weight: 55,
        description: 'Accurate.',
        deductionFocus: [],
        sourceEvidence: [],
      },
      {
        id: 'legibility',
        name: 'Legibility',
        weight: 5,
        description: 'Readable.',
        deductionFocus: [],
        sourceEvidence: [],
      },
    ],
    reviewWarnings: [],
  },
}

function clonedTask(): ConfirmedTaskPackageV2 {
  return structuredClone(task)
}

const provenance: BenchmarkProvenance = {
  benchmarkVersion: 'grading-benchmark-v1',
  gitCommit: '0123456789abcdef0123456789abcdef01234567',
  model: 'kimi-k3',
  reasoningEffort: 'low',
  policyVersion: 'grading-policy-v1',
  providerSchemaVersion: ESSAY_PROVIDER_SCHEMA_VERSION,
  phaseBudgets: {
    material_context: 4_096,
    rubric_generation: 8_192,
    essay_grading_images: 16_384,
    essay_regrading_text: 16_384,
  },
  featureProfiles: {
    image: 'original-v1',
    output: 'deduplicated-v1',
    prompt: 'optimized-v1',
  },
  manifestSha256: 'a'.repeat(64),
  datasetSha256: 'd'.repeat(64),
}

function updateFramedHash(hash: ReturnType<typeof createHash>, value: Uint8Array): void {
  const length = Buffer.allocUnsafe(8)
  length.writeBigUInt64BE(BigInt(value.byteLength))
  hash.update(length)
  hash.update(value)
}

function computeTestDatasetSha256(
  manifestSha256: string,
  samples: readonly BenchmarkRunnerSample[],
): string {
  const manifest = {
    manifestVersion: 'grading-benchmark-manifest-v1' as const,
    samples: samples.map(({ reference }) => reference),
  }
  const hash = createHash('sha256')
  const frame = (value: string): Buffer => Buffer.from(value, 'utf8')
  updateFramedHash(hash, frame('grading-benchmark-dataset-v1'))
  updateFramedHash(hash, frame(manifestSha256))
  updateFramedHash(hash, frame(JSON.stringify(manifest)))
  updateFramedHash(hash, frame(String(samples.length)))
  for (const sample of samples) {
    updateFramedHash(hash, frame(sample.reference.id))
    updateFramedHash(hash, frame(String(sample.pages.length)))
    for (let pageIndex = 0; pageIndex < sample.pages.length; pageIndex += 1) {
      const page = sample.pages[pageIndex]
      updateFramedHash(hash, frame(String(pageIndex + 1)))
      updateFramedHash(hash, frame(page.mimeType))
      updateFramedHash(hash, page.buffer)
    }
  }
  return hash.digest('hex')
}

function bindProvenance(
  variant: 'baseline' | 'candidate',
  samples: readonly BenchmarkRunnerSample[],
  source: BenchmarkProvenance = provenance,
): BenchmarkProvenance {
  const manifest = {
    manifestVersion: 'grading-benchmark-manifest-v1' as const,
    samples: samples.map(({ reference }) => reference),
  }
  const manifestSha256 = computeManifestSha256(manifest)
  const variantFields = source === provenance
    ? variant === 'baseline'
      ? {
          providerSchemaVersion: LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION,
          featureProfiles: {
            image: 'original-v1' as const,
            output: 'legacy-v1' as const,
            prompt: 'legacy' as const,
          },
        }
      : {
          providerSchemaVersion: ESSAY_PROVIDER_SCHEMA_VERSION,
          featureProfiles: {
            image: 'original-v1' as const,
            output: 'deduplicated-v1' as const,
            prompt: 'optimized-v1' as const,
          },
        }
    : {}
  return {
    ...source,
    ...variantFields,
    manifestSha256,
    datasetSha256: computeTestDatasetSha256(manifestSha256, samples),
  }
}

function bindRunnerInput(input: BenchmarkRunnerInput): BenchmarkRunnerInput {
  return {
    ...input,
    provenance: bindProvenance(input.variant, input.samples, input.provenance),
  }
}

function runGradingBenchmark(
  input: BenchmarkRunnerInput,
  dependencies: BenchmarkRunnerDependencies,
) {
  return runGradingBenchmarkImpl(bindRunnerInput(input), dependencies)
}

function referenceSample(
  id: string,
  options: {
    transcript?: string
    teacherScore?: number
    pageCount?: number
    importantIssueLabels?: string[]
    importantLegibilityLabels?: string[]
    path?: string
  } = {},
): GradingBenchmarkSample {
  const pageCount = options.pageCount ?? 1
  return {
    id,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageOrder: index + 1,
      path: options.path ?? `pages/page-${index + 1}.png`,
      mimeType: 'image/png' as const,
      sourceKind: 'image' as const,
    })),
    teacherTranscript: options.transcript ?? 'I has a pen.\nIt are blue.',
    fullScore: 15,
    teacherScore: options.teacherScore ?? 12,
    importantIssueLabels: options.importantIssueLabels ?? ['grammar_agreement'],
    importantLegibilityLabels: options.importantLegibilityLabels ?? [],
    strata: {
      page: pageCount === 1 ? 'single_page' : 'multi_page_or_pdf',
      legibility: 'clear',
      scoreBand: 'middle',
    },
  }
}

function loadedSample(
  id: string,
  options: Parameters<typeof referenceSample>[1] = {},
): BenchmarkRunnerSample {
  const reference = referenceSample(id, options)
  return {
    reference,
    pages: reference.pages.map((page, index) => ({
      pageId: `private-original-page-id-${index + 1}`,
      mimeType: page.mimeType,
      buffer: Buffer.from(`${PRIVATE_IMAGE}-${index + 1}`),
    })),
  }
}

function knownAttempt(
  attemptDiagnosticId = '11111111-1111-4111-8111-111111111111',
): ProviderAttemptObservation {
  return {
    attemptDiagnosticId,
    finishReason: 'stop',
    usage: {
      promptTokens: { status: 'known', value: 10 },
      completionTokens: { status: 'known', value: 5 },
      totalTokens: { status: 'known', value: 15 },
      cachedTokens: { status: 'known', value: 2 },
    },
    providerElapsedMs: 20,
  }
}

function unknownAttempt(): ProviderAttemptObservation {
  return {
    attemptDiagnosticId: '22222222-2222-4222-8222-222222222222',
    finishReason: 'unknown',
    usage: {
      promptTokens: { status: 'unknown', reason: 'absent' },
      completionTokens: { status: 'unknown', reason: 'absent' },
      totalTokens: { status: 'unknown', reason: 'absent' },
      cachedTokens: { status: 'unknown', reason: 'absent' },
    },
    providerElapsedMs: 20,
  }
}

function validRawPayload(
  transcript = 'I has a pen.\nIt are blue.',
): Record<string, unknown> {
  return {
    transcript,
    recognitionWarnings: [],
    printedTextExcluded: true,
    reportedTotalScore: 12,
    dimensionScores: [
      {
        dimensionId: 'content',
        score: 4.8,
        reason: 'Relevant.',
        evidence: 'I has a pen.',
        relatedIssueKeys: ['grammar-blue'],
      },
      {
        dimensionId: 'language',
        score: 6.45,
        reason: 'Grammar needs review.',
        evidence: 'It are blue.',
        relatedIssueKeys: ['grammar-blue'],
      },
      {
        dimensionId: 'legibility',
        score: 0.75,
        reason: 'Handwriting is legible.',
        evidence: 'I has a pen.',
        relatedIssueKeys: [],
      },
    ],
    issues: [
      {
        issueKey: 'grammar-blue',
        type: 'grammar',
        severity: 'medium',
        originalText: 'It are blue.',
        suggestion: 'It is blue.',
        explanation: 'Agreement.',
        evidenceCertainty: 'certain',
        requiresTeacherReview: false,
      },
    ],
    sentenceRevisions: [],
    expressionUpgrades: [],
    fullTextRevision: {
      sentencePairs: [],
      logicNotes: [
        {
          quote: 'I has a pen.',
          note: 'The opening subject-verb agreement weakens clarity.',
        },
      ],
      logicIssues: [],
    },
    legibilityIssues: [],
    overallComment: 'A clear synthetic response.',
  }
}

function providerFrom(
  gradeEssay: (input: GradeEssayProviderInput) => Promise<ProviderCallResult<unknown>>,
): MultimodalProvider {
  return {
    generateMaterialContext: async () => {
      throw new Error('unexpected material call')
    },
    generateRubric: async () => {
      throw new Error('unexpected rubric call')
    },
    gradeEssay,
  }
}

function monotonicClock(): () => number {
  let now = 1_000
  return () => {
    now += 5
    return now
  }
}

describe('grading benchmark runner', () => {
  it('sends ordered anonymous image pages through Provider and the real v2 normalizer', async () => {
    const sample = loadedSample('sample-001', {
      pageCount: 2,
      importantLegibilityLabels: ['ambiguous_handwriting'],
    })
    const calls: GradeEssayProviderInput[] = []
    const provider = providerFrom(async (input) => {
      calls.push(input)
      return { value: validRawPayload(), attempts: [knownAttempt()] }
    })

    const report = await runGradingBenchmark(
      { variant: 'candidate', provenance, task, samples: [sample] },
      {
        provider,
        monotonicNow: monotonicClock(),
        assessResult: ({ result }) => {
          expect(result.resultVersion).toBe('grading-result-v2')
          expect(result.transcript).toBe('I has a pen.\nIt are blue.')
          return {
            detectedImportantIssueLabels: ['grammar_agreement'],
            detectedImportantLegibilityLabels: ['ambiguous_handwriting'],
            hardRisks: {
              studentMix: false,
              wrongTaskContext: false,
              piiLeakage: false,
            },
          }
        },
      },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      requestId: 'benchmark-candidate-sample-001',
      essayId: 'sample-001',
      task,
    })
    expect(calls[0].confirmedTranscript).toBeUndefined()
    expect(calls[0].pages.map(({ pageId }) => pageId)).toEqual([
      'sample-001-page-1',
      'sample-001-page-2',
    ])
    expect(calls[0].pages.map(({ buffer }) => buffer)).toEqual([
      sample.pages[0].buffer,
      sample.pages[1].buffer,
    ])
    expect(calls[0].pages[0].buffer).not.toBe(sample.pages[0].buffer)
    expect(calls[0].pages[1].buffer).not.toBe(sample.pages[1].buffer)
    expect(calls[0].pages.map(({ mimeType }) => mimeType)).toEqual([
      'image/png',
      'image/png',
    ])
    expect(JSON.stringify(calls[0])).not.toContain(sample.reference.teacherTranscript)
    expect(JSON.stringify(calls[0])).not.toContain(sample.reference.pages[0].path)

    expect(report.sampleCounts).toEqual({
      requested: 1,
      providerSucceeded: 1,
      accepted: 1,
      providerFailures: 0,
      normalizationFailures: 0,
      assessmentFailures: 0,
      assessmentCoverage: 1,
    })
    expect(report.structuredSuccessRate).toEqual({ status: 'measured', value: 1 })
    expect(report.cer.macro).toEqual({ status: 'measured', value: 0 })
    expect(report.cer.micro).toEqual({ status: 'measured', value: 0 })
    expect(report.normalizedScoreError.mean).toEqual({ status: 'measured', value: 0 })
    expect(report.normalizedScoreError.median).toEqual({ status: 'measured', value: 0 })
    expect(report.importantIssueRecall).toMatchObject({
      status: 'measured',
      value: 1,
      matched: 1,
      total: 1,
    })
    expect(report.importantLegibilityRecall).toMatchObject({
      status: 'measured',
      value: 1,
      matched: 1,
      total: 1,
    })
    expect(report.evidenceLocation).toMatchObject({ status: 'measured', value: 1 })
    expect(report.hardRisks).toEqual({
      studentMix: { status: 'measured', value: 0 },
      wrongTaskContext: { status: 'measured', value: 0 },
      highRiskLegibilityMiss: { status: 'measured', value: 0 },
      piiLeakage: { status: 'measured', value: 0 },
    })
    expect(report.blindReview).toEqual({
      status: 'not_measurable',
      reason: 'human_blind_review_required',
    })
    expect(report.completionMetrics).toMatchObject({
      uniqueAttemptCount: 1,
      duplicateObservationCount: 0,
      tokens: {
        promptTokens: { status: 'measured', value: 10 },
        completionTokens: { status: 'measured', value: 5 },
        totalTokens: { status: 'measured', value: 15 },
        cachedTokens: { status: 'measured', value: 2 },
      },
      phaseTimingsMs: {
        provider: { status: 'measured', value: 20 },
        queue: { status: 'not_measurable' },
        parse: { status: 'not_measurable' },
      },
    })
    expect(report.fieldCounts.issues).toEqual({
      sampleCount: 1,
      min: 1,
      max: 1,
      median: { status: 'measured', value: 1 },
    })
  })

  it.each([
    'sample-alice-smith',
    'sample-001-extra',
    'sample-01',
    'sample-123456',
    'sample-1234567',
  ])('rejects non-opaque sample id %s before Provider calls', async (sampleId) => {
    const provider = providerFrom(vi.fn(async () => ({
      value: validRawPayload(),
      attempts: [knownAttempt()],
    })))
    const gradeSpy = vi.spyOn(provider, 'gradeEssay')

    await expect(runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample(sampleId)],
      },
      { provider, monotonicNow: monotonicClock() },
    )).rejects.toThrow('invalid_benchmark_input')

    expect(gradeSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['task fullScore above the request contract', (testTask: ConfirmedTaskPackageV2, sample: BenchmarkRunnerSample) => {
      testTask.fullScore = 101
      sample.reference.fullScore = 101
      sample.reference.teacherScore = 100
    }],
    ['top-level writing requirements diverge from the confirmed rubric', (testTask: ConfirmedTaskPackageV2) => {
      testTask.writingRequirements = []
    }],
    ['confirmed rubric weights are invalid', (testTask: ConfirmedTaskPackageV2) => {
      testTask.rubric.dimensions[0].weight = 30
    }],
    ['teacher transcript is blank', (_testTask: ConfirmedTaskPackageV2, sample: BenchmarkRunnerSample) => {
      sample.reference.teacherTranscript = '   '
    }],
    ['important labels are duplicated', (_testTask: ConfirmedTaskPackageV2, sample: BenchmarkRunnerSample) => {
      sample.reference.importantIssueLabels = ['grammar_agreement', 'grammar_agreement']
    }],
    ['sample strata is invalid', (_testTask: ConfirmedTaskPackageV2, sample: BenchmarkRunnerSample) => {
      sample.reference.strata.legibility = 'private_student_name' as 'clear'
    }],
    ['reference page source kind is invalid', (_testTask: ConfirmedTaskPackageV2, sample: BenchmarkRunnerSample) => {
      sample.reference.pages[0].sourceKind = 'private_source' as 'image'
    }],
  ] as const)('rejects rehashed but invalid %s before Provider calls', async (_name, mutate) => {
    const testTask = clonedTask()
    const sample = loadedSample('sample-001')
    mutate(testTask, sample)
    const provider = providerFrom(vi.fn(async () => ({
      value: validRawPayload(),
      attempts: [knownAttempt()],
    })))
    const gradeSpy = vi.spyOn(provider, 'gradeEssay')

    await expect(runGradingBenchmark(
      { variant: 'candidate', provenance, task: testTask, samples: [sample] },
      { provider, monotonicNow: monotonicClock() },
    )).rejects.toThrow('invalid_benchmark_input')

    expect(gradeSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['out-of-order sequence', ['sample-002', 'sample-001']],
    ['sequence with a missing ordinal', ['sample-001', 'sample-003']],
  ])('rejects an %s before Provider calls', async (_name, sampleIds) => {
    const provider = providerFrom(vi.fn(async () => ({
      value: validRawPayload(),
      attempts: [knownAttempt()],
    })))
    const gradeSpy = vi.spyOn(provider, 'gradeEssay')

    await expect(runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: sampleIds.map((sampleId) => loadedSample(sampleId)),
      },
      { provider, monotonicNow: monotonicClock() },
    )).rejects.toThrow('invalid_benchmark_input')

    expect(gradeSpy).not.toHaveBeenCalled()
  })

  it('derives all outward sample identities from array position after validation', async () => {
    const sample = loadedSample('sample-001')
    const calls: GradeEssayProviderInput[] = []
    const assessedSampleIds: string[] = []
    let now = 1_000
    let mutated = false

    await runGradingBenchmark(
      { variant: 'candidate', provenance, task, samples: [sample] },
      {
        provider: providerFrom(async (input) => {
          calls.push(input)
          return { value: validRawPayload(), attempts: [knownAttempt()] }
        }),
        monotonicNow: () => {
          if (!mutated) {
            sample.reference.id = 'sample-123456'
            mutated = true
          }
          now += 5
          return now
        },
        assessResult: ({ sampleId }) => {
          assessedSampleIds.push(sampleId)
          return {
            detectedImportantIssueLabels: ['grammar_agreement'],
            detectedImportantLegibilityLabels: [],
            hardRisks: {
              studentMix: false,
              wrongTaskContext: false,
              piiLeakage: false,
            },
          }
        },
      },
    )

    expect(calls[0]).toMatchObject({
      requestId: 'benchmark-candidate-sample-001',
      essayId: 'sample-001',
    })
    expect(calls[0].pages.map(({ pageId }) => pageId)).toEqual(['sample-001-page-1'])
    expect(assessedSampleIds).toEqual(['sample-001'])
  })

  it.each([
    ['candidate', 'baseline'],
    ['baseline', 'candidate'],
  ] as const)(
    'rejects %s execution with %s provenance before Provider calls',
    async (runVariant, provenanceVariant) => {
      const samples = [loadedSample('sample-001')]
      const provider = providerFrom(vi.fn(async () => ({
        value: validRawPayload(),
        attempts: [knownAttempt()],
      })))
      const gradeSpy = vi.spyOn(provider, 'gradeEssay')

      await expect(runGradingBenchmarkImpl(
        {
          variant: runVariant,
          provenance: bindProvenance(provenanceVariant, samples),
          task,
          samples,
        },
        { provider, monotonicNow: monotonicClock() },
      )).rejects.toThrow('invalid_benchmark_provenance')

      expect(gradeSpy).not.toHaveBeenCalled()
    },
  )

  it('rejects dataset or manifest provenance that does not bind the exact snapshot', async () => {
    const samples = [loadedSample('sample-001')]
    const validProvenance = bindProvenance('candidate', samples)
    const wrongManifestSha256 = 'f'.repeat(64)
    const provider = providerFrom(vi.fn(async () => ({
      value: validRawPayload(),
      attempts: [knownAttempt()],
    })))
    const gradeSpy = vi.spyOn(provider, 'gradeEssay')
    const invalidProvenance = [
      { ...validProvenance, datasetSha256: 'e'.repeat(64) },
      {
        ...validProvenance,
        manifestSha256: wrongManifestSha256,
        datasetSha256: computeTestDatasetSha256(wrongManifestSha256, samples),
      },
    ]

    for (const candidate of invalidProvenance) {
      await expect(runGradingBenchmarkImpl(
        { variant: 'candidate', provenance: candidate, task, samples },
        { provider, monotonicNow: monotonicClock() },
      )).rejects.toThrow('invalid_benchmark_provenance')
    }

    expect(gradeSpy).not.toHaveBeenCalled()
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    16,
  ])('rejects invalid teacherScore %s before Provider calls', async (teacherScore) => {
    const samples = [loadedSample('sample-001', { teacherScore })]
    const provider = providerFrom(vi.fn(async () => ({
      value: validRawPayload(),
      attempts: [knownAttempt()],
    })))
    const gradeSpy = vi.spyOn(provider, 'gradeEssay')

    await expect(runGradingBenchmark(
      { variant: 'candidate', provenance, task, samples },
      { provider, monotonicNow: monotonicClock() },
    )).rejects.toThrow('invalid_benchmark_input')

    expect(gradeSpy).not.toHaveBeenCalled()
  })

  it('uses an entry snapshot when the caller mutates references, labels, and page bytes', async () => {
    const sample = loadedSample('sample-001')
    const initialBytes = Buffer.from(sample.pages[0].buffer)
    let providerInputBuffer: Buffer | undefined

    const report = await runGradingBenchmark(
      { variant: 'candidate', provenance, task, samples: [sample] },
      {
        provider: providerFrom(async (input) => {
          providerInputBuffer = input.pages[0].buffer
          expect(Object.isFrozen(input)).toBe(true)
          expect(Object.isFrozen(input.pages)).toBe(true)
          expect(Object.isFrozen(input.pages[0])).toBe(true)
          expect(input.pages[0].buffer).not.toBe(sample.pages[0].buffer)
          expect(input.pages[0].buffer).toEqual(initialBytes)
          expect(input.task).not.toBe(task)
          expect(Object.isFrozen(input.task)).toBe(true)
          expect(Object.isFrozen(input.task.rubric.dimensions)).toBe(true)

          sample.reference.teacherTranscript = 'FORGED_AFTER_ENTRY'
          sample.reference.teacherScore = 0
          sample.reference.importantIssueLabels[0] = 'forged_label'
          sample.reference.pages[0].mimeType = 'image/jpeg'
          sample.pages[0].buffer.fill(0)
          return { value: validRawPayload(), attempts: [knownAttempt()] }
        }),
        assessResult: ({ expectedImportantIssueLabels }) => ({
          detectedImportantIssueLabels: [...expectedImportantIssueLabels],
          detectedImportantLegibilityLabels: [],
          hardRisks: {
            studentMix: false,
            wrongTaskContext: false,
            piiLeakage: false,
          },
        }),
        monotonicNow: monotonicClock(),
      },
    )

    expect(providerInputBuffer).toEqual(initialBytes)
    expect(report.cer.macro).toEqual({ status: 'measured', value: 0 })
    expect(report.normalizedScoreError.mean).toEqual({ status: 'measured', value: 0 })
    expect(report.importantIssueRecall).toMatchObject({
      status: 'measured',
      value: 1,
      matched: 1,
      total: 1,
    })
  })

  it('passes frozen assessor copies and rejects Provider mutation of supplied page bytes', async () => {
    const sample = loadedSample('sample-001')
    const immutableReport = await runGradingBenchmark(
      { variant: 'candidate', provenance, task, samples: [sample] },
      {
        provider: providerFrom(async () => ({
          value: validRawPayload(),
          attempts: [knownAttempt()],
        })),
        assessResult: (input) => {
          expect(Object.isFrozen(input)).toBe(true)
          expect(Object.isFrozen(input.expectedImportantIssueLabels)).toBe(true)
          expect(Object.isFrozen(input.expectedImportantLegibilityLabels)).toBe(true)
          expect(Object.isFrozen(input.result)).toBe(true)
          expect(Object.isFrozen(input.result.fullTextRevision.sentencePairs)).toBe(true)
          expect(Reflect.set(input.expectedImportantIssueLabels, '0', 'forged_label')).toBe(false)
          expect(Reflect.set(input.result, 'transcript', 'FORGED_RESULT')).toBe(false)
          return {
            detectedImportantIssueLabels: ['grammar_agreement'],
            detectedImportantLegibilityLabels: [],
            hardRisks: {
              studentMix: false,
              wrongTaskContext: false,
              piiLeakage: false,
            },
          }
        },
        monotonicNow: monotonicClock(),
      },
    )
    expect(immutableReport.importantIssueRecall).toMatchObject({ status: 'measured', value: 1 })

    const mutatingProvider = providerFrom(async (input) => {
      input.pages[0].buffer.fill(0)
      return { value: validRawPayload(), attempts: [knownAttempt()] }
    })
    await expect(runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      { provider: mutatingProvider, monotonicNow: monotonicClock() },
    )).rejects.toThrow('invalid_benchmark_input')
  })

  it('isolates Provider and normalization failures without retaining private details', async () => {
    const samples = [
      loadedSample('sample-001'),
      loadedSample('sample-002'),
      loadedSample('sample-003'),
    ]
    const gradeEssay = vi.fn(async ({ essayId }: GradeEssayProviderInput) => {
      if (essayId === 'sample-001') {
        return {
          value: { transcript: PRIVATE_UPSTREAM, malformed: PRIVATE_TRANSCRIPT },
          attempts: [knownAttempt('33333333-3333-4333-8333-333333333333')],
        }
      }
      if (essayId === 'sample-003') {
        throw new Error(`${PRIVATE_UPSTREAM}: ${PRIVATE_PATH}`)
      }
      return {
        value: { ...validRawPayload(), privateAuxiliary: PRIVATE_UPSTREAM },
        attempts: [knownAttempt('44444444-4444-4444-8444-444444444444')],
      }
    })

    const report = await runGradingBenchmark(
      { variant: 'baseline', provenance, task, samples },
      { provider: providerFrom(gradeEssay), monotonicNow: monotonicClock() },
    )

    expect(gradeEssay).toHaveBeenCalledTimes(3)
    expect(report.sampleCounts).toEqual({
      requested: 3,
      providerSucceeded: 2,
      accepted: 1,
      providerFailures: 1,
      normalizationFailures: 1,
      assessmentFailures: 0,
      assessmentCoverage: 0,
    })
    expect(report.structuredSuccessRate).toEqual({
      status: 'measured',
      value: 1 / 3,
    })
    expect(report.failureCounts).toEqual({
      provider_failure: 1,
      normalization_rejected: 1,
      assessment_failure: 0,
    })
    expect(report.cer).toMatchObject({
      measurableSampleCount: 1,
      excludedSampleCount: 2,
      macro: { status: 'measured', value: 0 },
      micro: { status: 'measured', value: 0 },
    })
    expect(report.importantIssueRecall).toEqual({
      status: 'not_measurable',
      reason: 'incomplete_sample_assessment',
    })
    expect(report.hardRisks.studentMix).toEqual({
      status: 'not_measurable',
      reason: 'incomplete_sample_assessment',
    })
    expect(report.completionMetrics.unobservedProviderCallCount).toBe(1)
    expect(report.completionMetrics.tokens.totalTokens).toEqual({
      status: 'not_measurable',
      reason: 'incomplete_provider_attempt_telemetry',
    })

    const serialized = JSON.stringify(report)
    for (const privateMarker of [
      PRIVATE_TRANSCRIPT,
      PRIVATE_PATH,
      PRIVATE_IMAGE,
      PRIVATE_TASK,
      PRIVATE_UPSTREAM,
      samples[0].reference.id,
      samples[1].reference.id,
      samples[2].reference.id,
    ]) {
      expect(serialized).not.toContain(privateMarker)
    }
    expect(serialized).not.toContain('teacherTranscript')
    expect(serialized).not.toContain('stack')
    expect(serialized).not.toContain('raw')
  })

  it('keeps unknown usage and unavailable queue/parse timing not measurable instead of zero', async () => {
    const report = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      {
        provider: providerFrom(async () => ({
          value: validRawPayload(),
          attempts: [unknownAttempt()],
        })),
        monotonicNow: monotonicClock(),
      },
    )

    expect(report.completionMetrics.tokens).toEqual({
      promptTokens: { status: 'not_measurable', reason: 'unknown_or_partial_usage' },
      completionTokens: { status: 'not_measurable', reason: 'unknown_or_partial_usage' },
      totalTokens: { status: 'not_measurable', reason: 'unknown_or_partial_usage' },
      cachedTokens: { status: 'not_measurable', reason: 'unknown_or_partial_usage' },
    })
    expect(report.completionMetrics.phaseTimingsMs.provider).toEqual({
      status: 'measured',
      value: 20,
    })
    expect(report.completionMetrics.phaseTimingsMs.queue).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_phase_timing',
    })
    expect(report.completionMetrics.phaseTimingsMs.parse).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_phase_timing',
    })
  })

  it('rejects unsafe or internally inconsistent completion telemetry reports', async () => {
    const report = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      {
        provider: providerFrom(async () => ({
          value: validRawPayload(),
          attempts: [knownAttempt()],
        })),
        monotonicNow: monotonicClock(),
      },
    )

    const nonSafeToken = structuredClone(report)
    nonSafeToken.completionMetrics.tokens.promptTokens = { status: 'measured', value: 1e300 }

    const inconsistentTotal = structuredClone(report)
    inconsistentTotal.completionMetrics.tokens.totalTokens = { status: 'measured', value: 16 }

    const cachedBeyondPrompt = structuredClone(report)
    cachedBeyondPrompt.completionMetrics.tokens.cachedTokens = { status: 'measured', value: 11 }

    const overflowingFinishTotal = structuredClone(report)
    overflowingFinishTotal.completionMetrics.uniqueAttemptCount = Number.MAX_SAFE_INTEGER
    overflowingFinishTotal.completionMetrics.unobservedProviderCallCount = 1
    overflowingFinishTotal.completionMetrics.finishReasons.counts.stop = Number.MAX_SAFE_INTEGER
    overflowingFinishTotal.completionMetrics.finishReasons.unknownCount = 1

    expect([
      nonSafeToken,
      inconsistentTotal,
      cachedBeyondPrompt,
      overflowingFinishTotal,
    ].map((unsafeReport) => (
      isBenchmarkAggregateReport(
        unsafeReport,
        'candidate',
        report.provenance as BenchmarkProvenance,
      )
    ))).toEqual([false, false, false, false])
  })

  it('recomputes structured success and deterministic quality aggregates', async () => {
    const report = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      {
        provider: providerFrom(async () => ({
          value: validRawPayload(),
          attempts: [knownAttempt()],
        })),
        monotonicNow: monotonicClock(),
      },
    )
    const expectedProvenance = report.provenance as BenchmarkProvenance

    const wrongStructuredRate = structuredClone(report)
    wrongStructuredRate.sampleCounts.accepted = 0
    wrongStructuredRate.sampleCounts.normalizationFailures = 1
    wrongStructuredRate.failureCounts.normalization_rejected = 1

    const wrongCerTotals = structuredClone(report)
    wrongCerTotals.cer.totalEditDistance += 1

    const wrongCerMicro = structuredClone(report)
    if (wrongCerMicro.cer.micro.status !== 'measured') throw new Error('expected measured CER')
    wrongCerMicro.cer.micro.value = 0.5

    const wrongScoreCoverage = structuredClone(report)
    wrongScoreCoverage.normalizedScoreError.measurableSampleCount = 0

    const scoreOutOfRange = structuredClone(report)
    scoreOutOfRange.normalizedScoreError.mean = { status: 'measured', value: 1.1 }
    scoreOutOfRange.normalizedScoreError.median = { status: 'measured', value: 1.1 }

    const oneSampleCerMismatch = structuredClone(report)
    if (oneSampleCerMismatch.cer.macro.status !== 'measured') {
      throw new Error('expected measured macro CER')
    }
    oneSampleCerMismatch.cer.macro.value = 0.5

    const oneSampleScoreMismatch = structuredClone(report)
    oneSampleScoreMismatch.normalizedScoreError.mean = { status: 'measured', value: 0.1 }
    oneSampleScoreMismatch.normalizedScoreError.median = { status: 'measured', value: 0.2 }

    expect([
      wrongStructuredRate,
      wrongCerTotals,
      wrongCerMicro,
      wrongScoreCoverage,
      scoreOutOfRange,
      oneSampleCerMismatch,
      oneSampleScoreMismatch,
    ].map((forgedReport) => isBenchmarkAggregateReport(
      forgedReport,
      'candidate',
      expectedProvenance,
    ))).toEqual([false, false, false, false, false, false, false])
  })

  it('requires equal score mean and median when exactly two scores are measurable', async () => {
    const samples = [loadedSample('sample-001'), loadedSample('sample-002')]
    const report = await runGradingBenchmark(
      { variant: 'candidate', provenance, task, samples },
      {
        provider: providerFrom(async ({ essayId }) => ({
          value: validRawPayload(),
          attempts: [knownAttempt(
            essayId === 'sample-001'
              ? '11111111-1111-4111-8111-111111111111'
              : '22222222-2222-4222-8222-222222222222',
          )],
        })),
        monotonicNow: monotonicClock(),
      },
    )
    const forged = structuredClone(report)
    forged.normalizedScoreError.mean = { status: 'measured', value: 0.1 }
    forged.normalizedScoreError.median = { status: 'measured', value: 0.2 }

    expect(isBenchmarkAggregateReport(
      forged,
      'candidate',
      report.provenance as BenchmarkProvenance,
    )).toBe(false)
  })

  it('binds assessment coverage to recall and hard-risk evidence states', async () => {
    const report = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      {
        provider: providerFrom(async () => ({
          value: validRawPayload(),
          attempts: [knownAttempt()],
        })),
        assessResult: () => ({
          detectedImportantIssueLabels: ['grammar_agreement'],
          detectedImportantLegibilityLabels: [],
          hardRisks: {
            studentMix: false,
            wrongTaskContext: false,
            piiLeakage: false,
          },
        }),
        monotonicNow: monotonicClock(),
      },
    )
    const expectedProvenance = report.provenance as BenchmarkProvenance
    const incompleteReason = {
      status: 'not_measurable' as const,
      reason: 'incomplete_sample_assessment',
    }

    const incompleteButMeasured = structuredClone(report)
    incompleteButMeasured.sampleCounts.assessmentCoverage = 0

    const completeButUnknown = structuredClone(report)
    completeButUnknown.importantIssueRecall = incompleteReason
    completeButUnknown.importantLegibilityRecall = incompleteReason
    completeButUnknown.hardRisks = {
      studentMix: incompleteReason,
      wrongTaskContext: incompleteReason,
      highRiskLegibilityMiss: incompleteReason,
      piiLeakage: incompleteReason,
    }

    const fractionalHardRisk = structuredClone(report)
    fractionalHardRisk.hardRisks.studentMix = { status: 'measured', value: 0.5 }

    expect([
      incompleteButMeasured,
      completeButUnknown,
      fractionalHardRisk,
    ].map((forgedReport) => isBenchmarkAggregateReport(
      forgedReport,
      'candidate',
      expectedProvenance,
    ))).toEqual([false, false, false])
  })

  it('binds completion telemetry to samples, attempt budgets, and unknown observations', async () => {
    const observedReport = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      {
        provider: providerFrom(async () => ({
          value: validRawPayload(),
          attempts: [knownAttempt()],
        })),
        monotonicNow: monotonicClock(),
      },
    )
    const observedProvenance = observedReport.provenance as BenchmarkProvenance

    const overBudget = structuredClone(observedReport)
    overBudget.completionMetrics.tokens.completionTokens = {
      status: 'measured',
      value: 16_385,
    }
    overBudget.completionMetrics.tokens.totalTokens = {
      status: 'measured',
      value: 16_395,
    }

    const missingSampleAttempt = structuredClone(observedReport)
    missingSampleAttempt.sampleCounts.requested = 2
    missingSampleAttempt.sampleCounts.providerFailures = 1
    missingSampleAttempt.failureCounts.provider_failure = 1
    missingSampleAttempt.structuredSuccessRate = { status: 'measured', value: 0.5 }

    const tooManyAttempts = structuredClone(observedReport)
    tooManyAttempts.completionMetrics.uniqueAttemptCount = 3
    tooManyAttempts.completionMetrics.finishReasons.counts.stop = 3

    const partialPromptBeyondTotal = structuredClone(observedReport)
    partialPromptBeyondTotal.completionMetrics.tokens.promptTokens = {
      status: 'measured',
      value: 16,
    }
    partialPromptBeyondTotal.completionMetrics.tokens.completionTokens = {
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    }
    partialPromptBeyondTotal.completionMetrics.tokens.totalTokens = {
      status: 'measured',
      value: 15,
    }

    const partialCompletionBeyondTotal = structuredClone(observedReport)
    partialCompletionBeyondTotal.completionMetrics.tokens.promptTokens = {
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    }
    partialCompletionBeyondTotal.completionMetrics.tokens.completionTokens = {
      status: 'measured',
      value: 16,
    }
    partialCompletionBeyondTotal.completionMetrics.tokens.totalTokens = {
      status: 'measured',
      value: 15,
    }

    const impossibleTokenReason = structuredClone(observedReport)
    impossibleTokenReason.completionMetrics.tokens.cachedTokens = {
      status: 'not_measurable',
      reason: 'no_provider_attempts',
    }

    const impossiblePhaseReason = structuredClone(observedReport)
    impossiblePhaseReason.completionMetrics.phaseTimingsMs.queue = {
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    }

    expect([
      overBudget,
      missingSampleAttempt,
      tooManyAttempts,
      partialPromptBeyondTotal,
      partialCompletionBeyondTotal,
      impossibleTokenReason,
      impossiblePhaseReason,
    ].map((forgedReport) => isBenchmarkAggregateReport(
      forgedReport,
      'candidate',
      observedProvenance,
    ))).toEqual([false, false, false, false, false, false, false])

    const unobservedReport = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      {
        provider: providerFrom(async () => ({ value: validRawPayload(), attempts: [] })),
        monotonicNow: monotonicClock(),
      },
    )
    const unobservedProvenance = unobservedReport.provenance as BenchmarkProvenance
    const measuredDespiteUnobserved = structuredClone(unobservedReport)
    measuredDespiteUnobserved.completionMetrics.tokens.promptTokens = {
      status: 'measured',
      value: 0,
    }
    const mislabeledUnknown = structuredClone(unobservedReport)
    mislabeledUnknown.completionMetrics.finishReasons.unknownCount = 0
    mislabeledUnknown.completionMetrics.finishReasons.counts.stop = 1

    expect([
      measuredDespiteUnobserved,
      mislabeledUnknown,
    ].map((forgedReport) => isBenchmarkAggregateReport(
      forgedReport,
      'candidate',
      unobservedProvenance,
    ))).toEqual([false, false])
  })

  it('rejects more than two unique attempts per sample and attempt IDs reused across samples', async () => {
    const threeAttemptProvider = providerFrom(async () => ({
      value: validRawPayload(),
      attempts: [
        knownAttempt('11111111-1111-4111-8111-111111111111'),
        knownAttempt('22222222-2222-4222-8222-222222222222'),
        knownAttempt('33333333-3333-4333-8333-333333333333'),
      ],
    }))
    await expect(runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      { provider: threeAttemptProvider, monotonicNow: monotonicClock() },
    )).rejects.toThrow('invalid_benchmark_input')

    const duplicateAcrossSamples = providerFrom(async () => ({
      value: validRawPayload(),
      attempts: [knownAttempt('44444444-4444-4444-8444-444444444444')],
    }))
    await expect(runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001'), loadedSample('sample-002')],
      },
      { provider: duplicateAcrossSamples, monotonicNow: monotonicClock() },
    )).rejects.toThrow('invalid_benchmark_input')
  })

  it('keeps teacher assessment and hard-risk evidence unknown when no assessor is supplied', async () => {
    const report = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001', {
          importantLegibilityLabels: ['ambiguous_handwriting'],
        })],
      },
      {
        provider: providerFrom(async () => ({
          value: validRawPayload(),
          attempts: [],
        })),
        monotonicNow: monotonicClock(),
      },
    )

    expect(report.sampleCounts.accepted).toBe(1)
    expect(report.sampleCounts.assessmentCoverage).toBe(0)
    expect(report.importantIssueRecall).toEqual({
      status: 'not_measurable',
      reason: 'incomplete_sample_assessment',
    })
    expect(report.importantLegibilityRecall).toEqual({
      status: 'not_measurable',
      reason: 'incomplete_sample_assessment',
    })
    expect(report.hardRisks).toEqual({
      studentMix: {
        status: 'not_measurable',
        reason: 'incomplete_sample_assessment',
      },
      wrongTaskContext: {
        status: 'not_measurable',
        reason: 'incomplete_sample_assessment',
      },
      highRiskLegibilityMiss: {
        status: 'not_measurable',
        reason: 'incomplete_sample_assessment',
      },
      piiLeakage: {
        status: 'not_measurable',
        reason: 'incomplete_sample_assessment',
      },
    })
    expect(report.blindReview.status).toBe('not_measurable')
  })

  it('freezes validated provenance and rejects unsafe provenance before Provider calls', async () => {
    const mutableProvenance = {
      ...provenance,
      phaseBudgets: { ...provenance.phaseBudgets },
      featureProfiles: { ...provenance.featureProfiles },
    }
    const provider = providerFrom(async () => ({
      value: validRawPayload(),
      attempts: [],
    }))
    const gradeSpy = vi.spyOn(provider, 'gradeEssay')

    const report = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance: mutableProvenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      { provider, monotonicNow: monotonicClock() },
    )

    Object.assign(mutableProvenance.featureProfiles, { prompt: 'changed-after-run' })
    expect(report.provenance.featureProfiles.prompt).toBe('optimized-v1')
    expect(Object.isFrozen(report.provenance)).toBe(true)
    expect(Object.isFrozen(report.provenance.phaseBudgets)).toBe(true)
    expect(Object.isFrozen(report.provenance.featureProfiles)).toBe(true)

    const privateGitValue = `not-a-commit-${PRIVATE_PATH}`
    await expect(runGradingBenchmark(
      {
        variant: 'candidate',
        provenance: { ...provenance, gitCommit: privateGitValue },
        task,
        samples: [loadedSample('sample-001')],
      },
      { provider, monotonicNow: monotonicClock() },
    )).rejects.toThrow('invalid_benchmark_provenance')
    expect(gradeSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects non-enumerated provenance keys and values before Provider calls', async () => {
    const provider = providerFrom(async () => ({
      value: validRawPayload(),
      attempts: [],
    }))
    const gradeSpy = vi.spyOn(provider, 'gradeEssay')
    const invalidProvenance: readonly unknown[] = [
      {
        ...provenance,
        phaseBudgets: { ...provenance.phaseBudgets, student_name: 1 },
      },
      {
        ...provenance,
        featureProfiles: { ...provenance.featureProfiles, student_name: 'alice' },
      },
      {
        ...provenance,
        featureProfiles: {
          ...provenance.featureProfiles,
          output: 'synthetic-secret-like-value',
        },
      },
      {
        ...provenance,
        phaseBudgets: { ...provenance.phaseBudgets, essay_grading_images: 16_385 },
      },
      { ...provenance, benchmarkVersion: 'grading-benchmark-v2' },
      { ...provenance, model: 'student-name-alice' },
      { ...provenance, policyVersion: 'grading-policy-v2' },
      { ...provenance, providerSchemaVersion: 'provider-result-v2' },
    ]

    for (const candidate of invalidProvenance) {
      await expect(runGradingBenchmark(
        {
          variant: 'candidate',
          provenance: candidate as BenchmarkProvenance,
          task,
          samples: [loadedSample('sample-001')],
        },
        { provider, monotonicNow: monotonicClock() },
      )).rejects.toThrow('invalid_benchmark_provenance')
    }

    expect(gradeSpy).not.toHaveBeenCalled()
  })

  it('isolates an assessment failure while retaining the accepted v2 quality result', async () => {
    const report = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [loadedSample('sample-001')],
      },
      {
        provider: providerFrom(async () => ({
          value: validRawPayload(),
          attempts: [knownAttempt()],
        })),
        assessResult: () => {
          throw new Error(`${PRIVATE_TRANSCRIPT}:${PRIVATE_UPSTREAM}`)
        },
        monotonicNow: monotonicClock(),
      },
    )

    expect(report.sampleCounts).toMatchObject({
      accepted: 1,
      assessmentFailures: 1,
      assessmentCoverage: 0,
    })
    expect(report.failureCounts).toEqual({
      provider_failure: 0,
      normalization_rejected: 0,
      assessment_failure: 1,
    })
    expect(report.cer.macro).toEqual({ status: 'measured', value: 0 })
    expect(JSON.stringify(report)).not.toContain(PRIVATE_TRANSCRIPT)
    expect(JSON.stringify(report)).not.toContain(PRIVATE_UPSTREAM)
  })

  it('emits only anonymous numeric per-sample metrics for later paired comparison', async () => {
    const observeSampleMetrics = vi.fn()
    const provider = providerFrom(async ({ essayId }) => {
      if (essayId === 'sample-003') {
        return {
          value: { malformed: PRIVATE_UPSTREAM },
          attempts: [knownAttempt('55555555-5555-4555-8555-555555555555')],
        }
      }
      return {
        value: validRawPayload(),
        attempts: essayId === 'sample-002'
          ? [unknownAttempt()]
          : [knownAttempt('66666666-6666-4666-8666-666666666666')],
      }
    })

    const report = await runGradingBenchmark(
      {
        variant: 'candidate',
        provenance,
        task,
        samples: [
          loadedSample('sample-001'),
          loadedSample('sample-002'),
          loadedSample('sample-003'),
        ],
      },
      {
        provider,
        monotonicNow: monotonicClock(),
        observeSampleMetrics,
      },
    )

    expect(observeSampleMetrics.mock.calls).toEqual([
      [{
        sampleIndex: 0,
        cer: 0,
        normalizedScoreError: 0,
        totalTokens: 15,
      }],
      [{
        sampleIndex: 1,
        cer: 0,
        normalizedScoreError: 0,
        totalTokens: null,
      }],
      [{
        sampleIndex: 2,
        cer: null,
        normalizedScoreError: null,
        totalTokens: null,
      }],
    ])
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('sample-001')
    expect(serialized).not.toContain('sample-002')
    expect(serialized).not.toContain('sample-003')
    expect(serialized).not.toContain(PRIVATE_UPSTREAM)
  })

  it('rejects overlapping transcript evidence as non-unique without exporting internals', async () => {
    vi.resetModules()
    vi.doMock('../../src/multimodal/normalizeMultimodalResult.js', () => ({
      normalizeMultimodalResult: () => ({
        ok: true as const,
        result: {
          resultVersion: 'grading-result-v2' as const,
          requestId: 'benchmark-candidate-sample-001',
          essayId: 'sample-001',
          provider: 'remote' as const,
          status: 'success' as const,
          totalScore: 12,
          maxScore: 15,
          dimensionScores: [{
            dimensionId: 'content',
            name: 'Content',
            score: 12,
            maxScore: 15,
            weight: 100,
            reason: 'Synthetic.',
            evidence: 'aaa',
          }],
          issues: [],
          sentenceRevisions: [],
          expressionUpgrades: [],
          fullTextRevision: {
            originalText: 'aaaa',
            correctedText: 'aaaa',
            improvedText: 'aaaa',
            sentencePairs: [],
            logicNotes: [],
            logicIssues: [],
          },
          legibilityIssues: [],
          recognitionWarnings: [],
          overallComment: 'Synthetic.',
          reviewReasons: [],
          createdAt: '1970-01-01T00:00:00.000Z',
          transcript: 'aaaa',
          printedTextExcluded: true,
        },
      }),
    }))

    try {
      const isolatedRunner = await import('./runner.js')
      const isolatedSamples = [loadedSample('sample-001', {
        transcript: 'aaaa',
      })]
      const report = await isolatedRunner.runGradingBenchmark(
        bindRunnerInput({
          variant: 'candidate',
          provenance,
          task,
          samples: isolatedSamples,
        }),
        {
          provider: providerFrom(async () => ({
            value: { ignored: true },
            attempts: [knownAttempt()],
          })),
          monotonicNow: monotonicClock(),
        },
      )

      expect(report.evidenceLocation).toEqual({
        status: 'measured',
        value: 0,
        uniquelyLocated: 0,
        total: 1,
      })
    } finally {
      vi.doUnmock('../../src/multimodal/normalizeMultimodalResult.js')
      vi.resetModules()
    }
  })
})
