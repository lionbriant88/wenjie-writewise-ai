import { describe, expect, it, vi } from 'vitest'
import { createGradingJobIdentityStore } from './gradingJobIdentity'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'
const UUID_D = '44444444-4444-4444-8444-444444444444'
const UUID_E = '55555555-5555-4555-8555-555555555555'
const OPAQUE_GRADING_ID = /^grading-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function sequenceRandomId(...values: string[]) {
  let index = 0
  return vi.fn(() => values[Math.min(index++, values.length - 1)])
}

describe('createGradingJobIdentityStore', () => {
  it('reuses one caller ID for every attachment and retry of the exact job version', () => {
    const randomId = sequenceRandomId(UUID_A, UUID_B)
    const store = createGradingJobIdentityStore(randomId)
    const version = {
      taskId: 'task-1',
      essayId: 'essay-1',
      sourceGeneration: 0,
      rubricGeneration: 0,
    }

    expect(store.getOrCreate(version)).toBe(`grading-${UUID_A}`)
    expect(store.getOrCreate({ ...version })).toBe(`grading-${UUID_A}`)
    expect(store.getOrCreate(version)).toBe(`grading-${UUID_A}`)
    expect(randomId).toHaveBeenCalledTimes(1)
  })

  it('creates a new caller ID when any exact tuple component changes', () => {
    const store = createGradingJobIdentityStore(
      sequenceRandomId(UUID_A, UUID_B, UUID_C, UUID_D, UUID_E),
    )
    const base = {
      taskId: 'task-1',
      essayId: 'essay-1',
      sourceGeneration: 2,
      rubricGeneration: 3,
    }

    const ids = [
      store.getOrCreate(base),
      store.getOrCreate({ ...base, taskId: 'task-2' }),
      store.getOrCreate({ ...base, essayId: 'essay-2' }),
      store.getOrCreate({ ...base, sourceGeneration: 4 }),
      store.getOrCreate({ ...base, rubricGeneration: 5 }),
    ]

    expect(new Set(ids)).toHaveLength(ids.length)
  })

  it('invalidates every task and generation mapping for one essay only', () => {
    const store = createGradingJobIdentityStore(
      sequenceRandomId(UUID_A, UUID_B, UUID_C, UUID_D, UUID_E),
    )
    const firstVersion = {
      taskId: 'task-1',
      essayId: 'essay-1',
      sourceGeneration: 0,
      rubricGeneration: 0,
    }
    const secondVersion = {
      taskId: 'task-2',
      essayId: 'essay-1',
      sourceGeneration: 1,
      rubricGeneration: 1,
    }
    const unrelatedVersion = {
      taskId: 'task-1',
      essayId: 'essay-2',
      sourceGeneration: 0,
      rubricGeneration: 0,
    }

    const firstId = store.getOrCreate(firstVersion)
    const secondId = store.getOrCreate(secondVersion)
    const unrelatedId = store.getOrCreate(unrelatedVersion)

    store.invalidateEssay('essay-1')

    expect(store.getOrCreate(firstVersion)).not.toBe(firstId)
    expect(store.getOrCreate(secondVersion)).not.toBe(secondId)
    expect(store.getOrCreate(unrelatedVersion)).toBe(unrelatedId)
  })

  it('accepts a valid UUID with one existing grading prefix without doubling it', () => {
    const store = createGradingJobIdentityStore(() => `grading-${UUID_A}`)

    expect(
      store.getOrCreate({
        taskId: 'task-1',
        essayId: 'essay-1',
        sourceGeneration: 0,
        rubricGeneration: 0,
      }),
    ).toBe(`grading-${UUID_A}`)
  })

  it('skips a duplicate generated ID and never reissues it to another version', () => {
    const randomId = sequenceRandomId(UUID_A, UUID_A, UUID_B)
    const store = createGradingJobIdentityStore(randomId)

    const firstId = store.getOrCreate({
      taskId: 'task-1',
      essayId: 'essay-1',
      sourceGeneration: 0,
      rubricGeneration: 0,
    })
    const secondId = store.getOrCreate({
      taskId: 'task-1',
      essayId: 'essay-2',
      sourceGeneration: 0,
      rubricGeneration: 0,
    })

    expect(firstId).toBe(`grading-${UUID_A}`)
    expect(secondId).toBe(`grading-${UUID_B}`)
    expect(randomId).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['blank input', '   '],
    ['potential student identity', 'student-Zhang-San'],
    ['potential essay content', 'Yesterday I went to school.'],
  ])('falls back to a safe opaque ID for %s', (_label, unsafeCandidate) => {
    const store = createGradingJobIdentityStore(() => unsafeCandidate)

    const id = store.getOrCreate({
      taskId: 'task-Zhang-San',
      essayId: 'Yesterday I went to school.',
      sourceGeneration: 0,
      rubricGeneration: 0,
    })

    expect(id).toMatch(OPAQUE_GRADING_ID)
    expect(id).not.toContain('Zhang')
    expect(id).not.toContain('Yesterday')
    if (unsafeCandidate.trim()) {
      expect(id).not.toContain(unsafeCandidate.trim())
    }
  })

  it('uses a safe opaque UUID when no random source is injected', () => {
    const store = createGradingJobIdentityStore()

    expect(
      store.getOrCreate({
        taskId: 'task-1',
        essayId: 'essay-1',
        sourceGeneration: 0,
        rubricGeneration: 0,
      }),
    ).toMatch(OPAQUE_GRADING_ID)
  })

  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid generation before allocating an identity: %s',
    (invalidGeneration) => {
      const randomId = sequenceRandomId(UUID_A)
      const store = createGradingJobIdentityStore(randomId)

      expect(() => store.getOrCreate({
        taskId: 'task-1',
        essayId: 'essay-1',
        sourceGeneration: invalidGeneration,
        rubricGeneration: 0,
      })).toThrow(RangeError)
      expect(() => store.getOrCreate({
        taskId: 'task-1',
        essayId: 'essay-1',
        sourceGeneration: 0,
        rubricGeneration: invalidGeneration,
      })).toThrow(RangeError)
      expect(randomId).not.toHaveBeenCalled()
    },
  )
})
