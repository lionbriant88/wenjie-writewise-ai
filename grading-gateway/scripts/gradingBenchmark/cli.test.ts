import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ESSAY_PROVIDER_SCHEMA_VERSION, LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION } from '../../src/multimodal/modelTaskContext.js'
import {
  benchmarkExecutionProfile,
  evaluatePairedQualityGates,
  evaluateSoakConclusion,
  evaluateThroughputConclusion,
  createDefaultBenchmarkCommand,
  createBenchmarkRuntimeConfig,
  createInvocationBudgetedProvider,
  computeQualityCandidateRunSha256,
  isDirectGradingBenchmarkExecution,
  loadPrivateBenchmarkBundle,
  readQualityBaselineState,
  readHumanReviewEvidence,
  readQualityCandidateState,
  readVerifiedPrivateFile,
  resolveBenchmarkGitCommit,
  resolveBenchmarkPrivatePaths,
  runGatewayThroughputBenchmark,
  runDirectGradingBenchmarkCli,
  runGradingBenchmarkCli,
  writeQualityBaselineState,
  writeQualityCandidateState,
  writeHumanReviewEvidence,
  writeSafeBenchmarkReport,
  type BenchmarkCliDependencies,
  type BenchmarkCliCommandContext,
  type BenchmarkCliOutcome,
  type BenchmarkCliRequest,
  type BenchmarkExecutionRun,
} from './cli.js'
import type { MultimodalProvider } from '../../src/providers/multimodalProviderTypes.js'
import { GRADING_BENCHMARK_MANIFEST_VERSION } from './types.js'

function dependencies(outcome: BenchmarkCliOutcome = {
  status: 'complete',
  gatesPassed: true,
}) {
  const output = vi.fn<(line: string) => void>()
  const provider = { marker: 'synthetic-provider' }
  const createProvider = vi.fn(() => provider)
  const runBenchmark = vi.fn<NonNullable<BenchmarkCliDependencies['runBenchmark']>>(async () => outcome)
  return { output, provider, createProvider, runBenchmark }
}

const approvedEnv = {
  GRADING_BENCHMARK_AUTHORIZATION: 'approved',
  KIMI_API_KEY: 'synthetic-secret',
}

const unauthorizedCases: Array<[NodeJS.ProcessEnv, string]> = [
  [{ KIMI_API_KEY: 'synthetic-secret' }, 'missing authorization'],
  [{ GRADING_BENCHMARK_AUTHORIZATION: 'approved' }, 'missing key'],
  [{ GRADING_BENCHMARK_AUTHORIZATION: 'APPROVED', KIMI_API_KEY: 'synthetic-secret' }, 'non-exact authorization'],
]

const invalidArgumentCases: Array<[string[]]> = [
  [[]],
  [['--variant', 'other']],
  [['--mode', 'soak', '--calls', '99']],
  [['--mode', 'throughput', '--essays', '31']],
  [['--mode', 'unknown']],
  [['--variant', 'baseline', '--variant', 'candidate']],
  [['--mode', 'image-variants', '--calls', '100']],
]

