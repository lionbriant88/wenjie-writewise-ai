import { config as loadDotenv } from 'dotenv'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GRADING_POLICY_VERSION } from '../src/multimodal/gradingPolicy.js'
import { normalizeMultimodalResult } from '../src/multimodal/normalizeMultimodalResult.js'
import type { ConfirmedTaskPackageV2 } from '../src/multimodal/types.js'
import type { GatewayImageInput } from '../src/providers/multimodalProviderTypes.js'
import type { MultimodalProvider } from '../src/providers/multimodalProviderTypes.js'
import { getMultimodalProvider, parseKimiConfig } from '../src/providers/index.js'

type PublicGoldenResult = {
  issues: Array<{ type: string; evidenceCertainty: string }>
  legibilityIssues: Array<{ defaultOutcome: string }>
  reviewReasons: string[]
  fullTextRevision?: { logicIssues: unknown[] }
}

export interface GoldenEvaluationResult {
  caseId: string
  passed: boolean
  model: string
  policyVersion: string
  failureCategory?: string
}

export interface GoldenEvaluationDependencies {
  env?: NodeJS.ProcessEnv
  parseConfig?: typeof parseKimiConfig
  createProvider?: () => Pick<MultimodalProvider, 'gradeEssay'>
  readFixture?: (path: string) => Promise<Buffer>
  normalize?: typeof normalizeMultimodalResult
  output?: (line: string) => void
  now?: () => string
}

const task: ConfirmedTaskPackageV2 = {
  taskId: 'synthetic-policy-evaluation',
  fullScore: 10,
  materialSummary: 'Write a brief message recommending a school activity and keep every sentence relevant to that message.',
  writingRequirements: ['Use clear English sentences.', 'Keep the message focused on the school activity.'],
  constraints: ['This is synthetic evaluation material only.'],
  rubric: {
    taskName: 'Synthetic activity message',
    materialSummary: 'Write a brief message recommending a school activity and keep every sentence relevant to that message.',
    writingRequirements: ['Use clear English sentences.', 'Keep the message focused on the school activity.'],
    constraints: ['This is synthetic evaluation material only.'],
    reviewWarnings: [],
    dimensions: [
      { id: 'language', name: 'Language', weight: 50, description: 'Grammar and spelling.', deductionFocus: ['Grammar and clear spelling.'], sourceEvidence: [] },
      { id: 'relevance', name: 'Relevance', weight: 40, description: 'Relevant content and logic.', deductionFocus: ['Stay on topic.'], sourceEvidence: [] },
      { id: 'legibility', name: 'Legibility', weight: 10, description: 'Meaningful handwriting ambiguity.', deductionFocus: ['Record only meaningful ambiguity.'], sourceEvidence: [] },
    ],
  },
}

const cases = [
  { id: 'CASE-A01', file: 'ambiguous-work.png', check: 'ambiguousWork' },
  { id: 'CASE-A02', file: 'clear-enviroment.png', check: 'clearEnviroment' },
  { id: 'CASE-A03', file: 'ambiguous-cant.png', check: 'ambiguousCant' },
  { id: 'CASE-A04', file: 'grammar-and-logic.png', check: 'grammarAndLogic' },
] as const

const allowedCaseIds = new Set<string>(cases.map(({ id }) => id))
const allowedFailureCategories = new Set([
  'assertion_failed',
  'not_run_missing_local_credentials',
  'provider_auth_failed',
  'provider_balance_unavailable',
  'provider_invalid_response',
  'provider_not_configured',
  'provider_rate_limited',
  'provider_request_rejected',
  'provider_timeout',
  'provider_unavailable',
  'unexpected_failure',
])
const SAFE_TOKEN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function evaluatePolicyChecks(results: Record<typeof cases[number]['check'], PublicGoldenResult>): Record<typeof cases[number]['check'], boolean> {
  return {
    ambiguousWork: results.ambiguousWork.issues.every((issue) => issue.type !== 'spelling')
      && results.ambiguousWork.legibilityIssues.length === 0
      && !results.ambiguousWork.reviewReasons.includes('recognition_uncertain'),
    clearEnviroment: results.clearEnviroment.issues.some((issue) => (
      issue.type === 'spelling' && issue.evidenceCertainty === 'certain'
    )),
    ambiguousCant: results.ambiguousCant.legibilityIssues.some((issue) => (
      issue.defaultOutcome === 'count_as_legibility_error'
    )),
    grammarAndLogic: results.grammarAndLogic.issues.some((issue) => issue.type === 'grammar')
      && Boolean(results.grammarAndLogic.fullTextRevision?.logicIssues.length),
  }
}

export function formatGoldenEvaluationLine(result: GoldenEvaluationResult): string {
  const caseId = allowedCaseIds.has(result.caseId) ? result.caseId : 'CASE-INVALID'
  const model = safeToken(result.model, 'unknown_model')
  const policyVersion = safeToken(result.policyVersion, 'unknown_policy')
  const category = result.failureCategory ? safeFailureCategory(result.failureCategory) : undefined
  return [
    caseId,
    result.passed ? 'pass' : 'fail',
    `model=${model}`,
    `policy=${policyVersion}`,
    ...(category ? [`category=${category}`] : []),
  ].join(' ')
}

