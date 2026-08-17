import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  evaluatePolicyChecks,
  formatGoldenEvaluationLine,
  isDirectGoldenEvaluationExecution,
  runPolicyGoldenEvaluation,
  type GoldenEvaluationResult,
  type GoldenPolicyResult,
} from './runPolicyGoldenEval.js'

const transcriptA01 = 'We work together after school.'
const transcriptA02 = 'We should protect the enviroment.'
const transcriptA03 = "I can't come to the meeting."
const transcriptA04 = 'I suggest you joins the club. The moon is made of green paper. We can meet after class.'

function cleanResult(transcript: string): GoldenPolicyResult {
  return {
    status: 'success' as const,
    transcript,
    dimensionScores: [
      { dimensionId: 'language', score: 5.5, maxScore: 5.5, reason: 'Language is accurate.', evidence: 'together after school.' },
      { dimensionId: 'relevance', score: 4, maxScore: 4, reason: 'The response is focused.', evidence: 'together after school.' },
      { dimensionId: 'legibility', score: 0.5, maxScore: 0.5, reason: 'The response is readable.', evidence: 'together after school.' },
    ],
    issues: [],
    legibilityIssues: [],
    recognitionWarnings: [],
    reviewReasons: [],
    sentenceRevisions: [],
    expressionUpgrades: [],
    overallComment: 'The response is clear and focused.',
    fullTextRevision: {
      correctedText: transcript,
      improvedText: transcript,
      sentencePairs: [],
      logicNotes: [],
      logicIssues: [],
    },
  }
}

function languageIssue(type: GoldenPolicyResult['issues'][number]['type']): GoldenPolicyResult['issues'][number] {
  return { id: 'test-issue', type, severity: 'low', originalText: 'work', suggestion: 'walk', evidenceCertainty: 'certain', requiresTeacherReview: false }
}

function passingResults(): Record<'ambiguousWork' | 'clearEnviroment' | 'ambiguousCant' | 'grammarAndLogic', GoldenPolicyResult> {
  const ambiguousWork = cleanResult(transcriptA01)
  const clearEnviroment: GoldenPolicyResult = {
    ...cleanResult(transcriptA02),
    dimensionScores: [
      { dimensionId: 'language', score: 5, maxScore: 5.5, reason: 'One spelling correction is needed.', evidence: 'enviroment' },
      { dimensionId: 'relevance', score: 4, maxScore: 4, reason: 'The response is focused.', evidence: 'protect the enviroment.' },
      { dimensionId: 'legibility', score: 0.5, maxScore: 0.5, reason: 'The writing is readable.', evidence: 'protect the enviroment.' },
    ],
    issues: [{ id: 'a02-spelling', type: 'spelling', severity: 'low', originalText: 'enviroment', suggestion: 'environment', evidenceCertainty: 'certain', requiresTeacherReview: false }],
  }
  const ambiguousCant: GoldenPolicyResult = {
    ...cleanResult(transcriptA03),
    dimensionScores: [
      { dimensionId: 'language', score: 5.5, maxScore: 5.5, reason: 'No language deduction.', evidence: 'come to the meeting.' },
      { dimensionId: 'relevance', score: 4, maxScore: 4, reason: 'No relevance deduction.', evidence: 'come to the meeting.' },
      { dimensionId: 'legibility', score: 0, maxScore: 0.5, reason: 'One local handwriting ambiguity.', evidence: "can't" },
    ],
    legibilityIssues: [{ transcriptText: "can't", possibleReadings: ['can', "can't"], pageNumber: 1, defaultOutcome: 'count_as_legibility_error' }],
  }
  const grammarAndLogic: GoldenPolicyResult = {
    ...cleanResult(transcriptA04),
    issues: [{ id: 'a04-grammar', type: 'grammar', severity: 'medium', originalText: 'I suggest you joins the club.', suggestion: 'I suggest you join the club.', evidenceCertainty: 'certain', requiresTeacherReview: false }],
    fullTextRevision: {
      correctedText: 'I suggest you join the club. The moon is made of green paper. We can meet after class.',
      improvedText: 'I suggest you join the club. The moon claim is unrelated. We can meet after class.',
      sentencePairs: [],
      logicNotes: [],
      logicIssues: [{ originalText: 'The moon is made of green paper.' }],
    },
  }
  return { ambiguousWork, clearEnviroment, ambiguousCant, grammarAndLogic }
}