describe('grading benchmark CLI authorization and exit contract', () => {
  it('resolves the only allowed private bundle and result roots from the CLI module location', () => {
    expect(resolveBenchmarkPrivatePaths(
      pathToFileURL(resolve('/workspace/grading-gateway/scripts/gradingBenchmark/cli.ts')).href,
    )).toEqual({
      privateRoot: resolve('/workspace/grading-gateway/local-private-samples'),
      manifestPath: resolve('/workspace/grading-gateway/local-private-samples/manifest.json'),
      taskPath: resolve('/workspace/grading-gateway/local-private-samples/task.json'),
      resultRoot: resolve('/workspace/grading-gateway/local-private-results'),
    })
  })

  it('does not execute when imported by an offline test', () => {
    expect(isDirectGradingBenchmarkExecution(
      '/workspace/scripts/gradingBenchmark/cli.test.ts',
      '/workspace/scripts/gradingBenchmark/cli.ts',
    )).toBe(false)
    expect(isDirectGradingBenchmarkExecution(
      '/workspace/scripts/gradingBenchmark/cli.ts',
      '/workspace/scripts/gradingBenchmark/cli.ts',
    )).toBe(true)
  })

  it.each(unauthorizedCases)(
    'returns not-run with zero Provider construction for %s (%s)',
    async (env) => {
    const deps = dependencies()

    const code = await runGradingBenchmarkCli(['--variant', 'candidate'], {
      ...deps,
      env,
    })

    expect(code).toBe(3)
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(deps.runBenchmark).not.toHaveBeenCalled()
    expect(deps.output).toHaveBeenCalledWith('grading_benchmark:not_run')
    expect(deps.output).toHaveBeenCalledTimes(1)
    },
  )

  it('requires separate exact authorization for image variants before Provider construction', async () => {
    const deps = dependencies()

    const code = await runGradingBenchmarkCli(['--mode', 'image-variants'], {
      ...deps,
      env: approvedEnv,
    })

    expect(code).toBe(3)
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(deps.runBenchmark).not.toHaveBeenCalled()
    expect(deps.output).toHaveBeenCalledWith('grading_benchmark:not_run')
  })

  it.each([
    [['--variant', 'baseline'], { mode: 'quality', variant: 'baseline' }],
    [['--variant', 'candidate'], { mode: 'quality', variant: 'candidate' }],
    [['--mode', 'soak', '--calls', '100'], { mode: 'soak', calls: 100 }],
    [['--mode', 'throughput', '--essays', '30'], { mode: 'throughput', essays: 30 }],
    [['--mode', 'image-variants'], { mode: 'image-variants' }],
  ] satisfies Array<[string[], BenchmarkCliRequest]>)(
    'parses a bounded request %j',
    async (args, request) => {
      const deps = dependencies()
      const env = request.mode === 'image-variants'
        ? { ...approvedEnv, GRADING_IMAGE_EXPERIMENT: 'approved' }
        : approvedEnv

      const code = await runGradingBenchmarkCli(args, { ...deps, env })

      expect(code).toBe(0)
      expect(deps.createProvider).toHaveBeenCalledTimes(1)
      expect(deps.runBenchmark).toHaveBeenCalledWith(request, deps.provider)
      expect(deps.output).toHaveBeenCalledWith('grading_benchmark:complete:passed')
      expect(deps.output).toHaveBeenCalledTimes(1)
    },
  )

  it.each(invalidArgumentCases)(
    'rejects invalid or unbounded arguments before Provider construction: %j',
    async (args) => {
    const deps = dependencies()

    const code = await runGradingBenchmarkCli(args, { ...deps, env: approvedEnv })

    expect(code).toBe(1)
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(deps.runBenchmark).not.toHaveBeenCalled()
    expect(deps.output).toHaveBeenCalledWith('grading_benchmark:fatal')
    },
  )

  it('parses bounded arguments before authorization and does not construct a Provider', async () => {
    const deps = dependencies()

    const code = await runGradingBenchmarkCli(['--mode', 'soak', '--calls', '101'], {
      ...deps,
      env: {},
    })

    expect(code).toBe(1)
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(deps.runBenchmark).not.toHaveBeenCalled()
    expect(deps.output).toHaveBeenCalledTimes(1)
    expect(deps.output).toHaveBeenCalledWith('grading_benchmark:fatal')
  })

  it('accepts authorization only from the direct shell environment while allowing the key in runtime env', async () => {
    const missingDirectAuthorization = dependencies()
    expect(await runGradingBenchmarkCli(['--variant', 'candidate'], {
      ...missingDirectAuthorization,
      authorizationEnv: {},
      runtimeEnv: approvedEnv,
    })).toBe(3)
    expect(missingDirectAuthorization.createProvider).not.toHaveBeenCalled()

    const directAuthorization = dependencies()
    expect(await runGradingBenchmarkCli(['--variant', 'candidate'], {
      ...directAuthorization,
      authorizationEnv: { GRADING_BENCHMARK_AUTHORIZATION: 'approved' },
      runtimeEnv: { KIMI_API_KEY: 'synthetic-secret' },
    })).toBe(0)
    expect(directAuthorization.createProvider).toHaveBeenCalledTimes(1)
  })

  it('loads fixed runtime secrets only after direct-shell authorization and executes the typed command', async () => {
    const output = vi.fn<(line: string) => void>()
    const loadRuntimeEnvironment = vi.fn((runtimeEnv: NodeJS.ProcessEnv, envPath: string) => {
      expect(envPath).toBe(resolveBenchmarkPrivatePaths().resultRoot.replace(
        /local-private-results$/u,
        '.env',
      ))
      runtimeEnv.KIMI_API_KEY = 'synthetic-secret'
    })
    const execute = vi.fn(async () => ({ status: 'inconclusive' as const }))
    const createCommand = vi.fn(() => ({ execute }))

    const code = await runDirectGradingBenchmarkCli(['--variant', 'candidate'], {
      shellEnv: { GRADING_BENCHMARK_AUTHORIZATION: 'approved' },
      output,
      loadRuntimeEnvironment,
      createCommand,
    })

    expect(code).toBe(1)
    expect(loadRuntimeEnvironment).toHaveBeenCalledTimes(1)
    expect(createCommand).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(output).toHaveBeenCalledTimes(1)
    expect(output).toHaveBeenCalledWith('grading_benchmark:inconclusive')

    loadRuntimeEnvironment.mockClear()
    createCommand.mockClear()
    output.mockClear()
    expect(await runDirectGradingBenchmarkCli(['--variant', 'candidate'], {
      shellEnv: {}, output, loadRuntimeEnvironment, createCommand,
    })).toBe(3)
    expect(loadRuntimeEnvironment).not.toHaveBeenCalled()
    expect(createCommand).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith('grading_benchmark:not_run')
  })

  it('maps completed gate failures to exit 2', async () => {
    const deps = dependencies({ status: 'complete', gatesPassed: false })

    const code = await runGradingBenchmarkCli(['--variant', 'candidate'], {
      ...deps,
      env: approvedEnv,
    })

    expect(code).toBe(2)
    expect(deps.output).toHaveBeenCalledWith('grading_benchmark:complete:failed')
  })

  it('maps an inconclusive benchmark to exit 1 without claiming failure or pass', async () => {
    const deps = dependencies({ status: 'inconclusive' })

    const code = await runGradingBenchmarkCli(['--variant', 'baseline'], {
      ...deps,
      env: approvedEnv,
    })

    expect(code).toBe(1)
    expect(deps.output).toHaveBeenCalledTimes(1)
    expect(deps.output).toHaveBeenCalledWith('grading_benchmark:inconclusive')
  })

  it('executes a typed lazy command without constructing the legacy Provider', async () => {
    const deps = dependencies()
    const execute = vi.fn(async () => ({ status: 'inconclusive' as const }))
    const createCommand = vi.fn(() => ({ execute }))

    const code = await runGradingBenchmarkCli(['--variant', 'baseline'], {
      ...deps,
      env: approvedEnv,
      createCommand,
    })

    expect(code).toBe(1)
    expect(createCommand).toHaveBeenCalledWith(expect.objectContaining({
      request: { mode: 'quality', variant: 'baseline' },
      apiKey: 'synthetic-secret',
      profile: benchmarkExecutionProfile({ mode: 'quality', variant: 'baseline' }),
      paths: resolveBenchmarkPrivatePaths(),
    }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(deps.runBenchmark).not.toHaveBeenCalled()
  })

  it('maps fatal outcomes and thrown private errors to one safe fatal line', async () => {
    const fatal = dependencies({ status: 'fatal' })
    expect(await runGradingBenchmarkCli(['--variant', 'candidate'], {
      ...fatal,
      env: approvedEnv,
    })).toBe(1)
    expect(fatal.output).toHaveBeenCalledWith('grading_benchmark:fatal')

    const privateMarker = 'private-student-and-path-marker'
    const thrown = dependencies()
    thrown.runBenchmark.mockRejectedValueOnce(new Error(privateMarker))
    expect(await runGradingBenchmarkCli(['--variant', 'candidate'], {
      ...thrown,
      env: approvedEnv,
    })).toBe(1)
    expect(thrown.output).toHaveBeenCalledWith('grading_benchmark:fatal')
    expect(thrown.output.mock.calls.flat().join(' ')).not.toContain(privateMarker)
  })
})

describe('grading benchmark bounded execution profiles', () => {
  it('resolves provenance from the worktree command result through an injected resolver', () => {
    const runGit = vi.fn((_root: string, args: readonly string[]) => (
      args[0] === 'rev-parse'
        ? { status: 0, stdout: `${'d'.repeat(40)}\n` }
        : { status: 0, stdout: '' }
    ))

    expect(resolveBenchmarkGitCommit('/workspace/grading-gateway', runGit)).toBe(
      'd'.repeat(40),
    )
    expect(runGit).toHaveBeenNthCalledWith(
      1,
      '/workspace/grading-gateway',
      ['rev-parse', 'HEAD'],
    )
    expect(runGit).toHaveBeenNthCalledWith(
      2,
      '/workspace/grading-gateway',
      ['status', '--porcelain', '--untracked-files=all'],
    )
  })

  it('rejects a dirty worktree with a fixed content-free git error', () => {
    const privateMarker = 'private-filename-marker'
    const runGit = vi.fn((_root: string, args: readonly string[]) => (
      args[0] === 'rev-parse'
        ? { status: 0, stdout: `${'d'.repeat(40)}\n` }
        : { status: 0, stdout: `?? ${privateMarker}\n` }
    ))

    let thrown: unknown
    try {
      resolveBenchmarkGitCommit('/workspace/grading-gateway', runGit)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('benchmark_worktree_not_clean')
    expect((thrown as Error).message).not.toContain(privateMarker)
  })

  it('freezes baseline, candidate, soak, throughput and image call budgets', () => {
    expect(benchmarkExecutionProfile({ mode: 'quality', variant: 'baseline' })).toEqual({
      request: 'quality-baseline',
      callBudget: 40,
      runs: [{ variant: 'baseline', essayPromptProfile: 'legacy', executionRegistry: 'direct-legacy', hardLimit: 1, calls: 40 }],
    })
    expect(benchmarkExecutionProfile({ mode: 'quality', variant: 'candidate' })).toEqual({
      request: 'quality-candidate',
      callBudget: 40,
      runs: [{ variant: 'candidate', essayPromptProfile: 'optimized-v1', executionRegistry: 'memory-v1', hardLimit: 'runtime-bounded', calls: 40 }],
    })
    expect(benchmarkExecutionProfile({ mode: 'soak', calls: 100 })).toEqual({
      request: 'soak',
      callBudget: 100,
      runs: [{ variant: 'candidate', essayPromptProfile: 'optimized-v1', executionRegistry: 'memory-v1', hardLimit: 'runtime-bounded', calls: 100 }],
    })
    expect(benchmarkExecutionProfile({ mode: 'throughput', essays: 30 })).toEqual({
      request: 'throughput',
      callBudget: 60,
      runs: [
        { variant: 'baseline', essayPromptProfile: 'legacy', executionRegistry: 'direct-legacy', hardLimit: 1, calls: 30 },
        { variant: 'candidate', essayPromptProfile: 'optimized-v1', executionRegistry: 'memory-v1', hardLimit: 'runtime-bounded', calls: 30 },
      ],
    })
    expect(benchmarkExecutionProfile({ mode: 'image-variants' })).toEqual({
      request: 'image-variants',
      callBudget: 0,
      runs: [],
    })
  })

  it('stops before a Provider invocation that would exceed the hard budget', async () => {
    let delegateCalls = 0
    const provider: MultimodalProvider = {
      generateMaterialContext: async () => { throw new Error('unused') },
      generateRubric: async () => { throw new Error('unused') },
      gradeEssay: async () => {
        delegateCalls += 1
        return { value: {}, attempts: [] }
      },
    }
    const budgeted = createInvocationBudgetedProvider(provider, 2)
    const input = {} as Parameters<MultimodalProvider['gradeEssay']>[0]

    await budgeted.provider.gradeEssay(input)
    await budgeted.provider.gradeEssay(input)
    await expect(budgeted.provider.gradeEssay(input)).rejects.toThrow('provider_invocation_budget_exhausted')

    expect(delegateCalls).toBe(2)
    expect(budgeted.snapshot()).toEqual({ budget: 2, invoked: 2, remaining: 0 })
  })

  it('projects the frozen legacy/serial and optimized/memory profiles onto strict runtime config', () => {
    const env = {
      GRADING_PROVIDER: 'kimi',
      GRADING_RUBRIC_STRATEGY: 'single-pass-v1',
      GRADING_ESSAY_PROMPT_PROFILE: 'optimized-v1',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      GRADING_HTTP_DEADLINE_MS: '360000',
      GRADING_PROVIDER_FINAL_DEADLINE_MS: '390000',
      GRADING_PROVIDER_SETTLEMENT_GRACE_MS: '30000',
      GRADING_MAX_CONCURRENT_PROVIDER_CALLS: '6',
      GRADING_REGISTRY_TERMINAL_TTL_MS: '420000',
      GRADING_REGISTRY_MAX_ENTRIES: '1000',
      GRADING_PROVIDER_MAX_ATTEMPTS: '2',
      GRADING_RATE_LIMIT_MAX_REQUEUES: '5',
      GRADING_RETRY_BASE_MS: '2000',
      GRADING_RETRY_CAP_MS: '60000',
      GRADING_RETRY_AFTER_PAUSE_MS: '900000',
      KIMI_API_BASE: 'https://api.moonshot.cn/v1',
      KIMI_MODEL: 'kimi-k3',
      KIMI_REASONING_EFFORT: 'low',
      KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT: '16384',
      KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION: '16384',
      KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES: '16384',
      KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT: '16384',
      GRADING_PROMPT_CACHE_HMAC_SECRET: 'synthetic-secret-at-least-32-bytes-long',
    }
    const baseline = benchmarkExecutionProfile({ mode: 'quality', variant: 'baseline' }).runs[0]!
    const candidate = benchmarkExecutionProfile({ mode: 'quality', variant: 'candidate' }).runs[0]!

    expect(createBenchmarkRuntimeConfig(env, baseline)).toEqual(expect.objectContaining({
      provider: 'kimi',
      rubricStrategy: 'two-pass-legacy',
      essayPromptProfile: 'legacy',
      executionRegistry: 'direct-legacy',
      admission: { hardLimit: 1 },
    }))
    expect(createBenchmarkRuntimeConfig(env, candidate)).toEqual(expect.objectContaining({
      provider: 'kimi',
      rubricStrategy: 'single-pass-v1',
      essayPromptProfile: 'optimized-v1',
      executionRegistry: 'memory-v1',
      admission: { hardLimit: 6 },
    }))
  })
})

function syntheticTask(extra: Record<string, unknown> = {}) {
  const rubric = {
    taskName: 'Anonymous benchmark task',
    materialSummary: 'Write an anonymous synthetic response.',
    writingRequirements: ['Write an anonymous synthetic response.'],
    constraints: [],
    dimensions: [
      { id: 'content', name: 'Content', weight: 95, description: 'Complete the task.', deductionFocus: [], sourceEvidence: [] },
      { id: 'legibility', name: 'Legibility', weight: 5, description: 'Remain readable.', deductionFocus: [], sourceEvidence: [] },
    ],
    reviewWarnings: [],
  }
  return {
    taskId: 'benchmark-task-v1',
    fullScore: 15,
    materialSummary: rubric.materialSummary,
    writingRequirements: rubric.writingRequirements,
    constraints: rubric.constraints,
    rubric,
    ...extra,
  }
}

function syntheticManifest(pagePath = 'page.png', mimeType = 'image/png') {
  return {
    manifestVersion: GRADING_BENCHMARK_MANIFEST_VERSION,
    samples: Array.from({ length: 40 }, (_, index) => ({
      id: `sample-${String(index + 1).padStart(3, '0')}`,
      pages: [{
        pageOrder: 1,
        path: pagePath,
        mimeType,
        sourceKind: index < 8 ? 'pdf_page' : 'image',
      }],
      teacherTranscript: `Synthetic reference ${index + 1}.`,
      fullScore: 15,
      teacherScore: (index % 15) + 1,
      importantIssueLabels: index < 10 ? ['important-issue'] : [],
      importantLegibilityLabels: index < 10 ? ['important-legibility'] : [],
      strata: {
        page: index < 8 ? 'multi_page_or_pdf' : 'single_page',
        legibility: index < 8 ? 'difficult' : 'clear',
        scoreBand: ['low', 'middle', 'high'][index % 3],
      },
    })),
  }
}

function syntheticRuntimeEnv(): NodeJS.ProcessEnv {
  return {
    GRADING_PROVIDER: 'kimi',
    GRADING_RUBRIC_STRATEGY: 'single-pass-v1',
    GRADING_ESSAY_PROMPT_PROFILE: 'optimized-v1',
    GRADING_EXECUTION_REGISTRY: 'memory-v1',
    GRADING_HTTP_DEADLINE_MS: '360000',
    GRADING_PROVIDER_FINAL_DEADLINE_MS: '390000',
    GRADING_PROVIDER_SETTLEMENT_GRACE_MS: '30000',
    GRADING_MAX_CONCURRENT_PROVIDER_CALLS: '6',
    GRADING_REGISTRY_TERMINAL_TTL_MS: '420001',
    GRADING_REGISTRY_MAX_ENTRIES: '1000',
    GRADING_PROVIDER_MAX_ATTEMPTS: '2',
    GRADING_RATE_LIMIT_MAX_REQUEUES: '5',
    GRADING_RETRY_BASE_MS: '2000',
    GRADING_RETRY_CAP_MS: '60000',
    GRADING_RETRY_AFTER_PAUSE_MS: '900000',
    KIMI_API_BASE: 'https://api.moonshot.cn/v1',
    KIMI_MODEL: 'kimi-k3',
    KIMI_REASONING_EFFORT: 'low',
    KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT: '16384',
    KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION: '16384',
    KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES: '16384',
    KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT: '16384',
    GRADING_PROMPT_CACHE_HMAC_SECRET: 'synthetic-secret-at-least-32-bytes-long',
  }
}

function syntheticProvenance(variant: 'baseline' | 'candidate' = 'baseline') {
  return {
    benchmarkVersion: 'grading-benchmark-v1' as const,
    gitCommit: 'c'.repeat(40),
    model: 'kimi-k3' as const,
    reasoningEffort: 'low' as const,
    policyVersion: 'grading-policy-v1' as const,
    providerSchemaVersion: variant === 'baseline'
      ? LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION
      : ESSAY_PROVIDER_SCHEMA_VERSION,
    phaseBudgets: {
      material_context: 16384,
      rubric_generation: 16384,
      essay_grading_images: 16384,
      essay_regrading_text: 16384,
    },
    featureProfiles: {
      image: 'original-v1' as const,
      output: variant === 'baseline' ? 'legacy-v1' as const : 'deduplicated-v1' as const,
      prompt: variant === 'baseline' ? 'legacy' as const : 'optimized-v1' as const,
    },
    manifestSha256: 'a'.repeat(64),
    datasetSha256: 'd'.repeat(64),
  }
}

function syntheticAggregate(variant: 'baseline' | 'candidate' = 'baseline') {
  const measuredZero = () => ({ status: 'measured' as const, value: 0 })
  const tokenTotals = variant === 'baseline'
    ? { promptTokens: 6000, completionTokens: 2000, totalTokens: 8000 }
    : { promptTokens: 2000, completionTokens: 2000, totalTokens: 4000 }
  const distribution = () => ({
    sampleCount: 40,
    min: 0,
    max: 0,
    median: measuredZero(),
  })
  return {
    reportVersion: 'grading-benchmark-report-v1' as const,
    variant,
    provenance: syntheticProvenance(variant),
    sampleCounts: {
      requested: 40,
      providerSucceeded: 40,
      accepted: 40,
      providerFailures: 0,
      normalizationFailures: 0,
      assessmentFailures: 0,
      assessmentCoverage: 0,
    },
    failureCounts: {
      provider_failure: 0,
      normalization_rejected: 0,
      assessment_failure: 0,
    },
    structuredSuccessRate: { status: 'measured' as const, value: 1 },
    cer: {
      macro: measuredZero(),
      micro: measuredZero(),
      measurableSampleCount: 40,
      excludedSampleCount: 0,
      totalEditDistance: 0,
      totalReferenceCodePoints: 40,
    },
    normalizedScoreError: {
      mean: measuredZero(),
      median: measuredZero(),
      measurableSampleCount: 40,
    },
    importantIssueRecall: {
      status: 'not_measurable' as const,
      reason: 'incomplete_sample_assessment',
    },
    importantLegibilityRecall: {
      status: 'not_measurable' as const,
      reason: 'incomplete_sample_assessment',
    },
    evidenceLocation: {
      status: 'measured' as const,
      value: 1,
      uniquelyLocated: 40,
      total: 40,
    },
    hardRisks: {
      studentMix: { status: 'not_measurable' as const, reason: 'incomplete_sample_assessment' },
      wrongTaskContext: { status: 'not_measurable' as const, reason: 'incomplete_sample_assessment' },
      highRiskLegibilityMiss: { status: 'not_measurable' as const, reason: 'incomplete_sample_assessment' },
      piiLeakage: { status: 'not_measurable' as const, reason: 'incomplete_sample_assessment' },
    },
    blindReview: {
      status: 'not_measurable' as const,
      reason: 'human_blind_review_required',
    },
    completionMetrics: {
      uniqueAttemptCount: 40,
      duplicateObservationCount: 0,
      tokens: {
        promptTokens: { status: 'measured' as const, value: tokenTotals.promptTokens },
        completionTokens: { status: 'measured' as const, value: tokenTotals.completionTokens },
        totalTokens: { status: 'measured' as const, value: tokenTotals.totalTokens },
        cachedTokens: measuredZero(),
      },
      finishReasons: {
        counts: { stop: 40, length: 0, content_filter: 0, tool_calls: 0 },
        unknownCount: 0,
      },
      phaseTimingsMs: {
        queue: measuredZero(),
        provider: measuredZero(),
        parse: measuredZero(),
        normalize: measuredZero(),
        total: measuredZero(),
      },
      unobservedProviderCallCount: 0,
    },
    fieldCounts: {
      issues: distribution(),
      sentenceRevisions: distribution(),
      expressionUpgrades: distribution(),
      sentencePairs: distribution(),
      logicNotes: distribution(),
      logicIssues: distribution(),
      legibilityIssues: distribution(),
    },
  }
}

function syntheticQualityState(variant: 'baseline' | 'candidate' = 'baseline') {
  const task = syntheticTask()
  return {
    stateVersion: 'grading-benchmark-quality-state-v1' as const,
    manifestSha256: 'a'.repeat(64),
    datasetSha256: 'd'.repeat(64),
    taskSha256: createHash('sha256').update(JSON.stringify(task), 'utf8').digest('hex'),
    provenance: syntheticProvenance(variant),
    quality: syntheticAggregate(variant),
    sampleMetrics: Array.from({ length: 40 }, (_, sampleIndex) => ({
      sampleIndex,
      cer: 0,
      normalizedScoreError: 0,
      totalTokens: variant === 'baseline' ? 200 : 100,
    })),
  }
}

function syntheticCandidateState() {
  const base = syntheticQualityState('candidate')
  const identity = {
    ...base,
    runIdentitySha256: 'e'.repeat(64),
  }
  return {
    ...identity,
    stateVersion: 'grading-benchmark-quality-candidate-state-v1' as const,
    candidateRunSha256: computeQualityCandidateRunSha256(identity),
  }
}

function syntheticHumanEvidence(candidateState = syntheticCandidateState()) {
  return {
    evidenceVersion: 'grading-benchmark-human-evidence-v1' as const,
    protocolRevision: 'grading-benchmark-human-review-protocol-v1' as const,
    datasetSha256: 'd'.repeat(64),
    taskSha256: candidateState.taskSha256,
    baselineProvenance: syntheticProvenance('baseline'),
    candidateProvenance: syntheticProvenance('candidate'),
    candidateRunSha256: candidateState.candidateRunSha256,
    importantIssueRecall: {
      baseline: { matched: 10, total: 10 },
      candidate: { matched: 10, total: 10 },
    },
    importantLegibilityRecall: {
      baseline: { matched: 10, total: 10 },
      candidate: { matched: 10, total: 10 },
    },
    hardRisks: {
      studentMix: 0,
      wrongTaskContext: 0,
      highRiskLegibilityMiss: 0,
      piiLeakage: 0,
    },
    blindReview: {
      sampleCount: 40,
      reviewedSampleCount: 40,
      randomizedAB: true,
      secondaryReviewSampleCount: 8,
      reviewerRelationship: 'independent_teacher' as const,
      sameTeacherReviewIntervalDays: null,
      unresolvedArbitrations: 0,
      systematicDegradation: false,
    },
  }
}

function syntheticHumanReviewPlan() {
  const task = syntheticTask()
  return {
    planVersion: 'grading-benchmark-human-review-plan-v1' as const,
    protocolRevision: 'grading-benchmark-human-review-protocol-v1' as const,
    datasetSha256: 'd'.repeat(64),
    taskSha256: createHash('sha256').update(JSON.stringify(task), 'utf8').digest('hex'),
    gitCommit: 'c'.repeat(40),
    benchmarkVersion: 'grading-benchmark-v1' as const,
    policyVersion: 'grading-policy-v1' as const,
    randomizedAB: true as const,
    secondaryReviewerStrategy: 'independent_teacher' as const,
    sameTeacherReviewIntervalDays: null,
  }
}

async function writeDistinctSyntheticPrivateBundle(
  privateRoot: string,
  options: { duplicateFirstTwo?: boolean } = {},
) {
  const manifest = syntheticManifest()
  for (let index = 0; index < manifest.samples.length; index += 1) {
    const filename = `page-${String(index + 1).padStart(3, '0')}.png`
    manifest.samples[index]!.pages[0]!.path = filename
    const byteIdentity = options.duplicateFirstTwo && index === 1 ? 0 : index
    await writeFile(resolve(privateRoot, filename), Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      byteIdentity & 0xff,
      (byteIdentity >>> 8) & 0xff,
    ]))
  }
  await writeFile(resolve(privateRoot, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(resolve(privateRoot, 'task.json'), JSON.stringify(syntheticTask()))
  return manifest
}

describe('fixed private benchmark bundle loader', () => {
  it('strictly validates task, composition and ordered page bytes inside the private root', async () => {
    const privateRoot = await mkdtemp(resolve(tmpdir(), 'grading-bundle-'))
    const resultRoot = resolve(privateRoot, '..', 'ignored-results')
    const paths = {
      privateRoot,
      manifestPath: resolve(privateRoot, 'manifest.json'),
      taskPath: resolve(privateRoot, 'task.json'),
      resultRoot,
    }
    try {
      await writeDistinctSyntheticPrivateBundle(privateRoot)

      const bundle = await loadPrivateBenchmarkBundle(paths)

      expect(bundle.manifest.samples).toHaveLength(40)
      expect(bundle.samples).toHaveLength(40)
      expect(bundle.task.fullScore).toBe(15)
      expect(bundle.samples[0]?.pages[0]?.mimeType).toBe('image/png')
      expect(bundle.samples[0]?.pages[0]?.buffer.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
      expect(bundle.datasetSha256).toMatch(/^[a-f0-9]{64}$/u)
    } finally {
      await rm(privateRoot, { recursive: true, force: true })
    }
  })

  it('rejects two different sample IDs with the same ordered page byte sequence', async () => {
    const privateRoot = await mkdtemp(resolve(tmpdir(), 'grading-bundle-duplicate-pages-'))
    const paths = {
      privateRoot,
      manifestPath: resolve(privateRoot, 'manifest.json'),
      taskPath: resolve(privateRoot, 'task.json'),
      resultRoot: resolve(privateRoot, '..', 'ignored-results'),
    }
    try {
      await writeDistinctSyntheticPrivateBundle(privateRoot, { duplicateFirstTwo: true })
      await expect(loadPrivateBenchmarkBundle(paths)).rejects.toMatchObject({
        code: 'duplicate_sample_pages',
        message: 'invalid_private_benchmark_bundle',
      })
    } finally {
      await rm(privateRoot, { recursive: true, force: true })
    }
  })

  it('rejects MIME/signature mismatch and unexpected task fields with a content-free error', async () => {
    const privateRoot = await mkdtemp(resolve(tmpdir(), 'grading-bundle-invalid-'))
    const paths = {
      privateRoot,
      manifestPath: resolve(privateRoot, 'manifest.json'),
      taskPath: resolve(privateRoot, 'task.json'),
      resultRoot: resolve(privateRoot, '..', 'ignored-results'),
    }
    try {
      await writeFile(paths.manifestPath, JSON.stringify(syntheticManifest()))
      await writeFile(paths.taskPath, JSON.stringify(syntheticTask()))
      await writeFile(resolve(privateRoot, 'page.png'), Buffer.from([0xff, 0xd8, 0xff, 0x00]))
      await expect(loadPrivateBenchmarkBundle(paths)).rejects.toMatchObject({
        code: 'invalid_page_signature',
        message: 'invalid_private_benchmark_bundle',
      })

      await writeFile(resolve(privateRoot, 'page.png'), Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
      ]))
      await writeFile(paths.taskPath, JSON.stringify(syntheticTask({ studentName: 'private marker' })))
      await expect(loadPrivateBenchmarkBundle(paths)).rejects.toMatchObject({
        code: 'invalid_task',
        message: 'invalid_private_benchmark_bundle',
      })
    } finally {
      await rm(privateRoot, { recursive: true, force: true })
    }
  })

  it('rejects a symlink-retarget identity mismatch before returning bytes', async () => {
    const root = resolve('/private-root')
    const candidate = resolve(root, 'page.png')
    let closed = false
    const handleStat = {
      dev: 1,
      ino: 10,
      size: 9,
      mtimeMs: 1,
      ctimeMs: 1,
      isFile: () => true,
    }
    const fileSystem = {
      realpath: vi.fn(async (path: string) => path === root ? root : candidate),
      open: vi.fn(async () => ({
        stat: async () => handleStat,
        readFile: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
        close: async () => { closed = true },
      })),
      stat: vi.fn(async () => ({ ...handleStat, ino: 11 })),
    }

    await expect(readVerifiedPrivateFile(candidate, root, 1024, fileSystem))
      .rejects.toMatchObject({ code: 'private_file_identity_changed' })
    expect(closed).toBe(true)
    expect(fileSystem.open).toHaveBeenCalledTimes(1)
  })

  it('rejects an in-place same-inode same-length replacement observed during the read', async () => {
    const root = resolve('/private-root')
    const candidate = resolve(root, 'page.png')
    const before = {
      dev: 1,
      ino: 10,
      size: 9,
      mtimeMs: 1,
      ctimeMs: 1,
      isFile: () => true,
    }
    const after = { ...before, mtimeMs: 2, ctimeMs: 2 }
    let handleStatCalls = 0
    const fileSystem = {
      realpath: vi.fn(async (candidatePath: string) => candidatePath),
      open: vi.fn(async () => ({
        stat: async () => handleStatCalls++ === 0 ? before : after,
        readFile: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
        close: async () => undefined,
      })),
      stat: vi.fn(async () => before),
    }

    await expect(readVerifiedPrivateFile(candidate, root, 1024, fileSystem))
      .rejects.toMatchObject({ code: 'private_file_identity_changed' })
  })
})

describe('default benchmark command and safe report boundary', () => {
  it('returns image experiments as inconclusive without a transformer, bundle read, or Provider', async () => {
    const paths = resolveBenchmarkPrivatePaths()
    const loadBundle = vi.fn()
    const createProvider = vi.fn()
    const writeReport = vi.fn(async () => undefined)
    const request = { mode: 'image-variants' as const }
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths,
    }, {
      loadBundle,
      createProvider,
      writeReport,
    })

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(paths, 'image-variants.json', {
      reportVersion: 'grading-benchmark-command-report-v1',
      request: 'image-variants',
      conclusion: 'inconclusive',
      reason: 'explicit_image_transformer_required',
      invocationBudget: { budget: 0, invoked: 0, remaining: 0 },
      quality: null,
      qualityGates: null,
      soak: null,
      throughput: null,
    })
  })

  it('atomically writes only allowlisted content-free report schemas', async () => {
    const resultRoot = await mkdtemp(resolve(tmpdir(), 'grading-results-'))
    const paths = {
      ...resolveBenchmarkPrivatePaths(),
      resultRoot,
    }
    const report = {
      reportVersion: 'grading-benchmark-command-report-v1' as const,
      request: 'quality-baseline' as const,
      conclusion: 'inconclusive' as const,
      reason: 'external_candidate_run_and_human_review_required' as const,
      invocationBudget: { budget: 40, invoked: 40, remaining: 0 },
      quality: null,
      qualityGates: null,
      soak: null,
      throughput: null,
    }
    try {
      await writeSafeBenchmarkReport(paths, 'quality-baseline.json', report)
      const written = await import('node:fs/promises').then(({ readFile }) =>
        readFile(resolve(resultRoot, 'quality-baseline.json'), 'utf8'))
      expect(JSON.parse(written)).toEqual(report)
      expect(written).not.toMatch(/student|filename|transcript|apiKey|authorization|providerResponse/i)

      await expect(writeSafeBenchmarkReport(
        paths,
        '../escaped.json' as 'quality-baseline.json',
        report,
      )).rejects.toThrow('invalid_safe_benchmark_report')
      await expect(writeSafeBenchmarkReport(
        paths,
        'quality-baseline.json',
        { ...report, apiKey: 'private marker' } as typeof report,
      )).rejects.toThrow('invalid_safe_benchmark_report')
      await expect(writeSafeBenchmarkReport(
        paths,
        'quality-baseline.json',
        {
          ...report,
          quality: {
            student_name: 'synthetic private student',
            essay_body: 'synthetic private essay body',
          },
        },
      )).rejects.toThrow('invalid_safe_benchmark_report')
      await expect(writeSafeBenchmarkReport(paths, 'quality-baseline.json', {
        ...report,
        invocationBudget: { ...report.invocationBudget, secret: 'synthetic private marker' },
      } as never)).rejects.toThrow('invalid_safe_benchmark_report')
      await expect(writeSafeBenchmarkReport(paths, 'quality-baseline.json', {
        ...report,
        qualityGates: { overallComment: 'synthetic private marker' },
      })).rejects.toThrow('invalid_safe_benchmark_report')
      await expect(writeSafeBenchmarkReport(paths, 'quality-baseline.json', {
        ...report,
        soak: { originalText: 'synthetic private marker' },
      })).rejects.toThrow('invalid_safe_benchmark_report')
      await expect(writeSafeBenchmarkReport(paths, 'quality-baseline.json', {
        ...report,
        throughput: { materialSummary: 'synthetic private marker' },
      })).rejects.toThrow('invalid_safe_benchmark_report')
    } finally {
      await rm(resultRoot, { recursive: true, force: true })
    }
  })

  it('runs the 40-sample baseline through the runner, preserves anonymous side-channel metrics, and stays inconclusive', async () => {
    const request = { mode: 'quality' as const, variant: 'baseline' as const }
    const manifest = syntheticManifest() as never
    const bundle = {
      manifest,
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      task: syntheticTask(),
      samples: (manifest as { samples: Array<{ id: string; pages: unknown[] }> }).samples.map((reference) => ({
        reference,
        pages: [{ pageId: 'benchmark-page-1', mimeType: 'image/png', buffer: Buffer.from([0x89]) }],
      })),
    } as never
    let delegateCalls = 0
    const provider: MultimodalProvider = {
      generateMaterialContext: async () => { throw new Error('unused') },
      generateRubric: async () => { throw new Error('unused') },
      gradeEssay: async () => {
        delegateCalls += 1
        return { value: {}, attempts: [] }
      },
    }
    const aggregate = { reportVersion: 'grading-benchmark-report-v1', variant: 'baseline' } as never
    const runBenchmark = vi.fn(async (input: { samples: unknown[] }, dependencies: {
      provider: MultimodalProvider
      observeSampleMetrics?: (value: unknown) => Promise<void> | void
    }) => {
      for (let index = 0; index < input.samples.length; index += 1) {
        await dependencies.provider.gradeEssay({} as never)
        await dependencies.observeSampleMetrics?.({
          sampleIndex: index,
          cer: index / 1000,
          normalizedScoreError: index / 2000,
          totalTokens: 100 + index,
        })
      }
      return aggregate
    })
    const writeBaselineState = vi.fn(async (_paths: unknown, _state: unknown) => undefined)
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, {
      loadBundle: vi.fn(async () => bundle),
      createProvider: vi.fn(() => provider),
      createProvenance: vi.fn(() => ({
        benchmarkVersion: 'grading-benchmark-v1' as const,
        gitCommit: 'b'.repeat(40),
        model: 'kimi-k3' as const,
        reasoningEffort: 'low' as const,
        policyVersion: 'grading-policy-v1' as const,
        providerSchemaVersion: LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION,
        phaseBudgets: {
          material_context: 16384,
          rubric_generation: 16384,
          essay_grading_images: 16384,
          essay_regrading_text: 16384,
        },
        featureProfiles: {
          image: 'original-v1' as const,
          output: 'legacy-v1' as const,
          prompt: 'legacy' as const,
        },
        manifestSha256: 'a'.repeat(64),
        datasetSha256: 'd'.repeat(64),
      })),
      runBenchmark: runBenchmark as never,
      writeBaselineState,
      writeReport,
    })

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(delegateCalls).toBe(40)
    expect(runBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'baseline', samples: expect.any(Array) }),
      expect.objectContaining({ provider: expect.any(Object), observeSampleMetrics: expect.any(Function) }),
    )
    const state = writeBaselineState.mock.calls[0]?.[1]
    expect(state).toEqual(expect.objectContaining({
      stateVersion: 'grading-benchmark-quality-state-v1',
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      sampleMetrics: expect.arrayContaining([
        { sampleIndex: 0, cer: 0, normalizedScoreError: 0, totalTokens: 100 },
        { sampleIndex: 39, cer: 0.039, normalizedScoreError: 0.0195, totalTokens: 139 },
      ]),
    }))
    expect(writeReport).toHaveBeenCalledWith(
      expect.any(Object),
      'quality-baseline.json',
      expect.objectContaining({
        request: 'quality-baseline',
        conclusion: 'inconclusive',
        invocationBudget: { budget: 40, invoked: 40, remaining: 0 },
        quality: aggregate,
      }),
    )
  })

  it('does not spend candidate calls when the required baseline state is absent', async () => {
    const request = { mode: 'quality' as const, variant: 'candidate' as const }
    const loadBundle = vi.fn()
    const createProvider = vi.fn()
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, {
      loadBundle,
      createProvider,
      readBaselineState: vi.fn(async () => null),
      writeReport,
    })

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.any(Object),
      'quality-candidate.json',
      expect.objectContaining({
        conclusion: 'inconclusive',
        invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
      }),
    )
  })

  it('requires bound external human evidence before constructing a candidate Provider', async () => {
    const request = { mode: 'quality' as const, variant: 'candidate' as const }
    const readOrder: string[] = []
    const candidateState = syntheticCandidateState()
    const manifest = syntheticManifest() as never
    const bundle = {
      manifest,
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      task: syntheticTask(),
      samples: [],
    } as never
    const loadBundle = vi.fn(async () => {
      readOrder.push('private-bundle')
      return bundle
    })
    const createProvider = vi.fn(() => { throw new Error('provider_must_not_be_constructed') })
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, {
      loadBundle,
      readBaselineState: vi.fn(async () => {
        readOrder.push('baseline-state')
        return syntheticQualityState('baseline')
      }),
      readCandidateState: vi.fn(async () => {
        readOrder.push('candidate-state')
        return candidateState
      }),
      createProvenance: vi.fn(() => syntheticProvenance('candidate')),
      createProvider,
      readHumanEvidence: vi.fn(async () => {
        readOrder.push('human-evidence')
        return null
      }),
      writeReport,
    } as never)

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(readOrder).toEqual(['baseline-state', 'human-evidence'])
    expect(loadBundle).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.any(Object),
      'quality-candidate.json',
      expect.objectContaining({
        conclusion: 'inconclusive',
        reason: 'external_human_review_evidence_required',
        invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
      }),
    )
  })

  it('re-evaluates self-consistent persisted evidence but refuses to authenticate a passing Round A', async () => {
    const request = { mode: 'quality' as const, variant: 'candidate' as const }
    const candidateState = syntheticCandidateState()
    const bundle = {
      manifest: syntheticManifest(),
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      task: syntheticTask(),
      samples: [],
    } as never
    const createProvider = vi.fn(() => { throw new Error('provider_must_not_be_constructed') })
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, {
      loadBundle: vi.fn(async () => bundle),
      readBaselineState: vi.fn(async () => syntheticQualityState('baseline')),
      readCandidateState: vi.fn(async () => candidateState),
      readHumanEvidence: vi.fn(async () => syntheticHumanEvidence(candidateState)),
      createProvenance: vi.fn(() => syntheticProvenance('candidate')),
      createProvider,
      writeReport,
    })

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(createProvider).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.any(Object),
      'quality-candidate.json',
      expect.objectContaining({
        conclusion: 'inconclusive',
        reason: 'external_candidate_evidence_unverified',
        invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
        quality: candidateState.quality,
        qualityGates: expect.objectContaining({ status: 'pass' }),
      }),
    )
  })

  it('rejects a forged small human-evidence denominator before Provider construction', async () => {
    const request = { mode: 'quality' as const, variant: 'candidate' as const }
    const candidateState = syntheticCandidateState()
    const forgedEvidence = {
      ...syntheticHumanEvidence(candidateState),
      importantIssueRecall: {
        baseline: { matched: 1, total: 1 },
        candidate: { matched: 1, total: 1 },
      },
    }
    const createProvider = vi.fn(() => { throw new Error('provider_must_not_be_constructed') })
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, {
      loadBundle: vi.fn(async () => ({
        manifest: syntheticManifest(),
        manifestSha256: 'a'.repeat(64),
        datasetSha256: 'd'.repeat(64),
        task: syntheticTask(),
        samples: [],
      } as never)),
      readBaselineState: vi.fn(async () => syntheticQualityState('baseline')),
      readCandidateState: vi.fn(async () => candidateState),
      readHumanEvidence: vi.fn(async () => forgedEvidence),
      createProvenance: vi.fn(() => syntheticProvenance('candidate')),
      createProvider,
      writeReport,
    })

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(createProvider).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.any(Object),
      'quality-candidate.json',
      expect.objectContaining({
        conclusion: 'inconclusive',
        invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
      }),
    )
  })

  it('allows exactly 40 candidate calls through an injected adapter but does not authenticate its pass', async () => {
    const request = { mode: 'quality' as const, variant: 'candidate' as const }
    const bundle = {
      manifest: syntheticManifest(),
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      task: syntheticTask(),
      samples: Array.from({ length: 40 }, () => ({})),
    } as never
    let delegateCalls = 0
    const provider: MultimodalProvider = {
      generateMaterialContext: async () => { throw new Error('unused') },
      generateRubric: async () => { throw new Error('unused') },
      gradeEssay: async () => {
        delegateCalls += 1
        return { value: {}, attempts: [] }
      },
    }
    const runBenchmark = vi.fn(async (input: unknown, dependencies: {
      provider: MultimodalProvider
      observeSampleMetrics: (value: unknown) => void
      assessResult?: unknown
    }) => {
      expect(dependencies.assessResult).toBeTypeOf('function')
      for (let sampleIndex = 0; sampleIndex < 40; sampleIndex += 1) {
        await dependencies.provider.gradeEssay({} as never)
        dependencies.observeSampleMetrics({
          sampleIndex,
          cer: 0,
          normalizedScoreError: 0,
          totalTokens: 100,
        })
      }
      return syntheticAggregate('candidate')
    })
    const writeCandidateState = vi.fn(async () => undefined)
    const writeHumanEvidence = vi.fn(async () => undefined)
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, {
      loadBundle: vi.fn(async () => bundle),
      readBaselineState: vi.fn(async () => syntheticQualityState('baseline')),
      readCandidateState: vi.fn(async () => null),
      readHumanEvidence: vi.fn(async () => null),
      createProvenance: vi.fn(() => syntheticProvenance('candidate')),
      createProvider: vi.fn(() => provider),
      runBenchmark: runBenchmark as never,
      writeCandidateState,
      writeHumanEvidence,
      humanReviewAdapter: {
        plan: syntheticHumanReviewPlan(),
        runIdentitySha256: 'e'.repeat(64),
        assessAndPresentResult: vi.fn(async () => ({
          detectedImportantIssueLabels: [],
          detectedImportantLegibilityLabels: [],
          hardRisks: { studentMix: false, wrongTaskContext: false, piiLeakage: false },
        })),
        createHumanEvidence: vi.fn(async ({ candidateState }) => (
          syntheticHumanEvidence(candidateState)
        )),
      },
      writeReport,
    } as never)

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(delegateCalls).toBe(40)
    expect(writeCandidateState).toHaveBeenCalledTimes(1)
    expect(writeHumanEvidence).toHaveBeenCalledTimes(1)
    expect((writeCandidateState.mock.calls as unknown[][])[0]?.[1]).toEqual(expect.objectContaining({
      stateVersion: 'grading-benchmark-quality-candidate-state-v1',
      runIdentitySha256: 'e'.repeat(64),
      candidateRunSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }))
    expect(writeReport).toHaveBeenCalledWith(
      expect.any(Object),
      'quality-candidate.json',
      expect.objectContaining({
        conclusion: 'inconclusive',
        reason: 'external_candidate_evidence_unverified',
        qualityGates: expect.objectContaining({ status: 'pass' }),
      }),
    )
  })

  it('strictly rejects private fields and mismatched run identity in candidate state and human evidence', async () => {
    const privateRoot = await mkdtemp(resolve(tmpdir(), 'grading-human-evidence-'))
    const resultRoot = resolve(privateRoot, 'ignored-results')
    const paths = {
      privateRoot,
      manifestPath: resolve(privateRoot, 'manifest.json'),
      taskPath: resolve(privateRoot, 'task.json'),
      resultRoot,
    }
    const candidateState = syntheticCandidateState()
    try {
      await mkdir(resultRoot, { recursive: true })
      await expect(writeQualityCandidateState(paths, {
        ...candidateState,
        student_name: 'synthetic private student',
      } as never)).rejects.toThrow('invalid_quality_candidate_state')
      await expect(writeQualityCandidateState(paths, {
        ...candidateState,
        candidateRunSha256: 'f'.repeat(64),
      })).rejects.toThrow('invalid_quality_candidate_state')

      await writeQualityCandidateState(paths, candidateState)
      await expect(readQualityCandidateState(paths)).resolves.toEqual(candidateState)

      await expect(writeHumanReviewEvidence(paths, {
        ...syntheticHumanEvidence(candidateState),
        essay_body: 'synthetic private essay body',
      } as never)).rejects.toThrow(
        'invalid_human_review_evidence',
      )
      const humanEvidence = syntheticHumanEvidence(candidateState)
      await writeHumanReviewEvidence(paths, humanEvidence)
      await expect(readHumanReviewEvidence(paths)).resolves.toEqual(humanEvidence)
    } finally {
      await rm(privateRoot, { recursive: true, force: true })
    }
  })

  it('rejects changed page bytes by dataset identity before candidate Provider construction', async () => {
    const request = { mode: 'quality' as const, variant: 'candidate' as const }
    const manifest = syntheticManifest() as never
    const task = syntheticTask()
    const taskDigest = createHash('sha256').update(JSON.stringify(task), 'utf8').digest('hex')
    const baselineProvenance = {
      benchmarkVersion: 'grading-benchmark-v1' as const,
      gitCommit: 'b'.repeat(40),
      model: 'kimi-k3' as const,
      reasoningEffort: 'low' as const,
      policyVersion: 'grading-policy-v1' as const,
      providerSchemaVersion: LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION,
      phaseBudgets: {
        material_context: 16384,
        rubric_generation: 16384,
        essay_grading_images: 16384,
        essay_regrading_text: 16384,
      },
      featureProfiles: {
        image: 'original-v1' as const,
        output: 'legacy-v1' as const,
        prompt: 'legacy' as const,
      },
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'c'.repeat(64),
    }
    const candidateProvenance = {
      ...baselineProvenance,
      providerSchemaVersion: ESSAY_PROVIDER_SCHEMA_VERSION,
      featureProfiles: {
        image: 'original-v1' as const,
        output: 'deduplicated-v1' as const,
        prompt: 'optimized-v1' as const,
      },
      datasetSha256: 'd'.repeat(64),
    }
    const bundle = {
      manifest,
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      task,
      samples: [],
    } as never
    const createProvider = vi.fn(() => { throw new Error('provider_must_not_be_constructed') })
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, {
      loadBundle: vi.fn(async () => bundle),
      readBaselineState: vi.fn(async () => ({
        stateVersion: 'grading-benchmark-quality-state-v1',
        manifestSha256: 'a'.repeat(64),
        datasetSha256: 'c'.repeat(64),
        taskSha256: taskDigest,
        provenance: baselineProvenance,
        quality: {},
        sampleMetrics: [],
      } as never)),
      createProvenance: vi.fn(() => candidateProvenance as never),
      createProvider,
      writeReport,
    })

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(createProvider).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.any(Object),
      'quality-candidate.json',
      expect.objectContaining({
        conclusion: 'inconclusive',
        invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
      }),
    )
  })

  it('accepts exact baseline provenance and rejects the candidate feature profile', async () => {
    const resultRoot = await mkdtemp(resolve(tmpdir(), 'grading-benchmark-baseline-state-'))
    const paths = {
      ...resolveBenchmarkPrivatePaths(),
      resultRoot,
    }
    const baselineState = {
      ...syntheticQualityState('baseline'),
      taskSha256: 'b'.repeat(64),
    }
    try {
      await writeFile(
        resolve(resultRoot, 'quality-baseline-state.json'),
        JSON.stringify(baselineState),
        'utf8',
      )
      await expect(readQualityBaselineState(paths)).resolves.toMatchObject({
        provenance: baselineState.provenance,
      })
      await expect(writeQualityBaselineState(paths, {
        ...baselineState,
        quality: {
          ...baselineState.quality,
          essay_body: 'synthetic private essay body',
        },
      } as never)).rejects.toThrow('invalid_quality_baseline_state')

      await writeFile(
        resolve(resultRoot, 'quality-baseline-state.json'),
        JSON.stringify({
          ...baselineState,
          provenance: syntheticProvenance('candidate'),
          quality: syntheticAggregate('candidate'),
        }),
        'utf8',
      )
      await expect(readQualityBaselineState(paths)).rejects.toThrow(
        'invalid_quality_baseline_state',
      )
    } finally {
      await rm(resultRoot, { recursive: true, force: true })
    }
  })
})

