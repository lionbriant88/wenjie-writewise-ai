import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  classReviewProviderOutputSchema,
  validateClassReviewProviderOutput,
} from './providerContract.js'
import { validateClassReviewSynthesisRequest } from './validateRequest.js'

type JsonObject = Record<string, unknown>

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Fixture ${label} is not an object.`)
  }
  return value as JsonObject
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Fixture ${label} is not an array.`)
  return value
}

function property(parent: JsonObject, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`Fixture is missing ${key}.`)
  return parent[key]
}

const fixtureBytes = readFileSync(
  new URL('../../../test-fixtures/class-review/synthesis-contracts.json', import.meta.url),
  'utf8',
)
const fixtureRoot = object(JSON.parse(fixtureBytes) as unknown, 'root')
const fixtureRequests = object(property(fixtureRoot, 'requests'), 'requests')
const fixtureResults = object(property(fixtureRoot, 'results'), 'results')

function requestFixture(name: 'pureStatistics' | 'withGroups'): JsonObject {
  return structuredClone(object(property(fixtureRequests, name), `requests.${name}`))
}

function outputFixture(): JsonObject {
  const succeeded = object(property(fixtureResults, 'succeeded'), 'results.succeeded')
  return structuredClone(object(property(succeeded, 'output'), 'results.succeeded.output'))
}

function typedRequest(name: 'pureStatistics' | 'withGroups' = 'withGroups') {
  const result = validateClassReviewSynthesisRequest(requestFixture(name))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Shared request fixture failed at ${result.error.path}.`)
  return result.value
}

function dimension(index: number, id = `dimension.${index}`): JsonObject {
  return {
    dimensionId: id,
    label: `Dimension ${index}`,
    averageScore: 8,
    medianScore: 8,
    maxScore: 10,
    normalizedPerformance: 0.8,
  }
}

function group(index: number, id = `group.${index}`): JsonObject {
  return {
    groupId: id,
    type: 'grammar',
    subtype: null,
    severity: 'medium',
    title: `Group ${index}`,
    mustCover: false,
    distinctEssaySupport: 1,
    occurrenceCount: 1,
    excerpt: null,
  }
}

function requestWithAliases(options: { longAliases?: boolean } = {}) {
  const request = requestFixture('withGroups')
  const statistics = object(property(request, 'statistics'), 'statistics')
  statistics.dimensions = Array.from({ length: 10 }, (_, index) => {
    const prefix = `d${index}.`
    return dimension(index, options.longAliases ? `${prefix}${'d'.repeat(128 - prefix.length)}` : `d${index}`)
  })
  request.groups = Array.from({ length: 64 }, (_, index) => {
    const prefix = `g${index}.`
    return group(index, options.longAliases ? `${prefix}${'g'.repeat(128 - prefix.length)}` : `g${index}`)
  })
  Object.assign(object(property(request, 'semanticCoverage'), 'semanticCoverage'), {
    projectedGroupCount: 64,
    eligibleGroupCount: 64,
    groupCoverage: 1,
    projectedDistinctEssaySupportSum: 64,
    eligibleDistinctEssaySupportSum: 64,
    supportWeightedCoverage: 1,
    projectedOccurrenceSum: 64,
    eligibleOccurrenceSum: 64,
    occurrenceWeightedCoverage: 1,
  })
  const result = validateClassReviewSynthesisRequest(request)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Alias request failed at ${result.error.path}.`)
  return result.value
}

function minimalOutput(): JsonObject {
  return {
    overallComment: 'O',
    strengths: [{ title: 'S', detail: 'D', dimensionIds: [] }],
    patterns: [],
    learningRecommendations: [{ title: 'R', action: 'A' }],
  }
}

function expectInvalid(value: unknown, request: ReturnType<typeof typedRequest>, code: string, path: string) {
  expect(validateClassReviewProviderOutput(value, request)).toEqual({
    ok: false,
    error: { code, path },
  })
}

function patterns(output: JsonObject): JsonObject[] {
  return array(property(output, 'patterns'), 'output.patterns').map((value, index) =>
    object(value, `output.patterns[${index}]`),
  )
}

