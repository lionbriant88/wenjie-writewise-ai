import { describe, expect, it } from 'vitest'
import {
  prioritizeTeacherWritingRequirement,
  taskMaterialContextSchema,
  validateTaskMaterialContext,
} from './materialContextContract.js'
import type { TaskMaterialContextV1 } from './types.js'

function validContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    materialSummary: 'A school email task.',
    writingRequirements: ['Address the recipient politely.'],
    constraints: [],
    reviewWarnings: [],
    ...overrides,
  }
}

describe('validateTaskMaterialContext', () => {
  it('accepts exactly four fields and returns independently trimmed values', () => {
    const source = validContext({
      materialSummary: '  A school email task.  ',
      writingRequirements: ['  Address the recipient politely.  '],
      constraints: ['  Use English.  '],
      reviewWarnings: ['  Verify an unclear date.  '],
    })

    expect(validateTaskMaterialContext(source)).toEqual({
      ok: true,
      value: {
        materialSummary: 'A school email task.',
        writingRequirements: ['Address the recipient politely.'],
        constraints: ['Use English.'],
        reviewWarnings: ['Verify an unclear date.'],
      },
    })
    expect(source).toEqual(validContext({
      materialSummary: '  A school email task.  ',
      writingRequirements: ['  Address the recipient politely.  '],
      constraints: ['  Use English.  '],
      reviewWarnings: ['  Verify an unclear date.  '],
    }))
  })

  it.each([
    ['missing materialSummary', (value: Record<string, unknown>) => { delete value.materialSummary }],
    ['missing writingRequirements', (value: Record<string, unknown>) => { delete value.writingRequirements }],
    ['missing constraints', (value: Record<string, unknown>) => { delete value.constraints }],
    ['missing reviewWarnings', (value: Record<string, unknown>) => { delete value.reviewWarnings }],
    ['unknown key', (value: Record<string, unknown>) => { value.privateMaterial = 'PRIVATE-CONTENT' }],
  ] as const)('rejects %s with a redacted stable error', (_label, mutate) => {
    const value = validContext()
    mutate(value)
    const result = validateTaskMaterialContext(value)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'provider_invalid_response' },
    })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE-CONTENT|school email|recipient politely/i)
  })

  it.each([
    ['blank summary', { materialSummary: '   ' }],
    ['20,001-character summary', { materialSummary: 's'.repeat(20_001) }],
    ['zero writing requirements', { writingRequirements: [] }],
    ['51 writing requirements', { writingRequirements: Array.from({ length: 51 }, () => 'Requirement') }],
    ['blank writing requirement', { writingRequirements: [' '] }],
    ['5,001-character writing requirement', { writingRequirements: ['r'.repeat(5_001)] }],
    ['51 constraints', { constraints: Array.from({ length: 51 }, () => 'Constraint') }],
    ['blank constraint', { constraints: [' '] }],
    ['5,001-character constraint', { constraints: ['c'.repeat(5_001)] }],
    ['51 review warnings', { reviewWarnings: Array.from({ length: 51 }, () => 'Warning') }],
    ['blank review warning', { reviewWarnings: [' '] }],
    ['5,001-character review warning', { reviewWarnings: ['w'.repeat(5_001)] }],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(validateTaskMaterialContext(validContext(overrides))).toMatchObject({
      ok: false,
      error: { code: 'provider_invalid_response' },
    })
  })

  it('accepts every inclusive size and item-count boundary', () => {
    const result = validateTaskMaterialContext({
      materialSummary: 's'.repeat(20_000),
      writingRequirements: Array.from({ length: 50 }, () => 'r'.repeat(5_000)),
      constraints: Array.from({ length: 50 }, () => 'c'.repeat(5_000)),
      reviewWarnings: Array.from({ length: 50 }, () => 'w'.repeat(5_000)),
    })

    expect(result.ok).toBe(true)
  })

  it('exports a strict Provider schema matching the runtime boundaries', () => {
    expect(taskMaterialContextSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['materialSummary', 'writingRequirements', 'constraints', 'reviewWarnings'],
      properties: {
        materialSummary: { type: 'string', minLength: 1, maxLength: 20_000, pattern: '\\S' },
        writingRequirements: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 5_000, pattern: '\\S' },
        },
        constraints: {
          type: 'array',
          minItems: 0,
          maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 5_000, pattern: '\\S' },
        },
        reviewWarnings: {
          type: 'array',
          minItems: 0,
          maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 5_000, pattern: '\\S' },
        },
      },
    })
  })
})

describe('prioritizeTeacherWritingRequirement', () => {
  it('puts the trimmed teacher requirement first and removes exact duplicates without mutation', () => {
    const context: TaskMaterialContextV1 = {
      materialSummary: 'Summary',
      writingRequirements: [
        'Inferred first.',
        'Write an email.',
        'Inferred first.',
        'write an email.',
      ],
      constraints: ['Use English.'],
      reviewWarnings: ['Verify the date.'],
    }
    const snapshot = structuredClone(context)

    const result = prioritizeTeacherWritingRequirement(context, '  Write an email.  ')

    expect(result).toEqual({
      materialSummary: 'Summary',
      writingRequirements: ['Write an email.', 'Inferred first.', 'write an email.'],
      constraints: ['Use English.'],
      reviewWarnings: ['Verify the date.'],
    })
    expect(context).toEqual(snapshot)
    expect(result).not.toBe(context)
  })

  it('does not add a blank teacher item and still removes exact inferred duplicates', () => {
    const context: TaskMaterialContextV1 = {
      materialSummary: 'Summary',
      writingRequirements: ['First.', 'First.', 'Second.'],
      constraints: [],
      reviewWarnings: [],
    }

    expect(prioritizeTeacherWritingRequirement(context, '   ').writingRequirements).toEqual([
      'First.',
      'Second.',
    ])
    expect(prioritizeTeacherWritingRequirement(context, undefined).writingRequirements).toEqual([
      'First.',
      'Second.',
    ])
  })

  it('preserves the teacher item at the 50-item limit and drops only inferred tail items', () => {
    const inferred = Array.from({ length: 50 }, (_, index) => `Inferred ${index + 1}`)
    const context: TaskMaterialContextV1 = {
      materialSummary: 'Summary',
      writingRequirements: inferred,
      constraints: ['Constraint'],
      reviewWarnings: ['Warning'],
    }

    const result = prioritizeTeacherWritingRequirement(context, 'Teacher requirement')

    expect(result.writingRequirements).toHaveLength(50)
    expect(result.writingRequirements[0]).toBe('Teacher requirement')
    expect(result.writingRequirements.slice(1)).toEqual(inferred.slice(0, 49))
    expect(result.constraints).toEqual(['Constraint'])
    expect(result.reviewWarnings).toEqual(['Warning'])
    expect(context.writingRequirements).toHaveLength(50)
  })
})