describe('quality state sample metric binding', () => {
  const mismatches = [
    {
      name: '40 structurally valid forged observations',
      mutate: (state: any) => {
        for (const metric of state.sampleMetrics) {
          metric.cer = 0.25
          metric.normalizedScoreError = 0.25
        }
      },
    },
    {
      name: 'a normalized score error above one despite matching summary arithmetic',
      mutate: (state: any) => {
        state.sampleMetrics[0].normalizedScoreError = 1.25
        state.quality.normalizedScoreError.mean.value = 0.03125
      },
    },
    {
      name: 'fractional per-sample token counts whose sum still matches the aggregate',
      mutate: (state: any) => {
        state.sampleMetrics[0].totalTokens -= 0.5
        state.sampleMetrics[1].totalTokens += 0.5
      },
    },
    {
      name: 'a CER macro that disagrees with the per-sample mean',
      mutate: (state: any) => {
        state.quality.cer.macro.value = 0.1
      },
    },
    {
      name: 'a score mean that disagrees with the per-sample mean',
      mutate: (state: any) => {
        state.quality.normalizedScoreError.mean.value = 0.1
      },
    },
    {
      name: 'a score median that disagrees with the deterministic per-sample median',
      mutate: (state: any) => {
        state.quality.normalizedScoreError.median.value = 0.1
      },
    },
    {
      name: 'a CER observation count below the accepted count',
      mutate: (state: any) => {
        state.sampleMetrics[0].cer = null
        state.sampleMetrics[0].totalTokens = null
      },
    },
    {
      name: 'a score observation count below the accepted count',
      mutate: (state: any) => {
        state.sampleMetrics[0].normalizedScoreError = null
        state.sampleMetrics[0].totalTokens = null
      },
    },
    {
      name: 'a complete per-sample token sum that disagrees with the aggregate total',
      mutate: (state: any) => {
        state.sampleMetrics[0].totalTokens += 1
      },
    },
    {
      name: 'a complete per-sample token binding when aggregate usage is not measurable',
      mutate: (state: any) => {
        state.quality.completionMetrics.tokens.totalTokens = {
          status: 'not_measurable',
          reason: 'unknown_or_partial_usage',
        }
      },
    },
    {
      name: 'a token value falsely attributed to a normalization-rejected sample',
      mutate: (state: any) => {
        state.sampleMetrics[0].cer = null
        state.sampleMetrics[0].normalizedScoreError = null
        state.quality.sampleCounts.accepted = 39
        state.quality.sampleCounts.normalizationFailures = 1
        state.quality.failureCounts.normalization_rejected = 1
        state.quality.structuredSuccessRate.value = 39 / 40
        state.quality.cer.measurableSampleCount = 39
        state.quality.cer.excludedSampleCount = 1
        state.quality.cer.totalReferenceCodePoints = 39
        state.quality.normalizedScoreError.measurableSampleCount = 39
        for (const distribution of Object.values(state.quality.fieldCounts) as any[]) {
          distribution.sampleCount = 39
        }
      },
    },
    {
      name: '40 metric rows paired with an aggregate that requested only 39 samples',
      mutate: (state: any) => {
        state.sampleMetrics[0].cer = null
        state.sampleMetrics[0].normalizedScoreError = null
        state.sampleMetrics[0].totalTokens = null
        state.quality.sampleCounts.requested = 39
        state.quality.sampleCounts.providerSucceeded = 39
        state.quality.sampleCounts.accepted = 39
        state.quality.structuredSuccessRate.value = 1
        state.quality.cer.measurableSampleCount = 39
        state.quality.cer.totalReferenceCodePoints = 39
        state.quality.normalizedScoreError.measurableSampleCount = 39
        for (const distribution of Object.values(state.quality.fieldCounts) as any[]) {
          distribution.sampleCount = 39
        }
      },
    },
  ] as const
  const cases = (['baseline', 'candidate'] as const).flatMap((variant) =>
    mismatches.map((mismatch) => ({ variant, ...mismatch })))

  it.each(cases)(
    'rejects $name in a $variant state even when the candidate run digest is recomputed',
    async ({ variant, mutate }) => {
      const resultRoot = await mkdtemp(resolve(tmpdir(), 'grading-metric-binding-'))
      const paths = { ...resolveBenchmarkPrivatePaths(), resultRoot }
      const state: any = structuredClone(
        variant === 'baseline' ? syntheticQualityState('baseline') : syntheticCandidateState(),
      )
      mutate(state)
      if (variant === 'candidate') {
        state.candidateRunSha256 = computeQualityCandidateRunSha256(state)
      }
      try {
        const write = variant === 'baseline'
          ? writeQualityBaselineState(paths, state)
          : writeQualityCandidateState(paths, state)
        await expect(write).rejects.toThrow(
          variant === 'baseline'
            ? 'invalid_quality_baseline_state'
            : 'invalid_quality_candidate_state',
        )
      } finally {
        await rm(resultRoot, { recursive: true, force: true })
      }
    },
  )
})

