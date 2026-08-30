import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { GatewayRuntimeConfig } from '../gatewayRuntimeConfig.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import type { MultimodalProvider } from './multimodalProviderTypes.js'
import type { KimiCompletionInput, KimiTransport } from './kimiTransport.js'
import {
  type ClassReviewSynthesisMode,
  createStageBudgetedTransport,
  getClassReviewSynthesisProvider,
  getMultimodalProvider,
  getProvider,
} from './index.js'
import {
  GradingProviderError,
  type MultimodalProviderCallStage,
  type ProviderCallStage,
} from './providerTypes.js'

function runtimeConfig(
  provider: 'kimi' | 'mock' = 'kimi',
  rubricStrategy: GatewayRuntimeConfig['rubricStrategy'] = 'single-pass-v1',
  essayPromptProfile: GatewayRuntimeConfig['essayPromptProfile'] = 'legacy',
): GatewayRuntimeConfig {
  return {
    provider,
    rubricStrategy,
    essayPromptProfile,
    executionRegistry: 'direct-legacy',
    deadlines: { httpMs: 360_000, providerFinalMs: 420_000, settlementGraceMs: 30_000 },
    admission: { hardLimit: 4 },
    registry: { terminalTtlMs: 86_400_000, maxEntries: 2_000 },
    retry: { maxProviderAttempts: 2, maxRateLimitRequeues: 5, baseMs: 2_000, capMs: 60_000, pauseAfterMs: 900_000 },
    kimi: {
      apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', reasoningEffort: 'low',
      promptCacheSecret: essayPromptProfile === 'optimized-v1' ? 'test-only-cache-secret-at-least-32-bytes' : '',
      stageBudgets: { material_context: 1_001, rubric_generation: 2_002, essay_grading_images: 3_003, essay_regrading_text: 4_004 },
    },
  }
}

function generatedRubric(taskName: string) {
  return {
    taskName,
    materialSummary: 'Synthetic summary.',
    writingRequirements: ['Write clearly.'],
    constraints: ['Use English.'],
    dimensions: [
      {
        id: 'content', name: 'Content', weight: 95, description: 'Cover the task.',
        deductionFocus: [], sourceEvidence: [],
      },
      {
        id: 'legibility', name: 'Legibility', weight: 5, description: 'Write legibly.',
        deductionFocus: [], sourceEvidence: [],
      },
    ],
    reviewWarnings: [],
  }
}

function completion(value: unknown, attempt: number) {
  return {
    value,
    observation: {
      attemptDiagnosticId: `strategy-attempt-${attempt}`,
      finishReason: 'stop' as const,
      providerElapsedMs: 1,
      usage: {
        promptTokens: { status: 'unknown' as const, reason: 'absent' as const },
        completionTokens: { status: 'unknown' as const, reason: 'absent' as const },
        totalTokens: { status: 'unknown' as const, reason: 'absent' as const },
        cachedTokens: { status: 'unknown' as const, reason: 'absent' as const },
      },
    },
  }
}