function strengths(output: JsonObject): JsonObject[] {
  return array(property(output, 'strengths'), 'output.strengths').map((value, index) =>
    object(value, `output.strengths[${index}]`),
  )
}

function recommendations(output: JsonObject): JsonObject[] {
  return array(property(output, 'learningRecommendations'), 'output.learningRecommendations').map((value, index) =>
    object(value, `output.learningRecommendations[${index}]`),
  )
}

function visibleSlots(output: JsonObject) {
  return [
    { owner: output, key: 'overallComment', maximum: 300 },
    ...strengths(output).flatMap((owner) => [
      { owner, key: 'title', maximum: 40 },
      { owner, key: 'detail', maximum: 120 },
    ]),
    ...patterns(output).flatMap((owner) => [
      { owner, key: 'title', maximum: 40 },
      { owner, key: 'diagnosis', maximum: 100 },
      { owner, key: 'teachingAction', maximum: 100 },
    ]),
    ...recommendations(output).flatMap((owner) => [
      { owner, key: 'title', maximum: 40 },
      { owner, key: 'action', maximum: 120 },
    ]),
  ]
}

function outputForVisibleBoundary(targetCodePoints: number): JsonObject {
  const output: JsonObject = {
    overallComment: 'x',
    strengths: Array.from({ length: 3 }, () => ({ title: 'x', detail: 'x', dimensionIds: [] })),
    patterns: Array.from({ length: 8 }, (_, index) => ({
      groupIds: [`g${index}`],
      title: 'x',
      diagnosis: 'x',
      teachingAction: 'x',
      severity: 'medium',
    })),
    learningRecommendations: Array.from({ length: 3 }, () => ({ title: 'x', action: 'x' })),
  }
  let current = visibleSlots(output).reduce(
    (sum, slot) => sum + Array.from(String(property(slot.owner, slot.key))).length,
    0,
  )
  for (const slot of visibleSlots(output)) {
    if (current === targetCodePoints) break
    const value = String(property(slot.owner, slot.key))
    const available = slot.maximum - Array.from(value).length
    const addition = Math.min(available, targetCodePoints - current)
    slot.owner[slot.key] = `${value}${'😀'.repeat(addition)}`
    current += addition
  }
  if (current !== targetCodePoints) throw new Error(`Visible boundary is short by ${targetCodePoints - current}.`)
  return output
}

function utf8StringWithBytes(byteLength: number): string {
  if (byteLength < 1) return ''
  const codePoints = Math.ceil(byteLength / 4)
  const finalWidth = byteLength - (codePoints - 1) * 4
  const final = finalWidth === 1 ? 'a' : finalWidth === 2 ? 'é' : finalWidth === 3 ? '€' : '😀'
  return `${'😀'.repeat(codePoints - 1)}${final}`
}

function outputForJsonBytes(targetBytes: number): { output: JsonObject; request: ReturnType<typeof requestWithAliases> } {
  const request = requestWithAliases({ longAliases: true })
  const dimensionIds = request.statistics.dimensions.map(({ dimensionId }) => dimensionId)
  const groupIds = request.groups.map(({ groupId }) => groupId)
  const output: JsonObject = {
    overallComment: 'x',
    strengths: Array.from({ length: 3 }, () => ({
      title: 'x',
      detail: 'x',
      dimensionIds: dimensionIds.slice(0, 3),
    })),
    patterns: Array.from({ length: 8 }, (_, index) => ({
      groupIds: groupIds.slice(index * 8, index * 8 + 8),
      title: 'x',
      diagnosis: 'x',
      teachingAction: 'x',
      severity: 'medium',
    })),
    learningRecommendations: Array.from({ length: 3 }, () => ({ title: 'x', action: 'x' })),
  }
  let remaining = targetBytes - Buffer.byteLength(JSON.stringify(output), 'utf8')
  if (remaining < 0) throw new Error(`Output fixture already exceeds ${targetBytes} bytes.`)
  for (const slot of visibleSlots(output)) {
    if (remaining === 0) break
    const value = String(property(slot.owner, slot.key))
    const availableCodePoints = slot.maximum - Array.from(value).length
    const bytes = Math.min(remaining, availableCodePoints * 4)
    slot.owner[slot.key] = `${value}${utf8StringWithBytes(bytes)}`
    remaining -= bytes
  }
  if (remaining !== 0) throw new Error(`Output fixture is short by ${remaining} bytes.`)
  expect(Buffer.byteLength(JSON.stringify(output), 'utf8')).toBe(targetBytes)
  return { output, request }
}

