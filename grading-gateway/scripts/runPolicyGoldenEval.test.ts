import { describe, expect, it } from 'vitest'
import {
  evaluatePolicyChecks,
  formatGoldenEvaluationLine,
  isDirectGoldenEvaluationExecution,
  runPolicyGoldenEvaluation,
  type GoldenEvaluationResult,
} from './runPolicyGoldenEval.js'

const publicResult = {
  issues: [],
  legibilityIssues: [],
  reviewReasons: [],
  fullTextRevision: { logicIssues: [] },
}

function passingResults() {
  return {
    ambiguousWork: publicResult,
    clearEnviroment: { ...publicResult, issues: [{ type: 'spelling', evidenceCertainty: 'certain' }] },
    ambiguousCant: { ...publicResult, legibilityIssues: [{ defaultOutcome: 'count_as_legibility_error' }] },
    grammarAndLogic: {
      ...publicResult,
      issues: [{ type: 'grammar', evidenceCertainty: 'certain' }],
      fullTextRevision: { logicIssues: [{}] },
    },
  }
}

describe('policy golden evaluation helpers', () => {
  it('accepts all four public-result assertions', () => {
    expect(evaluatePolicyChecks(passingResults())).toEqual({
      ambiguousWork: true,
      clearEnviroment: true,
      ambiguousCant: true,
      grammarAndLogic: true,
    })
  })

  it.each([
    ['reports spelling', { ...publicResult, issues: [{ type: 'spelling', evidenceCertainty: 'certain' }] }],
    ['reports legibility', { ...publicResult, legibilityIssues: [{ defaultOutcome: 'count_as_legibility_error' }] }],
    ['reports recognition uncertainty', { ...publicResult, reviewReasons: ['recognition_uncertain'] }],
  ])('fails ambiguous-work when it %s', (_label, ambiguousWork) => {
    expect(evaluatePolicyChecks({ ...passingResults(), ambiguousWork })).toMatchObject({ ambiguousWork: false })
  })

  it('fails clear-enviroment without a certain spelling issue', () => {
    expect(evaluatePolicyChecks({ ...passingResults(), clearEnviroment: publicResult })).toMatchObject({ clearEnviroment: false })
  })

  it('fails ambiguous-cant without the required legibility outcome', () => {
    expect(evaluatePolicyChecks({ ...passingResults(), ambiguousCant: publicResult })).toMatchObject({ ambiguousCant: false })
  })

  it.each([
    ['grammar issue', { ...publicResult, fullTextRevision: { logicIssues: [{}] } }],
    ['logic issue', { ...publicResult, issues: [{ type: 'grammar', evidenceCertainty: 'certain' }] }],
  ])('fails grammar-and-logic without a %s', (_label, grammarAndLogic) => {
    expect(evaluatePolicyChecks({ ...passingResults(), grammarAndLogic })).toMatchObject({ grammarAndLogic: false })
  })

  it('sanitizes malicious metadata into one-line allowlisted tokens', () => {
    const line = formatGoldenEvaluationLine({
      caseId: 'CASE-A01\nC:\\secret',
      passed: false,
      model: `k3\n${'x'.repeat(100)}`,
      policyVersion: 'grading-policy-v1\tbad',
      failureCategory: 'unknown-category',
    } satisfies GoldenEvaluationResult)

    expect(line).toBe('CASE-INVALID fail model=unknown_model policy=unknown_policy category=unexpected_failure')
    expect(line).toMatch(/^[^\r\n]+$/)
  })

  it('does not run the network evaluator when imported by an offline test', () => {
    expect(isDirectGoldenEvaluationExecution('/workspace/scripts/runPolicyGoldenEval.test.ts', '/workspace/scripts/runPolicyGoldenEval.ts')).toBe(false)
    expect(isDirectGoldenEvaluationExecution('/workspace/scripts/runPolicyGoldenEval.ts', '/workspace/scripts/runPolicyGoldenEval.ts')).toBe(true)
  })

  it('emits four missing-credential lines without parsing invalid configuration or requesting a Provider', async () => {
    const lines: string[] = []
    let parseCalls = 0
    let providerCalls = 0
    await runPolicyGoldenEvaluation({
      env: { KIMI_API_KEY: ' ', KIMI_REASONING_EFFORT: 'invalid' },
      parseConfig: () => { parseCalls++; throw new Error('C:\\private\\config') },
      createProvider: () => { providerCalls++; throw new Error('must not create provider') },
      output: (line) => lines.push(line),
    })

    expect(parseCalls).toBe(0)
    expect(providerCalls).toBe(0)
    expect(lines).toHaveLength(4)
    expect(lines.every((line) => line.includes('category=not_run_missing_local_credentials') && !/[\r\n]/.test(line))).toBe(true)
  })

  it('converts parse failures to four anonymous unexpected-failure lines', async () => {
    const lines: string[] = []
    await runPolicyGoldenEvaluation({
      env: { KIMI_API_KEY: 'local-only' },
      parseConfig: () => { throw new Error('C:\\private\\config\nsecret') },
      output: (line) => lines.push(line),
    })

    expect(lines).toHaveLength(4)
    expect(lines.every((line) => line.endsWith('category=unexpected_failure') && !/private|secret|[\r\n]/i.test(line))).toBe(true)
  })

  it('makes one failing Provider call per case with no retry and no leaked exception text', async () => {
    const lines: string[] = []
    let gradeCalls = 0
    await runPolicyGoldenEvaluation({
      env: { KIMI_API_KEY: 'local-only' },
      parseConfig: () => ({ apiBase: 'https://example.test', model: 'k3', reasoningEffort: 'low', maxCompletionTokens: 1 }),
      readFixture: async () => Buffer.from('synthetic'),
      createProvider: () => ({
        async gradeEssay() {
          gradeCalls++
          throw new Error('C:\\private\\provider-response.json\nraw response')
        },
      }),
      output: (line) => lines.push(line),
    })

    expect(gradeCalls).toBe(4)
    expect(lines).toHaveLength(4)
    expect(lines.every((line) => line.endsWith('category=unexpected_failure') && !/private|raw|response|[\r\n]/i.test(line))).toBe(true)
  })
})