describe('paired quality conclusion', () => {
  const observations = (totalTokens: number) => Array.from({ length: 40 }, (_, sampleIndex) => ({
    sampleIndex,
    cer: sampleIndex / 10_000,
    normalizedScoreError: sampleIndex / 20_000,
    totalTokens,
  }))
  const aggregate = {
    sampleCounts: { requested: 40, accepted: 40 },
    importantIssueRecall: { status: 'measured', value: 1, matched: 8, total: 8 },
    importantLegibilityRecall: { status: 'measured', value: 1, matched: 8, total: 8 },
    evidenceLocation: { status: 'measured', value: 1, uniquelyLocated: 20, total: 20 },
    hardRisks: {
      studentMix: { status: 'measured', value: 0 },
      wrongTaskContext: { status: 'measured', value: 0 },
      highRiskLegibilityMiss: { status: 'measured', value: 0 },
      piiLeakage: { status: 'measured', value: 0 },
    },
  } as never
  const blindReview = {
    sampleCount: 40,
    reviewedSampleCount: 40,
    randomizedAB: true,
    secondaryReviewSampleCount: 8,
    reviewerRelationship: 'independent_teacher' as const,
    sameTeacherReviewIntervalDays: null,
    unresolvedArbitrations: 0,
    systematicDegradation: false,
  }
  const humanQualityEvidence = {
    importantIssueRecall: {
      baseline: { matched: 8, total: 8 },
      candidate: { matched: 8, total: 8 },
    },
    importantLegibilityRecall: {
      baseline: { matched: 8, total: 8 },
      candidate: { matched: 8, total: 8 },
    },
    hardRisks: {
      studentMix: 0,
      wrongTaskContext: 0,
      highRiskLegibilityMiss: 0,
      piiLeakage: 0,
    },
    blindReview,
  }

  it('passes only when paired measurements, assessor evidence and blind review all pass', () => {
    const result = evaluatePairedQualityGates(
      aggregate,
      observations(200),
      aggregate,
      observations(100),
      humanQualityEvidence,
    )

    expect(result.status).toBe('pass')
    expect(Object.values(result.gates).every((gate) => gate.status === 'pass')).toBe(true)
  })

  it('persists passing local candidate gates only with an unverified inconclusive conclusion', async () => {
    const gates = evaluatePairedQualityGates(
      aggregate,
      observations(200),
      aggregate,
      observations(100),
      humanQualityEvidence,
    )
    const resultRoot = await mkdtemp(resolve(tmpdir(), 'grading-unverified-candidate-'))
    try {
      await expect(writeSafeBenchmarkReport({
        ...resolveBenchmarkPrivatePaths(),
        resultRoot,
      }, 'quality-candidate.json', {
        reportVersion: 'grading-benchmark-command-report-v1',
        request: 'quality-candidate',
        conclusion: 'inconclusive',
        reason: 'external_candidate_evidence_unverified',
        invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
        quality: syntheticAggregate('candidate'),
        qualityGates: gates,
        soak: null,
        throughput: null,
      })).resolves.toBeUndefined()
    } finally {
      await rm(resultRoot, { recursive: true, force: true })
    }
  })

  it('stays inconclusive when blind review evidence is absent', () => {
    const result = evaluatePairedQualityGates(
      aggregate,
      observations(200),
      aggregate,
      observations(100),
      undefined,
    )

    expect(result.status).toBe('inconclusive')
    expect(result.gates.blindReview.status).toBe('not_measurable')
  })

  it('writes null score observations as an inconclusive score CI instead of a fatal report', async () => {
    const withoutScores = (totalTokens: number) => observations(totalTokens).map(
      (observation) => ({ ...observation, normalizedScoreError: null }),
    )
    const gates = evaluatePairedQualityGates(
      aggregate,
      withoutScores(200),
      aggregate,
      withoutScores(100),
      humanQualityEvidence,
    )
    expect(gates.status).toBe('inconclusive')
    expect(gates.gates.scoreErrorDegradation).toEqual({
      status: 'not_measurable',
      actual: null,
      threshold: 0.01,
      reason: 'missing_or_invalid_score_confidence_interval',
    })

    const resultRoot = await mkdtemp(resolve(tmpdir(), 'grading-null-score-report-'))
    try {
      await expect(writeSafeBenchmarkReport({
        ...resolveBenchmarkPrivatePaths(),
        resultRoot,
      }, 'quality-candidate.json', {
        reportVersion: 'grading-benchmark-command-report-v1',
        request: 'quality-candidate',
        conclusion: 'inconclusive',
        reason: null,
        invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
        quality: syntheticAggregate('candidate'),
        qualityGates: gates,
        soak: null,
        throughput: null,
      })).resolves.toBeUndefined()
    } finally {
      await rm(resultRoot, { recursive: true, force: true })
    }
  })
})