describe('classReviewProviderOutputSchema', () => {
  it('exports the strict kimi-class-review-output-v1 structure and local item bounds', () => {
    const opaqueAliasSchema = {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$',
    }
    expect(classReviewProviderOutputSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['overallComment', 'strengths', 'patterns', 'learningRecommendations'],
      properties: {
        overallComment: { type: 'string', minLength: 1, maxLength: 300 },
        strengths: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'detail', 'dimensionIds'],
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 40 },
              detail: { type: 'string', minLength: 1, maxLength: 120 },
              dimensionIds: {
                type: 'array',
                minItems: 0,
                maxItems: 3,
                uniqueItems: true,
                items: opaqueAliasSchema,
              },
            },
          },
        },
        patterns: {
          type: 'array',
          minItems: 0,
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['groupIds', 'title', 'diagnosis', 'teachingAction', 'severity'],
            properties: {
              groupIds: {
                type: 'array',
                minItems: 1,
                maxItems: 12,
                uniqueItems: true,
                items: opaqueAliasSchema,
              },
              title: { type: 'string', minLength: 1, maxLength: 40 },
              diagnosis: { type: 'string', minLength: 1, maxLength: 100 },
              teachingAction: { type: 'string', minLength: 1, maxLength: 100 },
              severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
          },
        },
        learningRecommendations: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'action'],
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 40 },
              action: { type: 'string', minLength: 1, maxLength: 120 },
            },
          },
        },
      },
    })
  })
})

