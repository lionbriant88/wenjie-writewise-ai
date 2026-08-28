import { config as loadDotenv } from 'dotenv'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GRADING_POLICY_VERSION } from '../src/multimodal/gradingPolicy.js'
import { normalizeMultimodalResult } from '../src/multimodal/normalizeMultimodalResult.js'
import type { MultimodalGradingResult } from '../src/multimodal/normalizeMultimodalResult.js'
import type { ConfirmedTaskPackageV2 } from '../src/multimodal/types.js'
import type { GatewayImageInput } from '../src/providers/multimodalProviderTypes.js'
import type { MultimodalProvider } from '../src/providers/multimodalProviderTypes.js'
import { getMultimodalProvider, parseKimiConfig } from '../src/providers/index.js'

export interface GoldenEvaluationResult {
  caseId: string
  status: 'pass' | 'fail' | 'not_run'
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

export interface GoldenPolicyResult {
  status: MultimodalGradingResult['status']
  transcript: MultimodalGradingResult['transcript']
  dimensionScores: Array<Pick<MultimodalGradingResult['dimensionScores'][number], 'dimensionId' | 'score' | 'maxScore' | 'reason' | 'evidence'>>
  issues: Array<Pick<MultimodalGradingResult['issues'][number], 'id' | 'type' | 'severity' | 'originalText' | 'suggestion' | 'evidenceCertainty' | 'requiresTeacherReview'>>
  legibilityIssues: Array<Pick<MultimodalGradingResult['legibilityIssues'][number], 'transcriptText' | 'possibleReadings' | 'pageNumber' | 'defaultOutcome'>>
  recognitionWarnings: MultimodalGradingResult['recognitionWarnings']
  reviewReasons: MultimodalGradingResult['reviewReasons']
  sentenceRevisions: unknown[]
  expressionUpgrades: unknown[]
  overallComment: MultimodalGradingResult['overallComment']
  fullTextRevision: {
    correctedText: string
    improvedText: string
    sentencePairs: unknown[]
    logicNotes: string[]
    logicIssues: Array<Pick<MultimodalGradingResult['fullTextRevision']['logicIssues'][number], 'originalText'>>
  }
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
      { id: 'language', name: 'Language', weight: 55, description: 'Grammar and spelling.', deductionFocus: ['Grammar and clear spelling.'], sourceEvidence: [] },
      { id: 'relevance', name: 'Relevance', weight: 40, description: 'Relevant content and logic.', deductionFocus: ['Stay on topic.'], sourceEvidence: [] },
      { id: 'legibility', name: 'Legibility', weight: 5, description: 'Meaningful handwriting ambiguity.', deductionFocus: ['Record only meaningful ambiguity.'], sourceEvidence: [] },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord) ? value : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

function exactTerm(value: unknown, term: string): boolean {
  return typeof value === 'string' && new RegExp(`(^|[^A-Za-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`, 'i').test(value)
}

function containsNegativeReadabilityOrAmbiguityNarrative(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /\b(?:ambiguous|ambiguity|uncertain|uncertainty|unresolved|indeterminate|unclear|illegible|indistinct)\b|\bnot\s+(?:fully\s+)?legible\b|\b(?:multiple|alternative|possible)\s+(?:reading|readings|interpretation|interpretations)\b|\b(?:hard|difficult)\s+to\s+read\b|\b(?:cannot|can\s+not|unable\s+to)\s+(?:be\s+)?read\b|歧义|不确定|无法确认|字迹不清|难以辨认|可能读作/iu.test(value)
}

function exactStrings(value: unknown, expected: string[]): boolean {
  const entries = strings(value)
  return entries.length === expected.length && entries.every((entry, index) => entry === expected[index])
}

function commonResult(value: unknown) {
  if (!isRecord(value) || !isRecord(value.fullTextRevision)) return null
  return {
    value,
    dimensions: records(value.dimensionScores),
    issues: records(value.issues),
    legibilityIssues: records(value.legibilityIssues),
    recognitionWarnings: strings(value.recognitionWarnings),
    reviewReasons: strings(value.reviewReasons),
    revisions: records(value.sentenceRevisions),
    upgrades: records(value.expressionUpgrades),
    fullText: value.fullTextRevision,
    pairs: records(value.fullTextRevision.sentencePairs),
    logicNotes: strings(value.fullTextRevision.logicNotes),
    logicIssues: records(value.fullTextRevision.logicIssues),
  }
}

function ambiguousWorkPasses(value: unknown): boolean {
  const result = commonResult(value)
  if (!result || result.value.status !== 'success' || result.value.transcript !== 'We work together after school.') return false
  const noStructuredFindings = result.issues.length === 0 && result.legibilityIssues.length === 0
    && result.revisions.length === 0 && result.pairs.length === 0 && result.upgrades.length === 0
    && result.logicIssues.length === 0 && result.logicNotes.length === 0
  const noWarnings = result.recognitionWarnings.length === 0 && result.reviewReasons.length === 0
  const noDeduction = result.dimensions.length > 0 && result.dimensions.every(({ score, maxScore }) => score === maxScore)
  const revisionsUnchanged = result.fullText.correctedText === result.value.transcript
    && result.fullText.improvedText === result.value.transcript
  const narratives = [
    ...result.dimensions.flatMap(({ reason, evidence }) => [reason, evidence]),
    result.value.overallComment,
    ...result.logicNotes,
  ]
  return noStructuredFindings && noWarnings && noDeduction && revisionsUnchanged
    && !narratives.some((text) => exactTerm(text, 'work') || exactTerm(text, 'walk') || containsNegativeReadabilityOrAmbiguityNarrative(text))
}

function isGroundedExactA02SpellingEdit(originalText: unknown, revisedText: unknown, transcript: unknown): boolean {
  if (typeof originalText !== 'string' || typeof revisedText !== 'string' || typeof transcript !== 'string') return false
  const target = 'enviroment'
  const targetOffset = originalText.indexOf(target)
  if (targetOffset < 0 || originalText.indexOf(target, targetOffset + target.length) >= 0) return false
  const rangeOffset = transcript.indexOf(originalText)
  if (rangeOffset < 0 || transcript.indexOf(originalText, rangeOffset + originalText.length) >= 0) return false
  return revisedText === `${originalText.slice(0, targetOffset)}environment${originalText.slice(targetOffset + target.length)}`
}

function isExactA02Revision(value: Record<string, unknown>, issueId: unknown, transcript: unknown): boolean {
  return typeof issueId === 'string'
    && isGroundedExactA02SpellingEdit(value.originalText, value.revisedText, transcript)
    && exactStrings(value.relatedIssueIds, [issueId])
    && exactStrings(value.changeTypes, ['spelling'])
}

function isExactA02Pair(value: Record<string, unknown>, issueId: unknown, transcript: unknown): boolean {
  return typeof issueId === 'string'
    && isGroundedExactA02SpellingEdit(value.originalText, value.correctedText, transcript)
    && isGroundedExactA02SpellingEdit(value.originalText, value.improvedText, transcript)
    && exactStrings(value.relatedIssueIds, [issueId])
    && exactStrings(value.changeTypes, ['spelling'])
    && value.requiresTeacherReview === false
}

function rebuildExactA02Aggregate(transcript: unknown, pair: Record<string, unknown> | undefined): unknown {
  if (!pair) return transcript
  if (typeof transcript !== 'string' || typeof pair.originalText !== 'string' || typeof pair.correctedText !== 'string') return null
  const offset = transcript.indexOf(pair.originalText)
  if (offset < 0) return null
  return `${transcript.slice(0, offset)}${pair.correctedText}${transcript.slice(offset + pair.originalText.length)}`
}

function clearEnviromentPasses(value: unknown): boolean {
  const result = commonResult(value)
  if (!result || result.value.status !== 'success' || result.value.transcript !== 'We should protect the enviroment.' || result.issues.length !== 1) return false
  const issue = result.issues[0]!
  const exactRevisionOnly = result.revisions.length <= 1
    && result.revisions.every((revision) => isExactA02Revision(revision, issue.id, result.value.transcript))
  const exactPairOnly = result.pairs.length <= 1
    && result.pairs.every((pair) => isExactA02Pair(pair, issue.id, result.value.transcript))
  const expectedAggregate = rebuildExactA02Aggregate(result.value.transcript, result.pairs[0])
  return issue.type === 'spelling'
    && issue.severity === 'low'
    && issue.originalText === 'enviroment'
    && issue.suggestion === 'environment'
    && issue.evidenceCertainty === 'certain'
    && issue.requiresTeacherReview === false
    && result.logicIssues.length === 0
    && result.logicNotes.length === 0
    && result.dimensions.filter(({ dimensionId }) => dimensionId !== 'language').every(({ score, maxScore }) => score === maxScore)
    && result.legibilityIssues.length === 0
    && result.recognitionWarnings.length === 0
    && result.reviewReasons.length === 0
    && exactRevisionOnly
    && exactPairOnly
    && result.upgrades.length === 0
    && result.fullText.correctedText === expectedAggregate
    && result.fullText.improvedText === expectedAggregate
}

function ambiguousCantPasses(value: unknown): boolean {
  const result = commonResult(value)
  if (!result || result.value.status !== 'success' || typeof result.value.transcript !== 'string' || result.legibilityIssues.length !== 1) return false
  const issue = result.legibilityIssues[0]!
  const readings = strings(issue.possibleReadings)
  const legibility = result.dimensions.find(({ dimensionId }) => dimensionId === 'legibility')
  const noOverlap = result.issues.length === 0 && result.logicIssues.length === 0
    && result.logicNotes.length === 0 && result.revisions.length === 0 && result.pairs.length === 0 && result.upgrades.length === 0
  const unchanged = result.fullText.correctedText === result.value.transcript
    && result.fullText.improvedText === result.value.transcript
  return (issue.transcriptText === 'can' || issue.transcriptText === "can't")
    && result.value.transcript.includes(issue.transcriptText)
    && readings.length === 2 && new Set(readings).size === 2 && readings.includes('can') && readings.includes("can't")
    && issue.defaultOutcome === 'count_as_legibility_error'
    && issue.pageNumber === 1
    && Boolean(legibility && typeof legibility.score === 'number' && typeof legibility.maxScore === 'number'
      && legibility.score < legibility.maxScore && legibility.evidence === issue.transcriptText)
    && result.dimensions.filter(({ dimensionId }) => dimensionId !== 'legibility').every(({ score, maxScore }) => score === maxScore)
    && result.recognitionWarnings.length === 0 && result.reviewReasons.length === 0
    && noOverlap && unchanged
}

function grammarAndLogicPasses(value: unknown): boolean {
  const result = commonResult(value)
  if (!result || result.value.status !== 'success') return false
  const grammar = result.issues.some((issue) => issue.type === 'grammar'
    && issue.evidenceCertainty === 'certain'
    && issue.originalText === 'I suggest you joins the club.'
    && issue.suggestion === 'I suggest you join the club.')
  const logic = result.logicIssues.some((issue) => issue.originalText === 'The moon is made of green paper.')
  return grammar && logic
}

function evaluatePolicyCheck(check: typeof cases[number]['check'], result: GoldenPolicyResult): boolean {
  if (check === 'ambiguousWork') return ambiguousWorkPasses(result)
  if (check === 'clearEnviroment') return clearEnviromentPasses(result)
  if (check === 'ambiguousCant') return ambiguousCantPasses(result)
  return grammarAndLogicPasses(result)
}

export function evaluatePolicyChecks(results: Record<typeof cases[number]['check'], GoldenPolicyResult>): Record<typeof cases[number]['check'], boolean> {
  return {
    ambiguousWork: evaluatePolicyCheck('ambiguousWork', results.ambiguousWork),
    clearEnviroment: evaluatePolicyCheck('clearEnviroment', results.clearEnviroment),
    ambiguousCant: evaluatePolicyCheck('ambiguousCant', results.ambiguousCant),
    grammarAndLogic: evaluatePolicyCheck('grammarAndLogic', results.grammarAndLogic),
  }
}

export function formatGoldenEvaluationLine(result: GoldenEvaluationResult): string {
  const caseId = allowedCaseIds.has(result.caseId) ? result.caseId : 'CASE-INVALID'
  const model = safeToken(result.model, 'unknown_model')
  const policyVersion = safeToken(result.policyVersion, 'unknown_policy')
  const category = result.failureCategory ? safeFailureCategory(result.failureCategory) : undefined
  return [
    caseId,
    result.status,
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
): Promise<{ check: typeof item.check; result: GoldenPolicyResult } | GoldenEvaluationResult> {
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
    const normalized = dependencies.normalize(raw.value, {
      requestId: `golden-${item.id}`,
      essayId: `golden-${item.id}`,
      task,
      provider: 'remote',
      pageCount: 1,
      createdAt: dependencies.now(),
    })
    if (!normalized.ok) {
      return { caseId: item.id, status: 'fail', model, policyVersion: GRADING_POLICY_VERSION, failureCategory: normalized.error.code }
    }
    return { check: item.check, result: normalized.result }
  } catch (error) {
    return { caseId: item.id, status: 'fail', model, policyVersion: GRADING_POLICY_VERSION, failureCategory: failureCategory(error) }
  }
}

function emitAll(
  output: (line: string) => void,
  model: string,
  failureCategory: string,
): void {
  for (const item of cases) {
    output(formatGoldenEvaluationLine({ caseId: item.id, status: failureCategory === 'not_run_missing_local_credentials' ? 'not_run' : 'fail', model, policyVersion: GRADING_POLICY_VERSION, failureCategory }))
  }
}

export async function runPolicyGoldenEvaluation(dependencies: GoldenEvaluationDependencies = {}): Promise<number> {
  const env = dependencies.env ?? process.env
  const output = dependencies.output ?? console.log
  const key = env.KIMI_API_KEY?.trim()
  if (!key) {
    emitAll(output, 'unconfigured', 'not_run_missing_local_credentials')
    return 2
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
  const outcomes = new Map<typeof cases[number]['check'], { check: typeof cases[number]['check']; result: GoldenPolicyResult } | GoldenEvaluationResult>()
  for (const item of cases) {
    const outcome = await evaluateOne(item, model, evaluationDependencies)
    outcomes.set(item.check, outcome)
  }

  let failed = false
  for (const item of cases) {
    const outcome = outcomes.get(item.check)!
    if (!('check' in outcome)) {
      output(formatGoldenEvaluationLine(outcome))
      failed = true
      continue
    }
    const passed = evaluatePolicyCheck(item.check, outcome.result)
    output(formatGoldenEvaluationLine({
      caseId: item.id,
      status: passed ? 'pass' : 'fail',
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
