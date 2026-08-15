import { describe, expect, it } from 'vitest'
import {
  evaluatePolicyChecks,
  formatGoldenEvaluationLine,
  isDirectGoldenEvaluationExecution,
  type GoldenEvaluationResult,
} from './runPolicyGoldenEval.js'

const publicResult = {
  issues: [],
  legibilityIssues: [],
  reviewReasons: [],
  fullTextRevision: { logicIssues: [] },
}

describe('policy golden evaluation helpers', () => {
  it('applies every public-result policy assertion without retaining provider payloads', () => {
    expect(evaluatePolicyChecks({
      ambiguousWork: publicResult,
      clearEnviroment: { ...publicResult, issues: [{ type: 'spelling', evidenceCertainty: 'certain' }] },
      ambiguousCant: {
        ...publicResult,
        legibilityIssues: [{ defaultOutcome: 'count_as_legibility_error' }],
      },
      grammarAndLogic: {
        ...publicResult,
        issues: [{ type: 'grammar', evidenceCertainty: 'certain' }],
        fullTextRevision: { logicIssues: [{}] },
      },
    })).toEqual({
      ambiguousWork: true,
      clearEnviroment: true,
      ambiguousCant: true,
      grammarAndLogic: true,
    })
  })

  it('formats only anonymous metadata and a short failure category', () => {
    const line = formatGoldenEvaluationLine({
      caseId: 'CASE-A01',
      passed: false,
      model: 'k3',
      policyVersion: 'grading-policy-v1',
      failureCategory: 'assertion_failed',
    } satisfies GoldenEvaluationResult)

    expect(line).toBe('CASE-A01 fail model=k3 policy=grading-policy-v1 category=assertion_failed')
    expect(line).not.toMatch(/transcript|comment|data:|raw|secret/i)
  })

  it('does not run the network evaluator when imported by an offline test', () => {
    expect(isDirectGoldenEvaluationExecution('/workspace/scripts/runPolicyGoldenEval.test.ts', '/workspace/scripts/runPolicyGoldenEval.ts')).toBe(false)
    expect(isDirectGoldenEvaluationExecution('/workspace/scripts/runPolicyGoldenEval.ts', '/workspace/scripts/runPolicyGoldenEval.ts')).toBe(true)
  })
})