describe('validateClassReviewProviderOutput', () => {
  it('accepts only the succeeded Provider output from the shared root fixture bytes', () => {
    const output = outputFixture()
    expect(validateClassReviewProviderOutput(output, typedRequest())).toEqual({ ok: true, value: output })
  })

  it('requires exact own output keys and rejects model-generated authority and per-essay fields', () => {
    const request = typedRequest()
    const source = outputFixture()
    const inherited = Object.create({ overallComment: source.overallComment }) as JsonObject
    Object.assign(inherited, source)
    delete inherited.overallComment
    expectInvalid(inherited, request, 'missing_key', '/output/overallComment')

    for (const forbidden of [
      'studentCount',
      'percentage',
      'percent',
      'occurrenceCount',
      'examples',
      'databaseId',
      'id',
      'order',
      'displayOrder',
      'origin',
      'source',
      'weaknesses',
      'teachingPriorities',
      'rewriteExercises',
      'essayFeedback',
      'perEssayFeedback',
    ]) {
      const output = outputFixture()
      output[forbidden] = []
      expectInvalid(output, request, 'unknown_key', `/output/${forbidden}`)
    }
  })

  it('accepts overallComment at 300 code points and rejects 301', () => {
    const request = typedRequest()
    const exact = minimalOutput()
    exact.overallComment = '😀'.repeat(300)
    expect(validateClassReviewProviderOutput(exact, request).ok).toBe(true)
    const over = structuredClone(exact)
    over.overallComment = '😀'.repeat(301)
    expectInvalid(over, request, 'limit_exceeded', '/output/overallComment')
  })

  it('enforces 1-3 strengths, exact nested keys, 40/120 strings, and 0-3 known unique dimension aliases', () => {
    const request = requestWithAliases()
    const noStrengths = minimalOutput()
    noStrengths.strengths = []
    expectInvalid(noStrengths, request, 'invalid_value', '/output/strengths')

    const three = minimalOutput()
    three.strengths = Array.from({ length: 3 }, (_, index) => ({
      title: '😀'.repeat(40),
      detail: '😀'.repeat(120),
      dimensionIds: index === 0 ? ['d0', 'd1', 'd2'] : [],
    }))
    expect(validateClassReviewProviderOutput(three, request).ok).toBe(true)

    const four = structuredClone(three)
    four.strengths = [...array(four.strengths, 'strengths'), { title: 'x', detail: 'x', dimensionIds: [] }]
    expectInvalid(four, request, 'limit_exceeded', '/output/strengths')

    const titleOver = minimalOutput()
    strengths(titleOver)[0].title = '😀'.repeat(41)
    expectInvalid(titleOver, request, 'limit_exceeded', '/output/strengths/0/title')
    const detailOver = minimalOutput()
    strengths(detailOver)[0].detail = '😀'.repeat(121)
    expectInvalid(detailOver, request, 'limit_exceeded', '/output/strengths/0/detail')

    const tooManyIds = minimalOutput()
    strengths(tooManyIds)[0].dimensionIds = ['d0', 'd1', 'd2', 'd3']
    expectInvalid(tooManyIds, request, 'limit_exceeded', '/output/strengths/0/dimensionIds')
    const duplicateIds = minimalOutput()
    strengths(duplicateIds)[0].dimensionIds = ['d0', 'd0']
    expectInvalid(duplicateIds, request, 'duplicate_value', '/output/strengths/0/dimensionIds/1')
    const unknownId = minimalOutput()
    strengths(unknownId)[0].dimensionIds = ['database-dimension-id']
    expectInvalid(unknownId, request, 'unknown_reference', '/output/strengths/0/dimensionIds/0')

    const reusable = minimalOutput()
    reusable.strengths = [
      { title: 'A', detail: 'A', dimensionIds: ['d0'] },
      { title: 'B', detail: 'B', dimensionIds: ['d0'] },
    ]
    expect(validateClassReviewProviderOutput(reusable, request).ok).toBe(true)

    const nestedAuthority = minimalOutput()
    strengths(nestedAuthority)[0].studentCount = 2
    expectInvalid(nestedAuthority, request, 'unknown_key', '/output/strengths/0/studentCount')
  })

  it('enforces 0-8 patterns, 40/100/100 strings, 1-12 known IDs, and global group ownership', () => {
    const request = requestWithAliases()
    expect(validateClassReviewProviderOutput(minimalOutput(), request).ok).toBe(true)

    const eight = minimalOutput()
    eight.patterns = Array.from({ length: 8 }, (_, index) => ({
      groupIds: [`g${index}`],
      title: '😀'.repeat(40),
      diagnosis: '😀'.repeat(100),
      teachingAction: '😀'.repeat(100),
      severity: 'medium',
    }))
    expect(validateClassReviewProviderOutput(eight, request).ok).toBe(true)

    const nine = structuredClone(eight)
    nine.patterns = [...array(nine.patterns, 'patterns'), {
      groupIds: ['g8'], title: 'x', diagnosis: 'x', teachingAction: 'x', severity: 'low',
    }]
    expectInvalid(nine, request, 'limit_exceeded', '/output/patterns')

    for (const [key, maximum] of [
      ['title', 40],
      ['diagnosis', 100],
      ['teachingAction', 100],
    ] as const) {
      const output = minimalOutput()
      output.patterns = [{
        groupIds: ['g0'], title: 'x', diagnosis: 'x', teachingAction: 'x', severity: 'medium',
        [key]: '😀'.repeat(maximum + 1),
      }]
      expectInvalid(output, request, 'limit_exceeded', `/output/patterns/0/${key}`)
    }

    const twelve = minimalOutput()
    twelve.patterns = [{
      groupIds: Array.from({ length: 12 }, (_, index) => `g${index}`),
      title: 'x', diagnosis: 'x', teachingAction: 'x', severity: 'medium',
    }]
    expect(validateClassReviewProviderOutput(twelve, request).ok).toBe(true)
    const thirteen = structuredClone(twelve)
    patterns(thirteen)[0].groupIds = Array.from({ length: 13 }, (_, index) => `g${index}`)
    expectInvalid(thirteen, request, 'limit_exceeded', '/output/patterns/0/groupIds')

    const emptyIds = minimalOutput()
    emptyIds.patterns = [{ groupIds: [], title: 'x', diagnosis: 'x', teachingAction: 'x', severity: 'low' }]
    expectInvalid(emptyIds, request, 'invalid_value', '/output/patterns/0/groupIds')
    const duplicateWithin = minimalOutput()
    duplicateWithin.patterns = [{ groupIds: ['g0', 'g0'], title: 'x', diagnosis: 'x', teachingAction: 'x', severity: 'low' }]
    expectInvalid(duplicateWithin, request, 'duplicate_value', '/output/patterns/0/groupIds/1')
    const duplicateAcross = minimalOutput()
    duplicateAcross.patterns = [
      { groupIds: ['g0'], title: 'x', diagnosis: 'x', teachingAction: 'x', severity: 'low' },
      { groupIds: ['g0'], title: 'y', diagnosis: 'y', teachingAction: 'y', severity: 'low' },
    ]
    expectInvalid(duplicateAcross, request, 'duplicate_value', '/output/patterns/1/groupIds/0')
    const unknown = minimalOutput()
    unknown.patterns = [{ groupIds: ['database-group-id'], title: 'x', diagnosis: 'x', teachingAction: 'x', severity: 'low' }]
    expectInvalid(unknown, request, 'unknown_reference', '/output/patterns/0/groupIds/0')
  })

  it('enforces 1-3 learning recommendations and their 40/120 code-point bounds', () => {
    const request = typedRequest()
    const none = minimalOutput()
    none.learningRecommendations = []
    expectInvalid(none, request, 'invalid_value', '/output/learningRecommendations')

    const three = minimalOutput()
    three.learningRecommendations = Array.from({ length: 3 }, () => ({
      title: '😀'.repeat(40), action: '😀'.repeat(120),
    }))
    expect(validateClassReviewProviderOutput(three, request).ok).toBe(true)
    const four = structuredClone(three)
    four.learningRecommendations = [...array(four.learningRecommendations, 'recommendations'), { title: 'x', action: 'x' }]
    expectInvalid(four, request, 'limit_exceeded', '/output/learningRecommendations')

    const titleOver = minimalOutput()
    recommendations(titleOver)[0].title = '😀'.repeat(41)
    expectInvalid(titleOver, request, 'limit_exceeded', '/output/learningRecommendations/0/title')
    const actionOver = minimalOutput()
    recommendations(actionOver)[0].action = '😀'.repeat(121)
    expectInvalid(actionOver, request, 'limit_exceeded', '/output/learningRecommendations/0/action')
  })

  it('accepts exactly 2,200 narrative code points and rejects 2,201', () => {
    const request = requestWithAliases()
    expect(validateClassReviewProviderOutput(outputForVisibleBoundary(2200), request).ok).toBe(true)
    expectInvalid(outputForVisibleBoundary(2201), request, 'limit_exceeded', '/output')
  })

  it('accepts exactly 16 KiB reconstructed JSON and rejects 16 KiB + 1', () => {
    const exact = outputForJsonBytes(16 * 1024)
    expect(validateClassReviewProviderOutput(exact.output, exact.request).ok).toBe(true)
    const over = outputForJsonBytes(16 * 1024 + 1)
    expectInvalid(over.output, over.request, 'limit_exceeded', '/output')
  })

  it('rejects malformed Unicode and nested ordering/source/example fields', () => {
    const request = typedRequest()
    const malformed = minimalOutput()
    malformed.overallComment = '\ud800'
    expectInvalid(malformed, request, 'invalid_value', '/output/overallComment')

    for (const forbidden of ['examples', 'occurrenceCount', 'order', 'source', 'essayId']) {
      const output = minimalOutput()
      output.patterns = [{
        groupIds: ['grammar.tense'],
        title: 'x',
        diagnosis: 'x',
        teachingAction: 'x',
        severity: 'medium',
        [forbidden]: forbidden === 'examples' ? [] : 'forbidden',
      }]
      expectInvalid(output, request, 'unknown_key', `/output/patterns/0/${forbidden}`)
    }
  })
})
