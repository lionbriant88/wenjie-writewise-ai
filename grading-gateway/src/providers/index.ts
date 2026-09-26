import type { GatewayRuntimeConfig } from '../gatewayRuntimeConfig.js'
import { calculateDimensionMaxScore, calculateTotalScore, roundScore2 } from '../../../app/src/services/grading/scoringRules.js'
import { FailureGradingProvider } from './failureGradingProvider.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import { StructuredMultimodalProvider } from './structuredMultimodalProvider.js'
import { createOpenRouterTransport } from './openRouterTransport.js'
import { createDeepSeekTransport } from './deepSeekMultimodalTransport.js'
import { createKimiTransport, type KimiTransport, type KimiTransportOptions } from './kimiTransport.js'
import { MockGradingProvider } from './mockGradingProvider.js'
import type { ClassReviewSynthesisProvider } from './classReviewSynthesisProviderTypes.js'
import type { MultimodalProvider } from './multimodalProviderTypes.js'
import {
  GradingProviderError,
  type GradingProvider,
  type MultimodalProviderCallStage,
} from './providerTypes.js'

export interface MultimodalProviderDependencies {
  apiKey?: string
  fetchImpl?: typeof fetch
  mockFactory?: () => MultimodalProvider
  kimiTransportFactory?: (options: KimiTransportOptions) => KimiTransport
}

export type ClassReviewSynthesisMode = 'disabled' | 'fake' | 'kimi'

export interface ClassReviewSynthesisProviderDependencies {
  fakeFactory?: () => ClassReviewSynthesisProvider
  kimiFactory?: () => ClassReviewSynthesisProvider
}

function providerConfigurationError() {
  return new GradingProviderError('provider_not_configured', 'AI Provider configuration is invalid.', false)
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new GradingProviderError('provider_timeout', 'AI grading timed out.', true)
}

class ExplicitMultimodalMockProvider implements MultimodalProvider {
  async generateMaterialContext(input: Parameters<MultimodalProvider['generateMaterialContext']>[0]) {
    throwIfAborted(input.signal)
    return {
      value: {
        materialSummary: input.writingRequirement,
        writingRequirements: [input.writingRequirement],
        constraints: [],
        reviewWarnings: ['Explicit mock output requires teacher review.'],
      },
      attempts: [],
    }
  }

  async generateRubric(input: Parameters<MultimodalProvider['generateRubric']>[0]) {
    throwIfAborted(input.signal)
    const writingRequirement = input.writingRequirement?.trim() || 'Write a synthetic essay.'
    return {
      value: {
        taskName: 'Synthetic mock task',
        materialSummary: writingRequirement,
        writingRequirements: [writingRequirement],
        constraints: [],
        dimensions: [
          { id: 'content', name: 'Content and task completion', weight: 95, description: 'Address the confirmed writing requirement.', deductionFocus: [], sourceEvidence: [] },
          { id: 'legibility', name: 'Legibility', weight: 5, description: 'Handwriting is legible.', deductionFocus: [], sourceEvidence: [] },
        ],
        reviewWarnings: ['Explicit mock output requires teacher review.'],
      },
      attempts: [],
    }
  }