describe('policy golden predicates', () => {
  it('accepts the four exact intended behaviors', () => {
    expect(evaluatePolicyChecks(passingResults())).toEqual({ ambiguousWork: true, clearEnviroment: true, ambiguousCant: true, grammarAndLogic: true })
  })

  it.each([
    ['partial status', (value: ReturnType<typeof cleanResult>) => { value.status = 'partial' as 'success' }],
    ['different transcript', (value: ReturnType<typeof cleanResult>) => { value.transcript = 'We walk together after school.'; value.fullTextRevision.correctedText = value.transcript; value.fullTextRevision.improvedText = value.transcript }],
    ['score deduction', (value: ReturnType<typeof cleanResult>) => { value.dimensionScores[0]!.score = 5 }],
    ['spelling issue', (value: ReturnType<typeof cleanResult>) => { value.issues.push(languageIssue('spelling')) }],
    ['word-choice issue', (value: ReturnType<typeof cleanResult>) => { value.issues.push(languageIssue('word_choice')) }],
    ['grammar issue', (value: ReturnType<typeof cleanResult>) => { value.issues.push(languageIssue('grammar')) }],
    ['disguised structure issue', (value: ReturnType<typeof cleanResult>) => { value.issues.push(languageIssue('structure')) }],
    ['logic issue', (value: ReturnType<typeof cleanResult>) => { value.fullTextRevision.logicIssues.push({ originalText: 'work' }) }],
    ['logic note', (value: ReturnType<typeof cleanResult>) => { value.fullTextRevision.logicNotes.push('Review the uncertain handwriting.') }],
    ['legibility issue', (value: ReturnType<typeof cleanResult>) => { value.legibilityIssues.push({ transcriptText: 'work', possibleReadings: ['work', 'walk'], pageNumber: 1, defaultOutcome: 'count_as_legibility_error' }) }],
    ['recognition warning', (value: ReturnType<typeof cleanResult>) => { value.recognitionWarnings.push('Uncertain word.') }],
    ['review reason', (value: ReturnType<typeof cleanResult>) => { value.reviewReasons.push('recognition_uncertain') }],
    ['sentence revision', (value: ReturnType<typeof cleanResult>) => { value.sentenceRevisions.push({ originalText: 'work' }) }],
    ['sentence pair', (value: ReturnType<typeof cleanResult>) => { value.fullTextRevision.sentencePairs.push({ originalText: 'work' }) }],
    ['expression upgrade', (value: ReturnType<typeof cleanResult>) => { value.expressionUpgrades.push({ originalText: 'work' }) }],
    ['changed corrected text', (value: ReturnType<typeof cleanResult>) => { value.fullTextRevision.correctedText = 'We walk together after school.' }],
    ['changed improved text', (value: ReturnType<typeof cleanResult>) => { value.fullTextRevision.improvedText = 'We walk together after school.' }],
    ['score narrative trace', (value: ReturnType<typeof cleanResult>) => { value.dimensionScores[0]!.reason = 'The word work may be walk.' }],
    ['score evidence trace', (value: ReturnType<typeof cleanResult>) => { value.dimensionScores[0]!.evidence = 'work' }],
    ['overall narrative trace', (value: ReturnType<typeof cleanResult>) => { value.overallComment = 'Please review work.' }],
    ['alternate-reading narrative trace', (value: ReturnType<typeof cleanResult>) => { value.overallComment = 'Please review whether the student wrote walk.' }],
    ['generic ambiguity in score reason', (value: ReturnType<typeof cleanResult>) => { value.dimensionScores[0]!.reason = 'The handwriting remains ambiguous.' }],
    ['generic uncertainty in score evidence', (value: ReturnType<typeof cleanResult>) => { value.dimensionScores[0]!.evidence = 'The letters remain uncertain.' }],
    ['generic alternate-reading trace in overall comment', (value: ReturnType<typeof cleanResult>) => { value.overallComment = 'There are multiple possible readings.' }],
  ])('fails A01 on %s', (_label, mutate) => {
    const results = passingResults(); mutate(results.ambiguousWork)
    expect(evaluatePolicyChecks(results).ambiguousWork).toBe(false)
  })

  it('allows ordinary positive A01 feedback without an ambiguity narrative', () => {
    const results = passingResults()
    results.ambiguousWork.dimensionScores[0]!.reason = 'The language is accurate.'
    results.ambiguousWork.dimensionScores[1]!.evidence = 'together after school.'
    results.ambiguousWork.overallComment = 'The response is clear and focused.'
    expect(evaluatePolicyChecks(results).ambiguousWork).toBe(true)
  })

  it.each([
    ['wrong quote', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.issues[0]!.originalText = 'protect' }],
    ['wrong suggestion', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.issues[0]!.suggestion = 'environmental' }],
    ['uncertain evidence', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.issues[0]!.evidenceCertainty = 'uncertain' }],
    ['non-low priority', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.issues[0]!.severity = 'medium' }],
    ['teacher review requirement', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.issues[0]!.requiresTeacherReview = true }],
    ['extra finding', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.issues.push({ ...value.issues[0]!, type: 'grammar' }) }],
    ['logic finding', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.fullTextRevision.logicIssues.push({ originalText: transcriptA02 }) }],
    ['logic note', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.fullTextRevision.logicNotes.push('Unrelated logic concern.') }],
    ['unrelated dimension deduction', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.dimensionScores[1]!.score = 3.5 }],
    ['legibility uncertainty', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.legibilityIssues.push({ transcriptText: 'enviroment', possibleReadings: ['enviroment', 'environment'], pageNumber: 1, defaultOutcome: 'count_as_legibility_error' }) }],
    ['recognition uncertainty', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.recognitionWarnings.push('Uncertain.') }],
    ['review reason', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.reviewReasons.push('recognition_uncertain') }],
    ['unrelated sentence revision', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.sentenceRevisions.push({ id: 'a02-unrelated-revision', relatedIssueIds: ['a02-spelling'], originalText: 'protect', revisedText: 'preserve', note: 'Change the verb.', changeTypes: ['word_choice'] }) }],
    ['unrelated sentence pair', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.fullTextRevision.sentencePairs.push({ id: 'a02-unrelated-pair', originalText: 'protect', correctedText: 'preserve', improvedText: 'preserve', relatedIssueIds: ['a02-spelling'], changeTypes: ['word_choice'], explanation: 'Change the verb.', requiresTeacherReview: false }) }],
    ['expression upgrade', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.expressionUpgrades.push({ id: 'a02-upgrade', originalText: 'protect', upgradedText: 'safeguard', note: 'Use a stronger verb.' }) }],
    ['unrelated corrected aggregate edit', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.fullTextRevision.correctedText = 'We must protect the environment.' }],
    ['unrelated improved aggregate edit', (value: ReturnType<typeof passingResults>['clearEnviroment']) => { value.fullTextRevision.improvedText = 'We should safeguard the environment.' }],
  ])('fails A02 on %s', (_label, mutate) => {
    const results = passingResults(); mutate(results.clearEnviroment)
    expect(evaluatePolicyChecks(results).clearEnviroment).toBe(false)
  })

  it('allows A02 auxiliary output only when it exclusively applies enviroment to environment', () => {
    const results = passingResults()
    results.clearEnviroment.sentenceRevisions = [{ id: 'a02-revision', relatedIssueIds: ['a02-spelling'], originalText: 'enviroment', revisedText: 'environment', note: 'Correct the spelling.', changeTypes: ['spelling'] }]
    results.clearEnviroment.fullTextRevision.sentencePairs = [{ id: 'a02-pair', originalText: 'enviroment', correctedText: 'environment', improvedText: 'environment', relatedIssueIds: ['a02-spelling'], changeTypes: ['spelling'], explanation: 'Correct the spelling.', requiresTeacherReview: false }]
    results.clearEnviroment.fullTextRevision.correctedText = 'We should protect the environment.'
    results.clearEnviroment.fullTextRevision.improvedText = 'We should protect the environment.'
    expect(evaluatePolicyChecks(results).clearEnviroment).toBe(true)
  })

  it.each([
    ['partial status', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.status = 'partial' as 'success' }],
    ['missing legibility issue', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.legibilityIssues = [] }],
    ['wrong readings', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.legibilityIssues[0]!.possibleReadings = ['can', 'came'] }],
    ['wrong outcome', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { (value.legibilityIssues[0] as { defaultOutcome: string }).defaultOutcome = 'ignore' }],
    ['wrong page', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.legibilityIssues[0]!.pageNumber = 2 }],
    ['multiple legibility issues', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.legibilityIssues.push({ ...value.legibilityIssues[0]! }) }],
    ['no legibility deduction', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.dimensionScores[2]!.score = 0.5 }],
    ['wrong legibility relation', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.dimensionScores[2]!.evidence = 'meeting' }],
    ['non-legibility deduction', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.dimensionScores[0]!.score = 5 }],
    ['recognition warning', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.recognitionWarnings.push('Global uncertainty.') }],
    ['review reason', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.reviewReasons.push('recognition_uncertain') }],
    ['language issue', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.issues.push({ ...languageIssue('grammar'), originalText: "can't" }) }],
    ['logic issue', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.fullTextRevision.logicIssues.push({ originalText: "can't" }) }],
    ['logic note', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.fullTextRevision.logicNotes.push('Possible logic concern.') }],
    ['revision', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.sentenceRevisions.push({ originalText: "can't" }) }],
    ['sentence pair', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.fullTextRevision.sentencePairs.push({ originalText: "can't" }) }],
    ['expression upgrade', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.expressionUpgrades.push({ originalText: "can't" }) }],
    ['changed corrected text', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.fullTextRevision.correctedText = 'I can come to the meeting.' }],
    ['changed improved text', (value: ReturnType<typeof passingResults>['ambiguousCant']) => { value.fullTextRevision.improvedText = 'I can come to the meeting.' }],
  ])('fails A03 on %s', (_label, mutate) => {
    const results = passingResults(); mutate(results.ambiguousCant)
    expect(evaluatePolicyChecks(results).ambiguousCant).toBe(false)
  })

  it.each([
    ['partial status', (value: ReturnType<typeof passingResults>['grammarAndLogic']) => { value.status = 'partial' as 'success' }],
    ['arbitrary grammar object', (value: ReturnType<typeof passingResults>['grammarAndLogic']) => { value.issues[0]!.originalText = 'We can meet after class.' }],
    ['uncertain grammar evidence', (value: ReturnType<typeof passingResults>['grammarAndLogic']) => { value.issues[0]!.evidenceCertainty = 'uncertain' }],
    ['wrong grammar correction', (value: ReturnType<typeof passingResults>['grammarAndLogic']) => { value.issues[0]!.suggestion = 'I suggest you joins.' }],
    ['unrelated correction containing join', (value: ReturnType<typeof passingResults>['grammarAndLogic']) => { value.issues[0]!.suggestion = 'Do not join the club.' }],
    ['arbitrary logic object', (value: ReturnType<typeof passingResults>['grammarAndLogic']) => { value.fullTextRevision.logicIssues[0]!.originalText = 'We can meet after class.' }],
  ])('fails A04 on %s', (_label, mutate) => {
    const results = passingResults(); mutate(results.grammarAndLogic)
    expect(evaluatePolicyChecks(results).grammarAndLogic).toBe(false)
  })
})

