import { describe, expect, it } from 'vitest'
import { validateGeneratedRubric } from './validateRubric.js'

function rubricWithSingleWeight(weight: number): Record<string, unknown> {
  return {
    taskName: 'A school writing task',
    materialSummary: 'Students respond to the supplied situation.',
    writingRequirements: ['Address every required point.'],
    constraints: ['Write in English.'],
    dimensions: [
      {
        id: 'content',
        name: 'Content',
        weight,
        description: 'Covers required points.',
        deductionFocus: ['Missing a required point.'],
        sourceEvidence: ['The material requires a response to every point.'],
      },
    ],
    reviewWarnings: [],
  }
}

describe('validateGeneratedRubric', () => {
  it('accepts unique rubric dimensions whose percentage weights total 100', () => {
    const result = validateGeneratedRubric({
      taskName: 'A school writing task',
      materialSummary: 'Students respond to the supplied situation.',
      writingRequirements: ['Address every required point.'],
      constraints: ['Write in English.'],
      dimensions: [
        { id: 'content', name: '鍐呭', weight: 40, description: '瑕嗙洊瑕佺偣', deductionFocus: ['閬楁紡瑕佺偣'], sourceEvidence: ['鏉愭枡瑕佹眰鍥炲簲鍏ㄩ儴瑕佺偣'] },
        { id: 'language', name: '璇█', weight: 60, description: '鍑嗙‘寰椾綋', deductionFocus: ['褰卞搷鐞嗚В鐨勯敊璇?'], sourceEvidence: ['鏉愭枡瑕佹眰浣跨敤鑻辫'] },
      ],
      reviewWarnings: [],
    })
    expect(result.ok).toBe(true)
  })

  it.each([99, 101])('rejects a rubric whose weights total %s', (weight) => {
    expect(validateGeneratedRubric(rubricWithSingleWeight(weight))).toEqual({
      ok: false,
      error: { code: 'provider_invalid_response', message: '璇勫垎鏍囧噯鏉冮噸蹇呴』鍚堣 100%銆?' },
    })
  })

  it('accepts percentage weights at the 0.001 tolerance boundary', () => {
    const rubric = rubricWithSingleWeight(40)
    ;(rubric.dimensions as Array<Record<string, unknown>>).push({
      ...(rubric.dimensions as Array<Record<string, unknown>>)[0],
      id: 'language',
      weight: 60.001,
    })

    expect(validateGeneratedRubric(rubric).ok).toBe(true)
  })

  it('rejects percentage weights clearly outside the 0.001 tolerance', () => {
    const rubric = rubricWithSingleWeight(40)
    ;(rubric.dimensions as Array<Record<string, unknown>>).push({
      ...(rubric.dimensions as Array<Record<string, unknown>>)[0],
      id: 'language',
      weight: 60.002,
    })

    expect(validateGeneratedRubric(rubric).ok).toBe(false)
  })

  it('trims accepted strings without retaining unknown fields', () => {
    const rubric = rubricWithSingleWeight(100)
    rubric.taskName = '  A school writing task  '
    ;(rubric.dimensions as Array<Record<string, unknown>>)[0].name = '  Content  '
    rubric.untrustedSource = 'private material'

    expect(validateGeneratedRubric(rubric).ok).toBe(false)
    delete rubric.untrustedSource
    expect(validateGeneratedRubric(rubric)).toMatchObject({
      ok: true,
      value: { taskName: 'A school writing task', dimensions: [{ name: 'Content' }] },
    })
  })

  it.each([
    ['missing required field', (rubric: Record<string, unknown>) => { delete rubric.materialSummary }],
    ['duplicate dimension id', (rubric: Record<string, unknown>) => {
      ;(rubric.dimensions as Array<Record<string, unknown>>).push({
        ...(rubric.dimensions as Array<Record<string, unknown>>)[0],
        weight: 1,
      })
      ;(rubric.dimensions as Array<Record<string, unknown>>)[0].weight = 99
    }],
    ['non-finite weight', (rubric: Record<string, unknown>) => {
      ;(rubric.dimensions as Array<Record<string, unknown>>)[0].weight = Infinity
    }],
    ['non-positive weight', (rubric: Record<string, unknown>) => {
      ;(rubric.dimensions as Array<Record<string, unknown>>)[0].weight = 0
    }],
    ['more than ten dimensions', (rubric: Record<string, unknown>) => {
      const dimensions = rubric.dimensions as Array<Record<string, unknown>>
      dimensions[0].weight = 10
      for (let index = 1; index <= 10; index += 1) {
        dimensions.push({ ...dimensions[0], id: `dimension-${index}` })
      }
    }],
  ] as const)('rejects a rubric with %s', (_label, mutate) => {
    const rubric = rubricWithSingleWeight(100)
    mutate(rubric)
    expect(validateGeneratedRubric(rubric).ok).toBe(false)
  })
})
