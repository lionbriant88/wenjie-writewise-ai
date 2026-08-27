import { describe, expect, it } from 'vitest'
import { validateTaskMaterialContext } from './materialContextContract.js'
import { validateConfirmedRubric, validateGeneratedRubric } from './validateRubric.js'

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

function rubricWithLegibilityAndContentWeights(legibilityWeight: number, contentWeight: number): Record<string, unknown> {
  const rubric = rubricWithSingleWeight(contentWeight)
  ;(rubric.dimensions as Array<Record<string, unknown>>).push({
    id: 'legibility',
    name: 'Legibility',
    weight: legibilityWeight,
    description: 'Handles important handwriting ambiguity.',
    deductionFocus: ['Important handwriting ambiguity.'],
    sourceEvidence: ['Student handwriting.'],
  })
  return rubric
}

function validRubricWithLegibility({ weight }: { weight: number }): Record<string, unknown> {
  return rubricWithLegibilityAndContentWeights(weight, 100 - weight)
}

function validRubricWithoutLegibility(): Record<string, unknown> {
  return rubricWithSingleWeight(100)
}

function validRubricWithTwoLegibilityDimensions(): Record<string, unknown> {
  const rubric = validRubricWithLegibility({ weight: 5 })
  ;(rubric.dimensions as Array<Record<string, unknown>>).push({
    id: 'legibility',
    name: 'Second Legibility',
    weight: 5,
    description: 'Duplicate legibility coverage.',
    deductionFocus: ['Important handwriting ambiguity.'],
    sourceEvidence: ['Student handwriting.'],
  })
  ;(rubric.dimensions as Array<Record<string, unknown>>)[0].weight = 90
  return rubric
}

