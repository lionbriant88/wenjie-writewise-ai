import {
  GradingProviderError,
  type ProviderAttemptObservation,
} from '../providers/providerTypes.js'

export type ClassReviewTrustedMode = 'fake' | 'kimi'

function deduplicateAttempts(
  attempts: readonly ProviderAttemptObservation[],
): ProviderAttemptObservation[] {
  const seen = new Set<string>()
  return attempts.filter((attempt) => {
    if (seen.has(attempt.attemptDiagnosticId)) return false
    seen.add(attempt.attemptDiagnosticId)
    return true
  })
}

export class ClassReviewPromptContractDriftError extends GradingProviderError {
  readonly classReviewSafeFailureCode = 'class_review_prompt_contract_drift' as const

  constructor(attempts: readonly ProviderAttemptObservation[] = []) {
    super(
      'provider_invalid_response',
      'Class review prompt contract drift was detected.',
      false,
      undefined,
      {
        termination: 'confirmed',
        ...(attempts.length > 0 ? { attemptObservations: deduplicateAttempts(attempts) } : {}),
      },
    )
    this.name = 'ClassReviewPromptContractDriftError'
  }
}

export class ClassReviewRuntimeInvariant {
  #promptContract: 'ready' | 'drifted' = 'ready'

  assertCanDispatch(mode: ClassReviewTrustedMode): void {
    if (mode === 'kimi' && this.#promptContract === 'drifted') {
      throw new ClassReviewPromptContractDriftError()
    }
  }

  inspectAttempts(
    mode: ClassReviewTrustedMode,
    attempts: readonly ProviderAttemptObservation[],
  ): boolean | undefined {
    if (mode === 'fake') return undefined
    const deduplicated = deduplicateAttempts(attempts)
    let proven = deduplicated.length > 0
    for (const attempt of deduplicated) {
      const promptTokens = attempt.usage?.promptTokens
      if (promptTokens?.status !== 'known'
        || !Number.isSafeInteger(promptTokens.value)
        || promptTokens.value < 0) {
        proven = false
        continue
      }
      if (promptTokens.value > 16_384) {
        this.#promptContract = 'drifted'
        throw new ClassReviewPromptContractDriftError(deduplicated)
      }
    }
    return proven
  }

  snapshot(): { promptContract: 'ready' | 'drifted' } {
    return { promptContract: this.#promptContract }
  }
}