function safeToken(value: string, fallback: string): string {
  return SAFE_TOKEN.test(value) ? value : fallback
}

function safeFailureCategory(value: string): string {
  return allowedFailureCategories.has(value) ? value : 'unexpected_failure'
}

function failureCategory(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return safeFailureCategory(error.code)
  return 'unexpected_failure'
}

function fixturePath(file: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../test-fixtures/kimi-policy', file)
}

export function isDirectGoldenEvaluationExecution(argvEntry: string | undefined, scriptPath: string): boolean {
  return argvEntry !== undefined && resolve(argvEntry) === resolve(scriptPath)
}

async function evaluateOne(
  item: typeof cases[number],
  model: string,
  dependencies: Required<Pick<GoldenEvaluationDependencies, 'createProvider' | 'readFixture' | 'normalize' | 'now'>>,
): Promise<{ check: typeof item.check; result: PublicGoldenResult } | GoldenEvaluationResult> {
  try {
    const buffer = await dependencies.readFixture(fixturePath(item.file))
    const provider = dependencies.createProvider()
    const raw = await provider.gradeEssay({
      requestId: `golden-${item.id}`,
      task,
      essayId: `golden-${item.id}`,
      pages: [{ pageId: 'page-1', buffer, mimeType: 'image/png' } satisfies GatewayImageInput],
      signal: AbortSignal.timeout(60_000),
    })
    const normalized = dependencies.normalize(raw, {
      requestId: `golden-${item.id}`,
      essayId: `golden-${item.id}`,
      task,
      provider: 'remote',
      pageCount: 1,
      createdAt: dependencies.now(),
    })
    if (!normalized.ok) {
      return { caseId: item.id, passed: false, model, policyVersion: GRADING_POLICY_VERSION, failureCategory: normalized.error.code }
    }
    return { check: item.check, result: normalized.result }
  } catch (error) {
    return { caseId: item.id, passed: false, model, policyVersion: GRADING_POLICY_VERSION, failureCategory: failureCategory(error) }
  }
}

function emitAll(
  output: (line: string) => void,
  model: string,
  failureCategory: string,
): void {
  for (const item of cases) {
    output(formatGoldenEvaluationLine({ caseId: item.id, passed: false, model, policyVersion: GRADING_POLICY_VERSION, failureCategory }))
  }
}

export async function runPolicyGoldenEvaluation(dependencies: GoldenEvaluationDependencies = {}): Promise<number> {
  const env = dependencies.env ?? process.env
  const output = dependencies.output ?? console.log
  const key = env.KIMI_API_KEY?.trim()
  if (!key) {
    emitAll(output, 'unconfigured', 'not_run_missing_local_credentials')
    return 0
  }

  let model: string
  try {
    model = (dependencies.parseConfig ?? parseKimiConfig)(env).model
  } catch {
    emitAll(output, 'unconfigured', 'unexpected_failure')
    return 1
  }

  const evaluationDependencies = {
    createProvider: dependencies.createProvider ?? (() => getMultimodalProvider('kimi')),
    readFixture: dependencies.readFixture ?? readFile,
    normalize: dependencies.normalize ?? normalizeMultimodalResult,
    now: dependencies.now ?? (() => new Date().toISOString()),
  }
  const checks: Partial<Record<typeof cases[number]['check'], PublicGoldenResult>> = {}
  const failures: GoldenEvaluationResult[] = []
  for (const item of cases) {
    const outcome = await evaluateOne(item, model, evaluationDependencies)
    if ('check' in outcome) checks[outcome.check] = outcome.result
    else failures.push(outcome)
  }

  const evaluated = Object.keys(checks).length === cases.length
    ? evaluatePolicyChecks(checks as Record<typeof cases[number]['check'], PublicGoldenResult>)
    : null
  let failed = false
  for (const item of cases) {
    const failure = failures.find(({ caseId }) => caseId === item.id)
    const passed = evaluated?.[item.check] ?? false
    output(formatGoldenEvaluationLine(failure ?? {
      caseId: item.id,
      passed,
      model,
      policyVersion: GRADING_POLICY_VERSION,
      ...(!passed ? { failureCategory: 'assertion_failed' } : {}),
    }))
    if (!passed) failed = true
  }
  return failed ? 1 : 0
}

async function main(): Promise<void> {
  try {
    loadDotenv()
    process.exitCode = await runPolicyGoldenEvaluation()
  } catch {
    try {
      emitAll(console.log, 'unconfigured', 'unexpected_failure')
    } finally {
      process.exitCode = 1
    }
  }
}

if (isDirectGoldenEvaluationExecution(process.argv[1], fileURLToPath(import.meta.url))) {
  void main()
}