describe('provider selection', () => {
  it('adds class review as an independent call stage without widening multimodal budgets', () => {
    expectTypeOf<ProviderCallStage>().toEqualTypeOf<
      MultimodalProviderCallStage | 'class_review_generation'
    >()
    expectTypeOf<keyof GatewayRuntimeConfig['kimi']['stageBudgets']>()
      .toEqualTypeOf<MultimodalProviderCallStage>()
  })

  it('keeps the class-review factory independent, exact, and fail closed', () => {
    const fakeProvider = {
      async synthesize() {
        return {
          value: {
            overallComment: 'Synthetic overview.',
            strengths: [{ title: 'Clarity', detail: 'Readable.', dimensionIds: [] }],
            patterns: [],
            learningRecommendations: [{ title: 'Practice', action: 'Review.' }],
          },
          attempts: [],
        }
      },
    }
    const kimiProvider = { ...fakeProvider }
    const fakeFactory = vi.fn(() => fakeProvider)
    const kimiFactory = vi.fn(() => kimiProvider)

    expect(getClassReviewSynthesisProvider('disabled', { fakeFactory, kimiFactory })).toBeNull()
    expect(fakeFactory).not.toHaveBeenCalled()
    expect(kimiFactory).not.toHaveBeenCalled()
    expect(getClassReviewSynthesisProvider('fake', { fakeFactory, kimiFactory })).toBe(fakeProvider)
    expect(getClassReviewSynthesisProvider('kimi', { fakeFactory, kimiFactory })).toBe(kimiProvider)
    expect(fakeFactory).toHaveBeenCalledTimes(1)
    expect(kimiFactory).toHaveBeenCalledTimes(1)

    expect(() => getClassReviewSynthesisProvider(undefined, { fakeFactory, kimiFactory })).toThrowError(GradingProviderError)
    expect(() => getClassReviewSynthesisProvider('unknown' as ClassReviewSynthesisMode, {
      fakeFactory,
      kimiFactory,
    })).toThrowError(GradingProviderError)
    expect(() => getClassReviewSynthesisProvider('fake')).toThrowError(GradingProviderError)
    expect(() => getClassReviewSynthesisProvider('kimi')).toThrowError(GradingProviderError)

    type Selected = Exclude<ReturnType<typeof getClassReviewSynthesisProvider>, null>
    type SynthesisInput = Parameters<Selected['synthesize']>[0]
    type SynthesisMode = Parameters<typeof getClassReviewSynthesisProvider>[0]
    expectTypeOf<SynthesisMode>().toEqualTypeOf<ClassReviewSynthesisMode | undefined>()
    expectTypeOf<keyof SynthesisInput>().toEqualTypeOf<'request' | 'signal'>()
    expectTypeOf<SynthesisInput['signal']>().toEqualTypeOf<AbortSignal>()
    expectTypeOf<SynthesisInput['request']['contractVersion']>().toEqualTypeOf<'class-review-synthesis-request-v1'>()
    expectTypeOf<keyof MultimodalProvider>().toEqualTypeOf<
      'generateMaterialContext' | 'generateRubric' | 'gradeEssay'
    >()
  })

  it('does not infer class-review mode from the existing multimodal runtime configuration', () => {
    const classProvider = {
      async synthesize() {
        return {
          value: {
            overallComment: 'Synthetic overview.',
            strengths: [{ title: 'Clarity', detail: 'Readable.', dimensionIds: [] }],
            patterns: [],
            learningRecommendations: [{ title: 'Practice', action: 'Review.' }],
          },
          attempts: [],
        }
      },
    }
    const multimodal = getMultimodalProvider(runtimeConfig('mock'))

    expect(() => getClassReviewSynthesisProvider(runtimeConfig('mock') as unknown as ClassReviewSynthesisMode, {
      fakeFactory: () => classProvider,
    })).toThrowError(GradingProviderError)
    expect('synthesize' in multimodal).toBe(false)
    expect(typeof multimodal.generateMaterialContext).toBe('function')
    expect(typeof multimodal.generateRubric).toBe('function')
    expect(typeof multimodal.gradeEssay).toBe('function')
  })

  it('selects only the explicit legacy mock and failure providers', () => {
    expect(getProvider('mock').publicName).toBe('mock')
    expect(getProvider('mock_failure').publicName).toBe('remote')
    expect(() => getProvider(undefined)).toThrow(GradingProviderError)
  })

  it('constructs Kimi only from typed runtime config and an explicit secret dependency', () => {
    expect(getMultimodalProvider(runtimeConfig(), { apiKey: 'test-kimi-api-key-not-real' })).toBeInstanceOf(KimiMultimodalProvider)
    expect(() => getMultimodalProvider(runtimeConfig(), { apiKey: '' })).toThrowError(GradingProviderError)
    expect(() => getMultimodalProvider(runtimeConfig(), {})).toThrowError(GradingProviderError)
  })

  it.each([
    ['single-pass-v1', 1, 'Generated task'],
    ['two-pass-legacy', 2, 'Reviewed task'],
  ] as const)('wires %s into the Kimi rubric strategy', async (rubricStrategy, expectedCalls, expectedTaskName) => {
    let call = 0
    const complete = vi.fn(async () => {
      call += 1
      return completion(generatedRubric(call === 1 ? 'Generated task' : 'Reviewed task'), call)
    })
    const provider = getMultimodalProvider(runtimeConfig('kimi', rubricStrategy), {
      apiKey: 'test-kimi-api-key-not-real',
      kimiTransportFactory: () => ({ complete }),
    })

    const result = await provider.generateRubric({
      requestId: 'strategy-rubric',
      fullScore: 15,
      writingRequirement: 'Write clearly.',
      materials: [],
      signal: new AbortController().signal,
    })

    expect(complete).toHaveBeenCalledTimes(expectedCalls)
    expect(result.value.taskName).toBe(expectedTaskName)
    expect(result.attempts).toHaveLength(expectedCalls)
  })

  it.each([
    ['optimized-v1', 'essay-grading-provider-v2', true],
    ['legacy', 'essay-grading-provider-v2-legacy', false],
  ] as const)('wires the explicit %s essay prompt profile and cache secret', async (essayPromptProfile, schemaName, expectsCacheKey) => {
    const complete = vi.fn(async (_input: KimiCompletionInput) => completion({ transcript: 'Synthetic result.' }, 1))
    const provider = getMultimodalProvider(runtimeConfig('kimi', 'single-pass-v1', essayPromptProfile), {
      apiKey: 'test-kimi-api-key-not-real',
      kimiTransportFactory: () => ({ complete }),
    })
    const rubric = generatedRubric('Private teacher task name')

    await provider.gradeEssay({
      requestId: 'factory-request',
      essayId: 'private-student-name',
      task: {
        taskId: 'internal-task-id', fullScore: 15,
        materialSummary: rubric.materialSummary,
        writingRequirements: rubric.writingRequirements,
        constraints: rubric.constraints,
        rubric,
      },
      pages: [{ pageId: 'page-1', mimeType: 'image/png', buffer: Buffer.from('synthetic-page') }],
      signal: new AbortController().signal,
    })

    expect(complete.mock.calls[0]?.[0].schemaName).toBe(schemaName)
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      stage: 'essay_grading_images',
      maxCompletionTokens: 3_003,
    })
    if (expectsCacheKey) {
      expect(complete.mock.calls[0]?.[0].promptCacheKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(complete.mock.calls[0]?.[0].promptCacheKey).not.toContain('internal-task-id')
    } else {
      expect(complete.mock.calls[0]?.[0]).not.toHaveProperty('promptCacheKey')
    }
  })

  it('runs an explicit multimodal mock without a factory or Kimi key', async () => {
    const fakeProvider = {} as MultimodalProvider
    expect(getMultimodalProvider(runtimeConfig('mock'), { mockFactory: () => fakeProvider })).toBe(fakeProvider)

    const provider = getMultimodalProvider(runtimeConfig('mock'))
    const context = await provider.generateMaterialContext({
      requestId: 'explicit-mock-material',
      fullScore: 15,
      writingRequirement: 'Write a short synthetic essay.',
      materials: [],
      signal: new AbortController().signal,
    })
    const rubric = await provider.generateRubric({
      requestId: 'explicit-mock-rubric',
      fullScore: 15,
      writingRequirement: 'Write a short synthetic essay.',
      materials: [],
      signal: new AbortController().signal,
    })
    const grade = await provider.gradeEssay({
      requestId: 'explicit-mock-grade',
      essayId: 'synthetic-essay',
      task: {
        taskId: 'synthetic-task',
        fullScore: 15,
        materialSummary: rubric.value.materialSummary,
        writingRequirements: rubric.value.writingRequirements,
        constraints: rubric.value.constraints,
        rubric: rubric.value,
      },
      pages: [{ pageId: 'page-1', mimeType: 'image/png', buffer: Buffer.from('synthetic-image') }],
      signal: new AbortController().signal,
    })

    expect(context).toEqual({
      value: {
        materialSummary: 'Write a short synthetic essay.',
        writingRequirements: ['Write a short synthetic essay.'],
        constraints: [],
        reviewWarnings: ['Explicit mock output requires teacher review.'],
      },
      attempts: [],
    })
    expect(rubric.value.dimensions.map(({ id, weight }) => ({ id, weight }))).toEqual([
      { id: 'content', weight: 95 },
      { id: 'legibility', weight: 5 },
    ])
    expect(rubric.attempts).toEqual([])
    expect(grade).toMatchObject({
      value: {
        transcript: 'Synthetic multimodal mock transcript.',
        printedTextExcluded: true,
        dimensionScores: [{ dimensionId: 'content' }, { dimensionId: 'legibility' }],
      },
      attempts: [],
    })
  })

  it('fails closed instead of treating a missing Provider as Kimi or mock', () => {
    const invalid = { ...runtimeConfig('mock'), provider: undefined } as unknown as GatewayRuntimeConfig
    expect(() => getMultimodalProvider(invalid, { apiKey: 'test-kimi-api-key-not-real' })).toThrowError(GradingProviderError)
  })

  it('overrides every Provider call with the independent budget for its actual stage', async () => {
    const complete = vi.fn(async (input: KimiCompletionInput) => ({
      value: { stage: input.stage },
      observation: {
        attemptDiagnosticId: '11111111-1111-4111-8111-111111111111',
        finishReason: 'stop' as const,
        usage: {
          promptTokens: { status: 'unknown' as const, reason: 'absent' as const },
          completionTokens: { status: 'unknown' as const, reason: 'absent' as const },
          totalTokens: { status: 'unknown' as const, reason: 'absent' as const },
          cachedTokens: { status: 'unknown' as const, reason: 'absent' as const },
        },
        providerElapsedMs: 1,
      },
    }))
    const base: KimiTransport = { maxCompletionTokens: 777, complete }
    const config = runtimeConfig()
    const transport = createStageBudgetedTransport(base, config.kimi.stageBudgets)

    for (const stage of ['material_context', 'rubric_generation', 'essay_grading_images', 'essay_regrading_text'] as const) {
      await transport.complete({
        messages: [], schemaName: 'test', schema: {}, signal: new AbortController().signal,
        stage, maxCompletionTokens: 1, attempt: 1, diagnosticContext: '22222222-2222-4222-8222-222222222222',
      })
    }

    expect(complete.mock.calls.map(([input]) => [input.stage, input.maxCompletionTokens])).toEqual([
      ['material_context', 1_001],
      ['rubric_generation', 2_002],
      ['essay_grading_images', 3_003],
      ['essay_regrading_text', 4_004],
    ])
  })
})