describe('soak command', () => {
  const passingAudit = {
    requested: 100,
    accepted: 100,
    assessmentCoverage: 100,
    assessmentFailures: 0,
    evidenceLocation: { uniquelyLocated: 20, total: 20 },
    hardRisks: {
      studentMix: 0,
      wrongTaskContext: 0,
      highRiskLegibilityMiss: 0,
      piiLeakage: 0,
    },
  }

  it('fails closed before bundle loading or Provider construction without a soak audit assessor', async () => {
    const request = { mode: 'soak' as const, calls: 100 as const }
    const loadBundle = vi.fn()
    const createProvider = vi.fn()
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, { loadBundle, createProvider, writeReport })

    await expect(command.execute()).resolves.toEqual({ status: 'inconclusive' })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(expect.any(Object), 'soak.json', {
      reportVersion: 'grading-benchmark-command-report-v1',
      request: 'soak',
      conclusion: 'inconclusive',
      reason: 'external_soak_audit_adapter_required',
      invocationBudget: { budget: 100, invoked: 0, remaining: 100 },
      quality: null,
      qualityGates: null,
      soak: null,
      throughput: null,
    })
  })

  it.each([
    ['all evidence complete', {}, 'pass'],
    ['one contract failure with complete audit', { accepted: 99, assessmentCoverage: 99 }, 'pass'],
    ['two contract failures', { accepted: 98, assessmentCoverage: 98 }, 'fail'],
    ['evidence is not uniquely located', { evidenceLocation: { uniquelyLocated: 19, total: 20 } }, 'fail'],
    ['assessment coverage is incomplete', { assessmentCoverage: 99 }, 'fail'],
    ['assessment has one failure', { assessmentFailures: 1 }, 'fail'],
    ['a hard risk is present', { hardRisks: { ...passingAudit.hardRisks, piiLeakage: 1 } }, 'fail'],
    ['audit evidence is unknown', { evidenceLocation: null }, 'inconclusive'],
  ] as const)(
    'classifies %s as %s using contract and audit evidence',
    (_label, override, expected) => {
      expect(evaluateSoakConclusion({ ...passingAudit, ...override }).status).toBe(expected)
    },
  )

  it('uses 100 distinct candidate identities, the real runner boundary, and exactly 100 Provider invocations', async () => {
    const request = { mode: 'soak' as const, calls: 100 as const }
    const manifest = syntheticManifest() as never
    const bundle = {
      manifest,
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      task: syntheticTask(),
      samples: (manifest as { samples: Array<{ id: string }> }).samples.map((reference) => ({
        reference,
        pages: [{ pageId: 'benchmark-page-1', mimeType: 'image/png', buffer: Buffer.from([0x89]) }],
      })),
    } as never
    let delegateCalls = 0
    const provider: MultimodalProvider = {
      generateMaterialContext: async () => { throw new Error('unused') },
      generateRubric: async () => { throw new Error('unused') },
      gradeEssay: async () => {
        delegateCalls += 1
        return { value: {}, attempts: [] }
      },
    }
    const aggregate = {
      reportVersion: 'grading-benchmark-report-v1',
      variant: 'candidate',
      sampleCounts: {
        requested: 100,
        providerSucceeded: 100,
        accepted: 100,
        providerFailures: 0,
        normalizationFailures: 0,
        assessmentFailures: 0,
        assessmentCoverage: 100,
      },
      evidenceLocation: { status: 'measured', value: 1, uniquelyLocated: 20, total: 20 },
      hardRisks: {
        studentMix: { status: 'measured', value: 0 },
        wrongTaskContext: { status: 'measured', value: 0 },
        highRiskLegibilityMiss: { status: 'measured', value: 0 },
        piiLeakage: { status: 'measured', value: 0 },
      },
    } as never
    let observedIds: string[] = []
    const runBenchmark = vi.fn(async (input: { samples: Array<{ reference: { id: string } }> }, dependencies: { provider: MultimodalProvider }) => {
      observedIds = input.samples.map(({ reference }) => reference.id)
      for (let index = 0; index < input.samples.length; index += 1) {
        await dependencies.provider.gradeEssay({} as never)
      }
      return aggregate
    })
    const writeReport = vi.fn(async () => undefined)
    const command = createDefaultBenchmarkCommand({
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {},
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }, {
      loadBundle: vi.fn(async () => bundle),
      createProvider: vi.fn(() => provider),
      createProvenance: vi.fn(() => ({
        benchmarkVersion: 'grading-benchmark-v1' as const,
        gitCommit: 'b'.repeat(40),
        model: 'kimi-k3' as const,
        reasoningEffort: 'low' as const,
        policyVersion: 'grading-policy-v1' as const,
        providerSchemaVersion: ESSAY_PROVIDER_SCHEMA_VERSION,
        phaseBudgets: {
          material_context: 16384,
          rubric_generation: 16384,
          essay_grading_images: 16384,
          essay_regrading_text: 16384,
        },
        featureProfiles: {
          image: 'original-v1' as const,
          output: 'deduplicated-v1' as const,
          prompt: 'optimized-v1' as const,
        },
        manifestSha256: 'a'.repeat(64),
        datasetSha256: 'd'.repeat(64),
      })),
      runBenchmark: runBenchmark as never,
      assessResult: vi.fn() as never,
      writeReport,
    })

    await expect(command.execute()).resolves.toEqual({ status: 'complete', gatesPassed: true })
    expect(delegateCalls).toBe(100)
    expect(observedIds).toHaveLength(100)
    expect(new Set(observedIds).size).toBe(100)
    expect(observedIds[0]).toBe('sample-001')
    expect(observedIds[99]).toBe('sample-100')
    expect(writeReport).toHaveBeenCalledWith(expect.any(Object), 'soak.json', expect.objectContaining({
      conclusion: 'pass',
      invocationBudget: { budget: 100, invoked: 100, remaining: 0 },
      quality: aggregate,
      soak: {
        status: 'pass',
        gates: expect.objectContaining({
          soak: expect.objectContaining({ status: 'pass' }),
          evidenceLocation: expect.objectContaining({ status: 'pass' }),
          assessmentCoverage: expect.objectContaining({ status: 'pass' }),
          hardRisks: expect.objectContaining({ status: 'pass' }),
        }),
      },
    }))
  })
})

