import { describe, expect, it } from 'vitest'
import type { RubricDimension } from '../../types'
import {
  createDefaultRubricDimensions,
  createOrdinaryRubricDimension,
  LEGIBILITY_DIMENSION_ID,
  validateRubricForm,
} from './rubricForm'

const writingRequirement = 'Write an email to invite your friend.'

function validDimensions(): RubricDimension[] {
  return createDefaultRubricDimensions()
}

function validate(dimensions = validDimensions(), overrides: Partial<{ fullScore: number; writingRequirement: string }> = {}) {
  return validateRubricForm({ fullScore: 15, writingRequirement, dimensions, ...overrides })
}

describe('task rubric form', () => {
  it('creates the approved independent default dimensions', () => {
    const first = createDefaultRubricDimensions()
    const second = createDefaultRubricDimensions()

    expect(first).toEqual([
      { id: 'content', name: '内容与任务完成', weight: 40, description: '是否完整回应写作任务，内容是否切题、充分且有依据', deductionFocus: [], sourceEvidence: [] },
      { id: 'language', name: '语言质量', weight: 40, description: '语法、词汇、句式和表达是否准确、恰当且有变化', deductionFocus: [], sourceEvidence: [] },
      { id: 'structure', name: '结构与连贯', weight: 15, description: '文章组织、段落衔接和逻辑推进是否清楚自然', deductionFocus: [], sourceEvidence: [] },
      { id: 'legibility', name: '卷面与可读性', weight: 5, description: '书写是否清楚，是否存在会改变语义或影响评分的重要字迹问题', deductionFocus: [], sourceEvidence: [] },
    ])
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    expect(first[0]?.deductionFocus).not.toBe(second[0]?.deductionFocus)
  })

  it('creates an editable ordinary dimension without hidden scoring data', () => {
    expect(createOrdinaryRubricDimension('custom')).toEqual({
      id: 'custom', name: '', description: '', weight: 1, deductionFocus: [], sourceEvidence: [],
    })
  })

  it('accepts a complete valid rubric', () => {
    expect(validate()).toMatchObject({ valid: true, totalWeight: 100, differenceFromHundred: 0 })
  })

  it.each([0, 101, 15.5])('rejects non-integer full score %s', (fullScore) => {
    expect(validate(undefined, { fullScore })).toMatchObject({ valid: false, errors: { fullScore: expect.any(String) } })
  })

  it.each(['   ', 'a'.repeat(10_001)])('rejects an invalid writing requirement', (requirement) => {
    expect(validate(undefined, { writingRequirement: requirement })).toMatchObject({ valid: false, errors: { writingRequirement: expect.any(String) } })
  })

  it('counts the 10,000-character writing-requirement boundary by Unicode code points', () => {
    const exactly10k = '\u{1F600}'.repeat(10_000)
    const over10k = `${exactly10k}\u{1F600}`

    expect(exactly10k).toHaveLength(20_000)
    expect(Array.from(exactly10k)).toHaveLength(10_000)
    expect(validate(undefined, { writingRequirement: exactly10k })).toMatchObject({ valid: true })
    expect(validate(undefined, { writingRequirement: over10k })).toMatchObject({
      valid: false,
      errors: { writingRequirement: expect.any(String) },
    })
  })

  it.each([
    ['too few dimensions', validDimensions().slice(0, 1)],
    ['too many dimensions', Array.from({ length: 11 }, (_, index) => ({ ...createOrdinaryRubricDimension(`extra-${index}`), name: 'Extra', description: 'Extra dimension', weight: 100 / 11 }))],
    ['blank dimension id', [{ ...validDimensions()[0]!, id: '   ' }, ...validDimensions().slice(1)]],
    ['overlong dimension id', [{ ...validDimensions()[0]!, id: 'a'.repeat(129) }, ...validDimensions().slice(1)]],
    ['duplicate dimension id', [{ ...validDimensions()[0]! }, { ...validDimensions()[1]!, id: 'content' }, ...validDimensions().slice(2)]],
    ['zero weight', [{ ...validDimensions()[0]!, weight: 0 }, ...validDimensions().slice(1)]],
    ['negative weight', [{ ...validDimensions()[0]!, weight: -1 }, ...validDimensions().slice(1)]],
    ['non-finite weight', [{ ...validDimensions()[0]!, weight: Number.NaN }, ...validDimensions().slice(1)]],
    ['over-100 weight', [{ ...validDimensions()[0]!, weight: 101 }, ...validDimensions().slice(1)]],
    ['blank dimension name', [{ ...validDimensions()[0]!, name: ' ' }, ...validDimensions().slice(1)]],
    ['overlong dimension name', [{ ...validDimensions()[0]!, name: 'a'.repeat(257) }, ...validDimensions().slice(1)]],
    ['blank dimension description', [{ ...validDimensions()[0]!, description: ' ' }, ...validDimensions().slice(1)]],
    ['overlong dimension description', [{ ...validDimensions()[0]!, description: 'a'.repeat(2_001) }, ...validDimensions().slice(1)]],
  ])('rejects %s with field-local errors when a dimension field is invalid', (_label, dimensions) => {
    const result = validate(dimensions)
    expect(result.valid).toBe(false)
    if (_label === 'too few dimensions' || _label === 'too many dimensions') {
      expect(result.errors.dimensions).toEqual(expect.any(String))
    } else {
      expect(result.errors.dimensionItems.some((item) => Object.keys(item).length > 0)).toBe(true)
    }
  })

  it.each([
    ['missing legibility', validDimensions().filter(({ id }) => id !== LEGIBILITY_DIMENSION_ID)],
    ['duplicate legibility', [...validDimensions(), { ...validDimensions()[3]!, id: LEGIBILITY_DIMENSION_ID, weight: 1 }]],
    ['no ordinary dimension', [{ ...validDimensions()[3]!, weight: 100 }, { ...validDimensions()[3]!, id: LEGIBILITY_DIMENSION_ID, weight: 0.0001 }]],
  ])('rejects %s', (_label, dimensions) => {
    expect(validate(dimensions)).toMatchObject({ valid: false, errors: { dimensions: expect.any(String) } })
  })

  it.each([99.998999, 100.001001])('rejects decimal totals just outside the tolerance: %s', (total) => {
    const dimensions = validDimensions()
    dimensions[0] = { ...dimensions[0]!, weight: total - 60 }
    expect(validate(dimensions)).toMatchObject({ valid: false, totalWeight: total, errors: { dimensions: expect.any(String) } })
  })

  it.each([99.999, 99.9995, 100.0005, 100.001])('accepts decimal totals at or within the tolerance: %s', (total) => {
    const dimensions = validDimensions()
    dimensions[0] = { ...dimensions[0]!, weight: total - 60 }
    expect(validate(dimensions)).toMatchObject({ valid: true, totalWeight: total })
  })
})