  async gradeEssay(input: Parameters<MultimodalProvider['gradeEssay']>[0]) {
    throwIfAborted(input.signal)
    const transcript = input.confirmedTranscript ?? 'Synthetic multimodal mock transcript.'
    const dimensionScores = input.task.rubric.dimensions.map((dimension) => {
      const maxScore = calculateDimensionMaxScore(input.task.fullScore, dimension.weight)
      return {
        dimensionId: dimension.id,
        score: roundScore2(maxScore * 0.8),
        reason: 'Explicit mock generated a deterministic candidate score.',
        evidence: transcript,
        relatedIssueKeys: [],
      }
    })
    return {
      value: {
        transcript,
        recognitionWarnings: [],
        printedTextExcluded: true,
        reportedTotalScore: calculateTotalScore(dimensionScores.map(({ score }) => score), input.task.fullScore),
        dimensionScores,
        issues: [],
        sentenceRevisions: [],
        expressionUpgrades: [],
        fullTextRevision: { correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
        legibilityIssues: [],
        overallComment: 'Explicit mock grading output requires teacher review.',
      },
      attempts: [],
    }
  }
}

export function getProvider(name: string | undefined): GradingProvider {
  if (name === 'mock') return new MockGradingProvider()
  if (name === 'mock_failure') return new FailureGradingProvider()
  throw providerConfigurationError()
}

function explicitlyConstructClassReviewProvider(
  factory: (() => ClassReviewSynthesisProvider) | undefined,
): ClassReviewSynthesisProvider {
  if (!factory) throw providerConfigurationError()
  const provider = factory()
  if (!provider || typeof provider.synthesize !== 'function') throw providerConfigurationError()
  return provider
}

export function getClassReviewSynthesisProvider(
  mode: ClassReviewSynthesisMode | undefined,
  dependencies: ClassReviewSynthesisProviderDependencies = {},
): ClassReviewSynthesisProvider | null {
  if (mode === 'disabled') return null
  if (mode === 'fake') return explicitlyConstructClassReviewProvider(dependencies.fakeFactory)
  if (mode === 'kimi') return explicitlyConstructClassReviewProvider(dependencies.kimiFactory)
  throw providerConfigurationError()
}

export function createStageBudgetedTransport(
  transport: KimiTransport,
  budgets: Record<MultimodalProviderCallStage, number>,
): KimiTransport {
  return {
    maxCompletionTokens: Math.max(...Object.values(budgets)),
    complete(input) {
      if (input.stage === 'class_review_generation') throw providerConfigurationError()
      return transport.complete({ ...input, maxCompletionTokens: budgets[input.stage] })
    },
  }
}

export function getMultimodalProvider(
  runtimeConfig: GatewayRuntimeConfig,
  dependencies?: MultimodalProviderDependencies,
): MultimodalProvider
export function getMultimodalProvider(
  config: GatewayRuntimeConfig,
  dependencies: MultimodalProviderDependencies = {},
): MultimodalProvider {
  if (config.provider === 'mock') {
    return dependencies.mockFactory?.() ?? new ExplicitMultimodalMockProvider()
  }
  if (config.provider === 'openrouter' || config.provider === 'deepseek') {
    const selected = config.provider === 'deepseek' ? config.deepseek : config.openrouter
    if (!selected || config.rubricStrategy !== 'single-pass-v1'
      || config.essayPromptProfile !== 'optimized-v1' || config.executionRegistry !== 'memory-v1'
      || config.classReviewSynthesis.mode !== 'disabled') throw providerConfigurationError()
    const transport = (config.provider === 'deepseek' ? createDeepSeekTransport : createOpenRouterTransport)({
      apiKey: dependencies.apiKey,
      model: selected.model,
      maxCompletionTokens: Math.max(...Object.values(selected.stageBudgets)),
      fetchImpl: dependencies.fetchImpl,
    })
    return new StructuredMultimodalProvider(
      createStageBudgetedTransport(transport, selected.stageBudgets),
      config.rubricStrategy, config.essayPromptProfile, '',
    )
  }
  if (config.provider !== 'kimi') throw providerConfigurationError()
  const apiKey = dependencies.apiKey
  if (!apiKey?.trim()) throw providerConfigurationError()
  const transportFactory = dependencies.kimiTransportFactory ?? createKimiTransport
  const transport = transportFactory({
    apiKey,
    apiBase: config.kimi.apiBase,
    model: config.kimi.model,
    reasoningEffort: config.kimi.reasoningEffort,
    maxCompletionTokens: Math.max(...Object.values(config.kimi.stageBudgets)),
    ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
  })
  return new KimiMultimodalProvider(
    createStageBudgetedTransport(transport, config.kimi.stageBudgets),
    config.rubricStrategy,
    config.essayPromptProfile,
    config.kimi.promptCacheSecret,
  )
}