describe('throughput command', () => {
  it('distinguishes measurable pass/fail from missing usage or effective concurrency', () => {
    const completeRun = {
      requested: 30,
      completed: 30,
      uniqueEssays: 30,
      attachmentRequests: 30,
      httpCompletedAttachments: 30,
      providerInvocations: 30,
      providerCompletions: 30,
      uniqueAttempts: 30,
      usageKnownAttempts: 30,
      wallMs: 1000,
      firstSuccessMs: 40,
      hardLimit: 1,
      clientConcurrency: 1,
      maxActiveLeases: 0,
      maxActiveProviderCalls: 1,
      unsettledProviderCalls: 0,
      settlementTimedOut: false,
    }
    const roundIsolation = {
      baselineSettledBeforeCandidate: true,
      candidateStarted: true,
      roundsOverlapped: false,
    }
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation,
      candidate: {
        ...completeRun,
        wallMs: 350,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 4,
        maxActiveProviderCalls: 4,
      },
    }).status).toBe('pass')
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation,
      candidate: {
        ...completeRun,
        wallMs: 500,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 4,
        maxActiveProviderCalls: 4,
      },
    }).status).toBe('fail')
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation,
      candidate: {
        ...completeRun,
        wallMs: 350,
        usageKnownAttempts: 29,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 6,
        maxActiveProviderCalls: 7,
      },
    }).status).toBe('fail')
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation,
      candidate: {
        ...completeRun,
        usageKnownAttempts: 29,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 4,
        maxActiveProviderCalls: 4,
      },
    }).status).toBe('inconclusive')
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation,
      candidate: {
        ...completeRun,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 3,
        maxActiveProviderCalls: 3,
      },
    }).status).toBe('inconclusive')
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation,
      candidate: {
        ...completeRun,
        wallMs: 350,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 6,
        maxActiveProviderCalls: 7,
      },
    }).status).toBe('fail')
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation,
      candidate: {
        ...completeRun,
        wallMs: 350,
        firstSuccessMs: 41,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 6,
        maxActiveProviderCalls: 6,
      },
    }).status).toBe('fail')
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation,
      candidate: {
        ...completeRun,
        wallMs: 350,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 4,
        maxActiveProviderCalls: 4,
        unsettledProviderCalls: 1,
        settlementTimedOut: true,
      },
    })).toMatchObject({
      status: 'inconclusive',
      gate: { reason: 'throughput_rounds_not_isolated_or_unsettled' },
    })
    expect(evaluateThroughputConclusion({
      baseline: completeRun,
      roundIsolation: { ...roundIsolation, roundsOverlapped: true },
      candidate: {
        ...completeRun,
        wallMs: 350,
        hardLimit: 6,
        clientConcurrency: 12,
        attachmentRequests: 31,
        httpCompletedAttachments: 31,
        maxActiveLeases: 4,
        maxActiveProviderCalls: 4,
      },
    })).toMatchObject({
      status: 'inconclusive',
      gate: { reason: 'throughput_rounds_not_isolated_or_unsettled' },
    })
  })

  it('runs 30 serial and 30 bounded requests through the real production HTTP route', async () => {
    const manifest = syntheticManifest() as never
    const page = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])
    const bundle = {
      manifest,
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      task: syntheticTask(),
      samples: (manifest as { samples: Array<{ id: string }> }).samples.map((reference) => ({
        reference,
        pages: [{ pageId: 'benchmark-page-1', mimeType: 'image/png', buffer: page }],
      })),
    } as never
    const providerCalls = { baseline: 0, candidate: 0 }
    const providerFactory = vi.fn((_context: BenchmarkCliCommandContext, run: BenchmarkExecutionRun) => ({
      generateMaterialContext: async () => { throw new Error('unused') },
      generateRubric: async () => { throw new Error('unused') },
      gradeEssay: async () => {
        providerCalls[run.variant] += 1
        await new Promise<void>((done) => setTimeout(done, 5))
        const known = (value: number) => ({ status: 'known' as const, value })
        return {
          value: {
            transcript: 'Synthetic.', recognitionWarnings: [], printedTextExcluded: true,
            reportedTotalScore: 15,
            dimensionScores: [
              { dimensionId: 'content', score: 14.25, reason: 'Relevant.', evidence: 'Synthetic.', relatedIssueKeys: [] },
              { dimensionId: 'legibility', score: 0.75, reason: 'Readable.', evidence: 'Synthetic.', relatedIssueKeys: [] },
            ],
            issues: [], sentenceRevisions: [], expressionUpgrades: [],
            fullTextRevision: { sentencePairs: [], logicNotes: [], logicIssues: [] },
            legibilityIssues: [], overallComment: 'Synthetic.',
          },
          attempts: [{
            attemptDiagnosticId: randomUUID(),
            finishReason: 'stop' as const,
            usage: {
              promptTokens: known(20), completionTokens: known(10), totalTokens: known(30),
              cachedTokens: known(0),
            },
            providerElapsedMs: 5,
          }],
        }
      },
    } satisfies MultimodalProvider))
    const request = { mode: 'throughput' as const, essays: 30 as const }
    const context = {
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: syntheticRuntimeEnv(),
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }

    const result = await runGatewayThroughputBenchmark(context, bundle, providerFactory, {
      admissionRetryDelayMs: 1,
    })

    expect(providerCalls).toEqual({ baseline: 30, candidate: 30 })
    expect(result.baseline).toMatchObject({
      requested: 30,
      completed: 30,
      uniqueEssays: 30,
      attachmentRequests: 30,
      httpCompletedAttachments: 30,
      providerInvocations: 30,
      providerCompletions: 30,
      uniqueAttempts: 30,
      usageKnownAttempts: 30,
      hardLimit: 1,
      clientConcurrency: 1,
      maxActiveLeases: 0,
      maxActiveProviderCalls: 1,
      unsettledProviderCalls: 0,
      settlementTimedOut: false,
    })
    expect(result.candidate).toMatchObject({
      requested: 30,
      completed: 30,
      uniqueEssays: 30,
      httpCompletedAttachments: 31,
      providerInvocations: 30,
      providerCompletions: 30,
      uniqueAttempts: 30,
      usageKnownAttempts: 30,
      unsettledProviderCalls: 0,
      settlementTimedOut: false,
    })
    expect(result.candidate.attachmentRequests).toBeGreaterThan(30)
    expect(result.candidate.clientConcurrency).toBeGreaterThan(result.candidate.hardLimit)
    expect(result.candidate.maxActiveLeases).toBeGreaterThanOrEqual(4)
    expect(result.candidate.maxActiveProviderCalls).toBeGreaterThanOrEqual(4)
    expect(result.roundIsolation).toEqual({
      baselineSettledBeforeCandidate: true,
      candidateStarted: true,
      roundsOverlapped: false,
    })
    expect(result.status).not.toBe('inconclusive')
  })

  it('persists only the exact anonymous throughput settlement and isolation schema', async () => {
    const resultRoot = await mkdtemp(resolve(tmpdir(), 'grading-throughput-results-'))
    const paths = { ...resolveBenchmarkPrivatePaths(), resultRoot }
    const baseline = {
      requested: 30, completed: 30, uniqueEssays: 30,
      attachmentRequests: 30, httpCompletedAttachments: 30,
      providerInvocations: 30, providerCompletions: 30,
      uniqueAttempts: 30, usageKnownAttempts: 30,
      wallMs: 1000, firstSuccessMs: 40,
      hardLimit: 1, clientConcurrency: 1,
      maxActiveLeases: 0, maxActiveProviderCalls: 1,
      unsettledProviderCalls: 0, settlementTimedOut: false,
    }
    const candidate = {
      ...baseline,
      attachmentRequests: 31,
      httpCompletedAttachments: 31,
      wallMs: 350,
      hardLimit: 6,
      clientConcurrency: 12,
      maxActiveLeases: 4,
      maxActiveProviderCalls: 4,
    }
    const conclusion = evaluateThroughputConclusion({
      baseline,
      candidate,
      roundIsolation: {
        baselineSettledBeforeCandidate: true,
        candidateStarted: true,
        roundsOverlapped: false,
      },
    })
    const throughput = {
      ...conclusion,
      provenance: {
        baseline: syntheticProvenance('baseline'),
        candidate: syntheticProvenance('candidate'),
      },
    }
    const report = {
      reportVersion: 'grading-benchmark-command-report-v1' as const,
      request: 'throughput' as const,
      conclusion: 'pass' as const,
      reason: null,
      invocationBudget: { budget: 60, invoked: 60, remaining: 0 },
      quality: null,
      qualityGates: null,
      soak: null,
      throughput,
    }
    try {
      await writeSafeBenchmarkReport(paths, 'throughput.json', report)
      const written = await import('node:fs/promises').then(({ readFile }) =>
        readFile(resolve(resultRoot, 'throughput.json'), 'utf8'))
      expect(written).not.toMatch(/student_name|essay_body|essayId|requestId|filename/i)
      await expect(writeSafeBenchmarkReport(paths, 'throughput.json', {
        ...report,
        throughput: {
          ...throughput,
          roundIsolation: {
            ...throughput.roundIsolation,
            secret: 'synthetic private marker',
          },
        },
      } as never)).rejects.toThrow('invalid_safe_benchmark_report')
      await expect(writeSafeBenchmarkReport(paths, 'throughput.json', {
        ...report,
        throughput: {
          ...throughput,
          candidate: {
            ...throughput.candidate,
            unsettledProviderCalls: 31,
            settlementTimedOut: true,
          },
        },
      })).rejects.toThrow('invalid_safe_benchmark_report')
    } finally {
      await rm(resultRoot, { recursive: true, force: true })
    }
  })

  it('does not start another baseline essay or the candidate while an aborted Provider call remains unsettled', async () => {
    const manifest = syntheticManifest() as never
    const page = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])
    const bundle = {
      manifest,
      manifestSha256: 'a'.repeat(64),
      datasetSha256: 'd'.repeat(64),
      task: syntheticTask(),
      samples: (manifest as { samples: Array<{ id: string }> }).samples.map((reference) => ({
        reference,
        pages: [{ pageId: 'benchmark-page-1', mimeType: 'image/png', buffer: page }],
      })),
    } as never
    const providerCalls = { baseline: 0, candidate: 0 }
    const providerFactory = vi.fn((_context: BenchmarkCliCommandContext, run: BenchmarkExecutionRun) => ({
      generateMaterialContext: async () => { throw new Error('unused') },
      generateRubric: async () => { throw new Error('unused') },
      gradeEssay: async () => {
        providerCalls[run.variant] += 1
        await new Promise<void>((done) => setTimeout(done, 50))
        return { value: {}, attempts: [] } as never
      },
    } satisfies MultimodalProvider))
    const request = { mode: 'throughput' as const, essays: 30 as const }
    const context = {
      request,
      apiKey: 'synthetic-secret',
      runtimeEnv: {
        ...syntheticRuntimeEnv(),
        GRADING_HTTP_DEADLINE_MS: '1',
        GRADING_PROVIDER_FINAL_DEADLINE_MS: '30001',
        GRADING_PROVIDER_SETTLEMENT_GRACE_MS: '1',
        GRADING_REGISTRY_TERMINAL_TTL_MS: '30003',
      },
      profile: benchmarkExecutionProfile(request),
      paths: resolveBenchmarkPrivatePaths(),
    }

    const result = await runGatewayThroughputBenchmark(context, bundle, providerFactory, {
      admissionRetryDelayMs: 1,
      maximumAdmissionRetries: 1,
      settlementWaitMs: 5,
    })

    expect(providerFactory).toHaveBeenCalledTimes(1)
    expect(providerCalls).toEqual({ baseline: 1, candidate: 0 })
    expect(result.status).toBe('inconclusive')
    expect(result.baseline).toMatchObject({
      providerInvocations: 1,
      providerCompletions: 0,
      unsettledProviderCalls: 1,
      settlementTimedOut: true,
    })
    expect(result.candidate).toMatchObject({
      providerInvocations: 0,
      providerCompletions: 0,
      unsettledProviderCalls: 0,
      settlementTimedOut: false,
    })
    expect(result.roundIsolation).toEqual({
      baselineSettledBeforeCandidate: false,
      candidateStarted: false,
      roundsOverlapped: false,
    })
  })
})

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