describe('validateGeneratedRubric', () => {
  it('requires generated legibility weight 5 but permits a teacher-edited positive decimal weight', () => {
    const teacherEdited = validRubricWithLegibility({ weight: 8.5 })
    ;(teacherEdited.dimensions as Array<Record<string, unknown>>)[0].weight = 91.5

    expect(validateGeneratedRubric(teacherEdited).ok).toBe(false)
    expect(validateConfirmedRubric(teacherEdited).ok).toBe(true)
    expect(validateGeneratedRubric(validRubricWithLegibility({ weight: 5 })).ok).toBe(true)
    expect(validateGeneratedRubric(validRubricWithoutLegibility()).ok).toBe(false)
    expect(validateGeneratedRubric(validRubricWithTwoLegibilityDimensions()).ok).toBe(false)
  })

  it('rejects generated and confirmed rubrics without a writing requirement', () => {
    const rubric = validRubricWithLegibility({ weight: 5 })
    rubric.writingRequirements = []
    expect(validateGeneratedRubric(rubric).ok).toBe(false)
    expect(validateConfirmedRubric(rubric).ok).toBe(false)
  })

  it('accepts unique rubric dimensions whose percentage weights total 100', () => {
    const result = validateGeneratedRubric({
      taskName: 'A school writing task',
      materialSummary: 'Students respond to the supplied situation.',
      writingRequirements: ['Address every required point.'],
      constraints: ['Write in English.'],
      dimensions: [
        { id: 'content', name: '鍐呭', weight: 40, description: '瑕嗙洊瑕佺偣', deductionFocus: ['閬楁紡瑕佺偣'], sourceEvidence: ['鏉愭枡瑕佹眰鍥炲簲鍏ㄩ儴瑕佺偣'] },
        { id: 'language', name: '璇█', weight: 55, description: '鍑嗙‘寰椾綋', deductionFocus: ['褰卞搷鐞嗚В鐨勯敊璇?'], sourceEvidence: ['鏉愭枡瑕佹眰浣跨敤鑻辫'] },
        { id: 'legibility', name: 'Legibility', weight: 5, description: 'Handles handwriting ambiguity.', deductionFocus: ['Important handwriting ambiguity.'], sourceEvidence: ['Student handwriting.'] },
      ],
      reviewWarnings: [],
    })
    expect(result.ok).toBe(true)
  })

  it.each([99, 101])('rejects a rubric whose weights total %s', (totalWeight) => {
    expect(validateGeneratedRubric(rubricWithLegibilityAndContentWeights(5, totalWeight - 5))).toEqual({
      ok: false,
      error: { code: 'provider_invalid_response', message: '璇勫垎鏍囧噯鏉冮噸蹇呴』鍚堣 100%銆?' },
    })
  })

  it('accepts percentage weights at the 0.001 tolerance boundary', () => {
    const rubric = rubricWithLegibilityAndContentWeights(5, 40)
    ;(rubric.dimensions as Array<Record<string, unknown>>).push({
      ...(rubric.dimensions as Array<Record<string, unknown>>)[0],
      id: 'language',
      weight: 55.001,
    })

    expect(validateGeneratedRubric(rubric).ok).toBe(true)
  })

  it('rejects percentage weights clearly outside the 0.001 tolerance', () => {
    const rubric = rubricWithLegibilityAndContentWeights(5, 40)
    ;(rubric.dimensions as Array<Record<string, unknown>>).push({
      ...(rubric.dimensions as Array<Record<string, unknown>>)[0],
      id: 'language',
      weight: 55.002,
    })

    expect(validateGeneratedRubric(rubric).ok).toBe(false)
  })

  it('trims accepted strings without retaining unknown fields', () => {
    const rubric = rubricWithLegibilityAndContentWeights(5, 95)
    rubric.taskName = '  A school writing task  '
    ;(rubric.dimensions as Array<Record<string, unknown>>)[0].name = '  Content  '
    rubric.untrustedSource = 'private material'

    expect(validateGeneratedRubric(rubric).ok).toBe(false)
    delete rubric.untrustedSource
    const validated = validateGeneratedRubric(rubric)
    expect(validated).toMatchObject({ ok: true, value: { taskName: 'A school writing task' } })
    if (validated.ok) expect(validated.value.dimensions).toContainEqual(expect.objectContaining({ name: 'Content' }))
  })

  it('uses the strict task material context contract for all four context fields', () => {
    const rubric = validRubricWithLegibility({ weight: 5 })
    rubric.materialSummary = '  Summary from material.  '
    rubric.writingRequirements = ['  Teacher requirement.  ']
    rubric.constraints = ['  Use English.  ']
    rubric.reviewWarnings = ['  Verify an unclear detail.  ']
    const context = {
      materialSummary: rubric.materialSummary,
      writingRequirements: rubric.writingRequirements,
      constraints: rubric.constraints,
      reviewWarnings: rubric.reviewWarnings,
    }

    const contextResult = validateTaskMaterialContext(context)
    const rubricResult = validateGeneratedRubric(rubric)

    expect(contextResult.ok).toBe(true)
    expect(rubricResult.ok).toBe(true)
    if (contextResult.ok && rubricResult.ok) {
      expect({
        materialSummary: rubricResult.value.materialSummary,
        writingRequirements: rubricResult.value.writingRequirements,
        constraints: rubricResult.value.constraints,
        reviewWarnings: rubricResult.value.reviewWarnings,
      }).toEqual(contextResult.value)
    }
  })

  it.each([
    ['empty writing requirements', { writingRequirements: [] }],
    ['too many constraints', { constraints: Array.from({ length: 51 }, () => 'Constraint') }],
    ['blank review warning', { reviewWarnings: ['   '] }],
    ['oversized material summary', { materialSummary: 's'.repeat(20_001) }],
  ] as const)('rejects the same invalid context boundary as the shared validator: %s', (_label, overrides) => {
    const rubric = validRubricWithLegibility({ weight: 5 })
    Object.assign(rubric, overrides)
    const context = {
      materialSummary: rubric.materialSummary,
      writingRequirements: rubric.writingRequirements,
      constraints: rubric.constraints,
      reviewWarnings: rubric.reviewWarnings,
    }

    expect(validateTaskMaterialContext(context).ok).toBe(false)
    expect(validateGeneratedRubric(rubric).ok).toBe(false)
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
    const rubric = rubricWithLegibilityAndContentWeights(5, 95)
    mutate(rubric)
    expect(validateGeneratedRubric(rubric).ok).toBe(false)
  })
})