describe('policy golden evaluation runner', () => {
  it('sanitizes malicious metadata into one-line allowlisted tokens', () => {
    const line = formatGoldenEvaluationLine({ caseId: 'CASE-A01\nC:\\secret', status: 'fail', model: `k3\n${'x'.repeat(100)}`, policyVersion: 'grading-policy-v1\tbad', failureCategory: 'unknown-category' } satisfies GoldenEvaluationResult)
    expect(line).toBe('CASE-INVALID fail model=unknown_model policy=unknown_policy category=unexpected_failure')
    expect(line).toMatch(/^[^\r\n]+$/)
  })

  it('does not run the network evaluator when imported by an offline test', () => {
    expect(isDirectGoldenEvaluationExecution('/workspace/scripts/runPolicyGoldenEval.test.ts', '/workspace/scripts/runPolicyGoldenEval.ts')).toBe(false)
    expect(isDirectGoldenEvaluationExecution('/workspace/scripts/runPolicyGoldenEval.ts', '/workspace/scripts/runPolicyGoldenEval.ts')).toBe(true)
  })

  it('returns exit 2 and four not-run lines without parsing configuration or creating a Provider', async () => {
    const lines: string[] = []; let parseCalls = 0; let providerCalls = 0
    const exitCode = await runPolicyGoldenEvaluation({
      env: { KIMI_API_KEY: ' ', KIMI_REASONING_EFFORT: 'invalid' },
      parseConfig: () => { parseCalls++; throw new Error('private config') },
      createProvider: () => { providerCalls++; throw new Error('must not create provider') },
      output: (line) => lines.push(line),
    })
    expect(exitCode).toBe(2); expect(parseCalls).toBe(0); expect(providerCalls).toBe(0)
    expect(lines).toEqual(notRunLines())
  })

  it('keeps successful cases on their own predicates when one Provider call fails', async () => {
    const lines: string[] = []; const results = passingResults(); let calls = 0
    const values = [results.ambiguousWork, new Error('private provider failure'), results.ambiguousCant, results.grammarAndLogic]
    const exitCode = await runPolicyGoldenEvaluation({
      env: { KIMI_API_KEY: 'local-only' },
      parseConfig: () => ({ apiBase: 'https://example.test', model: 'k3', reasoningEffort: 'low', maxCompletionTokens: 1 }),
      readFixture: async () => Buffer.from('synthetic'),
      createProvider: () => ({ async gradeEssay() { const value = values[calls++]; if (value instanceof Error) throw value; return value } }),
      normalize: (value) => ({ ok: true, result: value as never }),
      output: (line) => lines.push(line),
    })
    expect(exitCode).toBe(1); expect(calls).toBe(4)
    expect(lines).toEqual([
      'CASE-A01 pass model=k3 policy=grading-policy-v1',
      'CASE-A02 fail model=k3 policy=grading-policy-v1 category=unexpected_failure',
      'CASE-A03 pass model=k3 policy=grading-policy-v1',
      'CASE-A04 pass model=k3 policy=grading-policy-v1',
    ])
  })

  it('returns exit 0 and four pass lines when every normalized case satisfies its own predicate', async () => {
    const lines: string[] = []; const results = passingResults(); let calls = 0
    const values = [results.ambiguousWork, results.clearEnviroment, results.ambiguousCant, results.grammarAndLogic]
    const exitCode = await runPolicyGoldenEvaluation({
      env: { KIMI_API_KEY: 'local-only' },
      parseConfig: () => ({ apiBase: 'https://example.test', model: 'k3', reasoningEffort: 'low', maxCompletionTokens: 1 }),
      readFixture: async () => Buffer.from('synthetic'),
      createProvider: () => ({ async gradeEssay() { return values[calls++] } }),
      normalize: (value) => ({ ok: true, result: value as never }),
      output: (line) => lines.push(line),
    })
    expect(exitCode).toBe(0)
    expect(lines).toEqual([
      'CASE-A01 pass model=k3 policy=grading-policy-v1',
      'CASE-A02 pass model=k3 policy=grading-policy-v1',
      'CASE-A03 pass model=k3 policy=grading-policy-v1',
      'CASE-A04 pass model=k3 policy=grading-policy-v1',
    ])
  })

  it('sends the product-default 5% legibility rubric while keeping total weight at 100', async () => {
    const observedWeights: number[][] = []
    await runPolicyGoldenEvaluation({
      env: { KIMI_API_KEY: 'local-only' },
      parseConfig: () => ({ apiBase: 'https://example.test', model: 'k3', reasoningEffort: 'low', maxCompletionTokens: 1 }),
      readFixture: async () => Buffer.from('synthetic'),
      createProvider: () => ({ async gradeEssay(input) { observedWeights.push(input.task.rubric.dimensions.map(({ weight }) => weight)); throw new Error('stop after boundary') } }),
      output: () => undefined,
    })
    expect(observedWeights).toEqual([[55, 40, 5], [55, 40, 5], [55, 40, 5], [55, 40, 5]])
  })
})