async function runCli(
  env: NodeJS.ProcessEnv,
  cwd: string,
  args: readonly string[] = ['--variant', 'candidate'],
): Promise<CliResult> {
  const here = dirname(fileURLToPath(import.meta.url))
  const tsxCli = resolve(here, '../../node_modules/tsx/dist/cli.mjs')
  const script = resolve(here, 'cli.ts')
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [tsxCli, script, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolveResult({ code, stdout, stderr }))
  })
}

describe('grading benchmark CLI subprocess', () => {
  it.each([
    ['baseline', ['--variant', 'baseline']],
    ['candidate', ['--variant', 'candidate']],
    ['soak', ['--mode', 'soak', '--calls', '100']],
    ['throughput', ['--mode', 'throughput', '--essays', '30']],
    ['image variants', ['--mode', 'image-variants']],
  ] as const)('keeps the %s direct command at zero HTTP and not-run without shell authorization', async (_label, args) => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.writeHead(503).end('private-upstream-marker')
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    const cwd = await mkdtemp(resolve(tmpdir(), 'grading-benchmark-cli-matrix-'))
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      KIMI_API_BASE: `http://127.0.0.1:${address.port}`,
      KIMI_API_KEY: 'synthetic-secret',
      GRADING_PROVIDER: 'kimi',
    }
    delete env.GRADING_BENCHMARK_AUTHORIZATION
    delete env.GRADING_IMAGE_EXPERIMENT

    try {
      const result = await runCli(env, cwd, args)
      expect(result).toMatchObject({
        code: 3,
        stdout: 'grading_benchmark:not_run\n',
        stderr: '',
      })
      expect(requests).toBe(0)
    } finally {
      server.close()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('requires the second image authorization in the direct subprocess before runtime loading', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'grading-benchmark-cli-image-auth-'))
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GRADING_BENCHMARK_AUTHORIZATION: 'approved',
      KIMI_API_KEY: 'synthetic-secret',
    }
    delete env.GRADING_IMAGE_EXPERIMENT
    try {
      const result = await runCli(env, cwd, ['--mode', 'image-variants'])
      expect(result).toEqual({
        code: 3,
        stdout: 'grading_benchmark:not_run\n',
        stderr: '',
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it.each([
    ['missing authorization', { GRADING_BENCHMARK_AUTHORIZATION: undefined, KIMI_API_KEY: 'synthetic-secret' }],
    ['missing credentials', { GRADING_BENCHMARK_AUTHORIZATION: 'approved', KIMI_API_KEY: undefined }],
  ])('makes zero HTTP calls and exits 3 for %s', async (_label, overrides) => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.writeHead(503).end('private-upstream-marker')
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    const cwd = await mkdtemp(resolve(tmpdir(), 'grading-benchmark-cli-'))
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      KIMI_API_BASE: `http://127.0.0.1:${address.port}`,
      GRADING_PROVIDER: 'kimi',
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }

    try {
      const result = await runCli(env, cwd)
      expect(result.code).toBe(3)
      expect(result.stdout.trim()).toBe('grading_benchmark:not_run')
      expect(result.stderr).toBe('')
      expect(requests).toBe(0)
      expect(result.stdout).not.toContain('private-upstream-marker')
    } finally {
      server.close()
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
