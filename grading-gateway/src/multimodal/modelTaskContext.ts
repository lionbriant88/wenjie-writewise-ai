import { createHmac } from 'node:crypto'
import type { ConfirmedTaskPackageV2 } from './types.js'

export const MODEL_TASK_CONTEXT_VERSION = 'model-task-context-v1' as const
export const ESSAY_PROVIDER_SCHEMA_VERSION = 'essay-grading-provider-v3' as const
export const LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION = 'essay-grading-provider-v3-legacy' as const

const MAX_REVIEW_WARNINGS = 50
const MAX_REVIEW_WARNING_CODE_POINTS = 5_000

export interface ModelTaskContextV1 {
  fullScore: number
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  reviewWarnings: string[]
  dimensions: Array<{ id: string; name: string; description: string; weight: number }>
}

function normalizeReviewWarnings(warnings: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const warning of warnings) {
    const bounded = Array.from(warning.trim()).slice(0, MAX_REVIEW_WARNING_CODE_POINTS).join('')
    if (!bounded || seen.has(bounded)) continue
    seen.add(bounded)
    normalized.push(bounded)
    if (normalized.length === MAX_REVIEW_WARNINGS) break
  }
  return normalized
}

export function projectModelTaskContext(task: ConfirmedTaskPackageV2): ModelTaskContextV1 {
  return {
    fullScore: task.fullScore,
    materialSummary: task.materialSummary,
    writingRequirements: [...task.writingRequirements],
    constraints: [...task.constraints],
    reviewWarnings: normalizeReviewWarnings(task.rubric.reviewWarnings),
    dimensions: task.rubric.dimensions.map(({ id, name, description, weight }) => ({
      id,
      name,
      description,
      weight,
    })),
  }
}

export function canonicalTaskContextJson(context: ModelTaskContextV1): string {
  return JSON.stringify({
    fullScore: context.fullScore,
    materialSummary: context.materialSummary,
    writingRequirements: [...context.writingRequirements],
    constraints: [...context.constraints],
    reviewWarnings: [...context.reviewWarnings],
    dimensions: context.dimensions.map(({ id, name, description, weight }) => ({
      id,
      name,
      description,
      weight,
    })),
  })
}

export function derivePromptCacheKey(input: {
  taskId: string
  rubricRevisionDigest: string
  gradingPolicyVersion: string
  providerSchemaVersion: string
  hmacSecret: string
}): string {
  const framedInput = JSON.stringify([
    MODEL_TASK_CONTEXT_VERSION,
    input.taskId,
    input.rubricRevisionDigest,
    input.gradingPolicyVersion,
    input.providerSchemaVersion,
  ])
  return createHmac('sha256', input.hmacSecret).update(framedInput, 'utf8').digest('base64url')
}