const notRunLines = () => [
  'CASE-A01 not_run model=unconfigured policy=grading-policy-v1 category=not_run_missing_local_credentials',
  'CASE-A02 not_run model=unconfigured policy=grading-policy-v1 category=not_run_missing_local_credentials',
  'CASE-A03 not_run model=unconfigured policy=grading-policy-v1 category=not_run_missing_local_credentials',
  'CASE-A04 not_run model=unconfigured policy=grading-policy-v1 category=not_run_missing_local_credentials',
]

interface CliResult { code: number | null; stdout: string; stderr: string }
async function runCli(env: NodeJS.ProcessEnv, cwd: string): Promise<CliResult> {
  const here = dirname(fileURLToPath(import.meta.url)); const cli = resolve(here, '../node_modules/tsx/dist/cli.mjs'); const script = resolve(here, 'runPolicyGoldenEval.ts')
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk }); child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject); child.once('close', (code) => resolveResult({ code, stdout, stderr }))
  })
}

describe('policy golden evaluation CLI subprocess', () => {
  it('captures four sanitized not-run lines, empty stderr, exit 2, and zero HTTP calls without credentials', async () => {
    let requests = 0; const server = createServer((_request, response) => { requests++; response.writeHead(503).end() })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
    const cwd = await mkdtemp(resolve(tmpdir(), 'golden-cli-missing-')); const env: NodeJS.ProcessEnv = { ...process.env, KIMI_API_BASE: `http://127.0.0.1:${address.port}` }; delete env.KIMI_API_KEY
    try {
      const result = await runCli(env, cwd)
      expect(result.code).toBe(2); expect(result.stderr).toBe(''); expect(result.stdout.trim().split(/\r?\n/)).toEqual(notRunLines()); expect(requests).toBe(0)
    } finally { server.close(); await rm(cwd, { recursive: true, force: true }) }
  })

  it('captures exit 1 and four allowlisted failure lines without the upstream private marker', async () => {
    const privateMarker = 'DO-NOT-PRINT-UPSTREAM-MARKER'; let requests = 0
    const server = createServer((_request, response) => { requests++; response.writeHead(503, { 'Content-Type': 'text/plain' }).end(privateMarker) })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
    const cwd = await mkdtemp(resolve(tmpdir(), 'golden-cli-failure-'))
    try {
      const result = await runCli({ ...process.env, KIMI_API_KEY: 'local-test-only', KIMI_API_BASE: `http://127.0.0.1:${address.port}`, KIMI_MODEL: 'k3' }, cwd)
      expect(result.code).toBe(1); expect(result.stderr).toBe(''); expect(requests).toBe(4); expect(result.stdout).not.toContain(privateMarker)
      expect(result.stdout.trim().split(/\r?\n/)).toEqual([
        'CASE-A01 fail model=k3 policy=grading-policy-v1 category=provider_unavailable',
        'CASE-A02 fail model=k3 policy=grading-policy-v1 category=provider_unavailable',
        'CASE-A03 fail model=k3 policy=grading-policy-v1 category=provider_unavailable',
        'CASE-A04 fail model=k3 policy=grading-policy-v1 category=provider_unavailable',
      ])
    } finally { server.close(); await rm(cwd, { recursive: true, force: true }) }
  })
})
