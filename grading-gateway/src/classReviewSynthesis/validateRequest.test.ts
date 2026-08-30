import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateClassReviewSynthesisRequest } from './validateRequest.js'

type JsonObject = Record<string, unknown>

const ISSUE_COUNTER_IDS = [
  'grammar',
  'spelling',
  'word_choice',
  'structure',
  'legibility',
  'logic_weak_connection',
  'logic_unclear_logic',
  'logic_missing_cause_effect',
  'logic_unclear_transition',
  'logic_topic_drift',
  'logic_irrelevant_sentence',
  'logic_unclear_reference',
  'logic_missing_motivation',
  'logic_plot_gap',
  'severity_low',
  'severity_medium',
  'severity_high',
  'other',
] as const

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
  if (!Object.prototype.hasOwnProperty.call(parent, key)) {
    throw new Error(`Fixture is missing ${key}.`)
  }
  return parent[key]
}

const fixtureBytes = readFileSync(
  new URL('../../../test-fixtures/class-review/synthesis-contracts.json', import.meta.url),
  'utf8',
)
const fixtureRoot = object(JSON.parse(fixtureBytes) as unknown, 'root')
const fixtureRequests = object(property(fixtureRoot, 'requests'), 'requests')

function requestFixture(name: 'pureStatistics' | 'withGroups'): JsonObject {
  return structuredClone(object(property(fixtureRequests, name), `requests.${name}`))
}

function statisticsOf(request: JsonObject): JsonObject {
  return object(property(request, 'statistics'), 'request.statistics')
}

function groupsOf(request: JsonObject): JsonObject[] {
  return array(property(request, 'groups'), 'request.groups').map((value, index) =>
    object(value, `request.groups[${index}]`),
  )
}

function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function dimension(index: number): JsonObject {
  return {
    dimensionId: `dimension.${index}`,
    label: `Dimension ${index}`,
    averageScore: 8,
    medianScore: 8,
    maxScore: 10,
    normalizedPerformance: 0.8,
  }
}

function scoreBand(index: number): JsonObject {
  return {
    bandId: `band.${index}`,
    lowerInclusive: 0,
    upperInclusive: 15,
    essayCount: 0,
  }
}

function group(index: number, excerpt: JsonObject | null = null): JsonObject {
  return {
    groupId: `group.${index}`,
    type: 'grammar',
    subtype: null,
    severity: 'medium',
    title: `Group ${index}`,
    mustCover: false,
    distinctEssaySupport: 1,
    occurrenceCount: 1,
    excerpt,
  }
}

function expectInvalid(value: unknown, code: string, path: string, limits?: { maxIssueCounters: number }) {
  expect(validateClassReviewSynthesisRequest(value, limits)).toEqual({
    ok: false,
    error: { code, path },
  })
}

function padObjectStringsToJsonBytes(
  value: JsonObject | JsonObject[],
  targetBytes: number,
  slots: Array<{ owner: JsonObject; key: string; maximumCodePoints: number }>,
) {
  let remaining = targetBytes - utf8JsonBytes(value)
  if (remaining < 0) throw new Error(`Boundary fixture already exceeds ${targetBytes} bytes.`)
  for (const slot of slots) {
    if (remaining === 0) break
    const current = property(slot.owner, slot.key)
    if (typeof current !== 'string') throw new Error(`Padding slot ${slot.key} is not a string.`)
    const available = slot.maximumCodePoints - Array.from(current).length
    const addition = Math.min(available, remaining)
    slot.owner[slot.key] = `${current}${'x'.repeat(addition)}`
    remaining -= addition
  }
  if (remaining !== 0) throw new Error(`Boundary fixture is short by ${remaining} bytes.`)
  expect(utf8JsonBytes(value)).toBe(targetBytes)
}

function requestWithStatisticsBytes(targetBytes: number): JsonObject {
  const request = requestFixture('pureStatistics')
  const statistics = statisticsOf(request)
  statistics.scoreBands = Array.from({ length: 20 }, (_, index) => scoreBand(index))
  statistics.dimensions = Array.from({ length: 10 }, (_, index) => dimension(index))
  statistics.issueCounters = ISSUE_COUNTER_IDS.map((counterId) => ({ counterId, count: 1 }))
  const bands = array(statistics.scoreBands, 'statistics.scoreBands').map((item, index) =>
    object(item, `statistics.scoreBands[${index}]`),
  )
  const dimensions = array(statistics.dimensions, 'statistics.dimensions').map((item, index) =>
    object(item, `statistics.dimensions[${index}]`),
  )
  padObjectStringsToJsonBytes(statistics, targetBytes, [
    ...bands.map((owner) => ({ owner, key: 'bandId', maximumCodePoints: 128 })),
    ...dimensions.map((owner) => ({ owner, key: 'dimensionId', maximumCodePoints: 128 })),
    ...dimensions.map((owner) => ({ owner, key: 'label', maximumCodePoints: 120 })),
  ])
  return request
}

function requestWithGroupBytes(targetBytes: number): JsonObject {
  const request = requestFixture('withGroups')
  const groups = Array.from({ length: 64 }, (_, index) =>
    group(index, { originalText: 'o', suggestionOrDiagnosis: 's' }),
  )
  request.groups = groups
  const slots: Array<{ owner: JsonObject; key: string; maximumCodePoints: number }> = []
  for (const item of groups) {
    slots.push({ owner: item, key: 'groupId', maximumCodePoints: 128 })
    slots.push({ owner: item, key: 'title', maximumCodePoints: 40 })
    const excerpt = object(property(item, 'excerpt'), 'group.excerpt')
    slots.push({ owner: excerpt, key: 'originalText', maximumCodePoints: 160 })
    slots.push({ owner: excerpt, key: 'suggestionOrDiagnosis', maximumCodePoints: 160 })
  }
  padObjectStringsToJsonBytes(groups, targetBytes, slots)
  return request
}

describe('validateClassReviewSynthesisRequest', () => {
  it('loads and accepts both request shapes from the shared root fixture bytes', () => {
    for (const name of ['pureStatistics', 'withGroups'] as const) {
      const fixture = requestFixture(name)
      expect(validateClassReviewSynthesisRequest(fixture)).toEqual({ ok: true, value: fixture })
    }
  })

  it('requires exact own root keys and rejects browser, identity, content, and cache fields', () => {
    const missing = requestFixture('withGroups')
    delete missing.contractVersion
    expectInvalid(missing, 'missing_key', '/contractVersion')

    const source = requestFixture('withGroups')
    const inherited = Object.create({ contractVersion: source.contractVersion }) as JsonObject
    Object.assign(inherited, source)
    delete inherited.contractVersion
    expectInvalid(inherited, 'missing_key', '/contractVersion')

    for (const forbidden of [
      'taskId',
      'essayId',
      'resultId',
      'studentName',
      'teacherName',
      'className',
      'taskName',
      'images',
      'Base64',
      'materialText',
      'transcript',
      'gradingResult',
      'teacherNotes',
      'promptCacheKey',
    ]) {
      const request = requestFixture('withGroups')
      request[forbidden] = forbidden === 'images' ? [] : 'forbidden'
      expectInvalid(request, 'unknown_key', `/${forbidden}`)
    }
  })

  it('requires exact version literals, output limits, opaque IDs, and a 43-character digest', () => {
    for (const [key, path] of [
      ['contractVersion', '/contractVersion'],
      ['policyVersion', '/policyVersion'],
      ['schemaVersion', '/schemaVersion'],
      ['projectionVersion', '/projectionVersion'],
      ['budgetVersion', '/budgetVersion'],
    ] as const) {
      const request = requestFixture('pureStatistics')
      request[key] = 'unknown-version'
      expectInvalid(request, 'invalid_value', path)
    }

    const requestIdAtLimit = requestFixture('pureStatistics')
    requestIdAtLimit.requestId = `r${'a'.repeat(127)}`
    expect(validateClassReviewSynthesisRequest(requestIdAtLimit).ok).toBe(true)
    const requestIdOverLimit = requestFixture('pureStatistics')
    requestIdOverLimit.requestId = `r${'a'.repeat(128)}`
    expectInvalid(requestIdOverLimit, 'limit_exceeded', '/requestId')

    for (const digest of ['a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}+`]) {
      const request = requestFixture('pureStatistics')
      request.rubricRevisionDigest = digest
      expectInvalid(request, digest.length === 44 ? 'limit_exceeded' : 'invalid_value', '/rubricRevisionDigest')
    }

    for (const [key, valid, invalid] of [
      ['maxCompletionTokens', 3072, 3073],
      ['maxVisibleCodePoints', 2200, 2201],
      ['maxJsonUtf8Bytes', 16384, 16385],
    ] as const) {
      const accepted = requestFixture('pureStatistics')
      object(property(accepted, 'outputLimits'), 'outputLimits')[key] = valid
      expect(validateClassReviewSynthesisRequest(accepted).ok).toBe(true)
      const rejected = requestFixture('pureStatistics')
      object(property(rejected, 'outputLimits'), 'outputLimits')[key] = invalid
      expectInvalid(rejected, 'invalid_value', `/outputLimits/${key}`)
    }
  })

  it('accepts 10 dimensions and 20 score bands and rejects each +1 boundary', () => {
    const dimensionsAtLimit = requestFixture('pureStatistics')
    statisticsOf(dimensionsAtLimit).dimensions = Array.from({ length: 10 }, (_, index) => dimension(index))
    expect(validateClassReviewSynthesisRequest(dimensionsAtLimit).ok).toBe(true)
    const dimensionsOverLimit = structuredClone(dimensionsAtLimit)
    statisticsOf(dimensionsOverLimit).dimensions = Array.from({ length: 11 }, (_, index) => dimension(index))
    expectInvalid(dimensionsOverLimit, 'limit_exceeded', '/statistics/dimensions')

    const bandsAtLimit = requestFixture('pureStatistics')
    statisticsOf(bandsAtLimit).scoreBands = Array.from({ length: 20 }, (_, index) => scoreBand(index))
    expect(validateClassReviewSynthesisRequest(bandsAtLimit).ok).toBe(true)
    const bandsOverLimit = structuredClone(bandsAtLimit)
    statisticsOf(bandsOverLimit).scoreBands = Array.from({ length: 21 }, (_, index) => scoreBand(index))
    expectInvalid(bandsOverLimit, 'limit_exceeded', '/statistics/scoreBands')
  })

  it('accepts every one of the 18 fixed counters and rejects duplicates, dynamic aliases, and outer capacity 33', () => {
    const allCounters = requestFixture('pureStatistics')
    statisticsOf(allCounters).issueCounters = ISSUE_COUNTER_IDS.map((counterId) => ({ counterId, count: 1 }))
    expect(validateClassReviewSynthesisRequest(allCounters, { maxIssueCounters: 32 }).ok).toBe(true)

    const duplicate = structuredClone(allCounters)
    statisticsOf(duplicate).issueCounters = [
      ...array(statisticsOf(duplicate).issueCounters, 'issueCounters'),
      { counterId: ISSUE_COUNTER_IDS[0], count: 1 },
    ]
    expectInvalid(duplicate, 'duplicate_value', '/statistics/issueCounters/18/counterId')

    const unknown = requestFixture('pureStatistics')
    statisticsOf(unknown).issueCounters = [{ counterId: 'logic', count: 1 }]
    expectInvalid(unknown, 'invalid_value', '/statistics/issueCounters/0/counterId')

    expectInvalid(allCounters, 'invalid_value', '/limits/maxIssueCounters', { maxIssueCounters: 33 })
  })

  it('accepts exact statistics JSON 8 KiB and rejects 8 KiB + 1', () => {
    const exact = requestWithStatisticsBytes(8 * 1024)
    expect(validateClassReviewSynthesisRequest(exact).ok).toBe(true)
    expectInvalid(requestWithStatisticsBytes(8 * 1024 + 1), 'limit_exceeded', '/statistics')
  })

  it('requires exact nested statistic keys and unique aliases in their own namespaces', () => {
    const nested = requestFixture('withGroups')
    object(property(statisticsOf(nested), 'score'), 'statistics.score').studentName = 'forbidden'
    expectInvalid(nested, 'unknown_key', '/statistics/score/studentName')

    const duplicateDimension = requestFixture('pureStatistics')
    statisticsOf(duplicateDimension).dimensions = [dimension(0), dimension(0)]
    expectInvalid(duplicateDimension, 'duplicate_value', '/statistics/dimensions/1/dimensionId')

    const duplicateBand = requestFixture('pureStatistics')
    statisticsOf(duplicateBand).scoreBands = [scoreBand(0), scoreBand(0)]
    expectInvalid(duplicateBand, 'duplicate_value', '/statistics/scoreBands/1/bandId')

    const longLabel = requestFixture('pureStatistics')
    statisticsOf(longLabel).dimensions = [{ ...dimension(0), label: '😀'.repeat(120) }]
    expect(validateClassReviewSynthesisRequest(longLabel).ok).toBe(true)
    statisticsOf(longLabel).dimensions = [{ ...dimension(0), label: '😀'.repeat(121) }]
    expectInvalid(longLabel, 'limit_exceeded', '/statistics/dimensions/0/label')
  })

  it('accepts 64 unique groups and rejects 65, duplicate aliases, and unknown group enums', () => {
    const exact = requestFixture('withGroups')
    exact.groups = Array.from({ length: 64 }, (_, index) => group(index))
    expect(validateClassReviewSynthesisRequest(exact).ok).toBe(true)

    const excessive = structuredClone(exact)
    excessive.groups = Array.from({ length: 65 }, (_, index) => group(index))
    expectInvalid(excessive, 'limit_exceeded', '/groups')

    const duplicate = requestFixture('withGroups')
    duplicate.groups = [group(0), group(0)]
    expectInvalid(duplicate, 'duplicate_value', '/groups/1/groupId')

    const unknownType = requestFixture('withGroups')
    unknownType.groups = [{ ...group(0), type: 'essay' }]
    expectInvalid(unknownType, 'invalid_value', '/groups/0/type')

    const unknownSubtype = requestFixture('withGroups')
    unknownSubtype.groups = [{ ...group(0), type: 'logic', subtype: 'other' }]
    expectInvalid(unknownSubtype, 'invalid_value', '/groups/0/subtype')
  })

  it('enforces one exact excerpt object and the 160/160/48/360 Unicode code-point boundaries', () => {
    const excerptArray = requestFixture('withGroups')
    excerptArray.groups = [{ ...group(0), excerpt: [{ originalText: 'x', suggestionOrDiagnosis: 'y' }] }]
    expectInvalid(excerptArray, 'not_object', '/groups/0/excerpt')

    for (const field of ['originalText', 'suggestionOrDiagnosis'] as const) {
      const exact = requestFixture('withGroups')
      exact.groups = [group(0, {
        originalText: field === 'originalText' ? '😀'.repeat(160) : 'x',
        suggestionOrDiagnosis: field === 'suggestionOrDiagnosis' ? '😀'.repeat(160) : 'x',
      })]
      expect(validateClassReviewSynthesisRequest(exact).ok).toBe(true)
      const over = structuredClone(exact)
      object(property(groupsOf(over)[0], 'excerpt'), 'excerpt')[field] = '😀'.repeat(161)
      expectInvalid(over, 'limit_exceeded', `/groups/0/excerpt/${field}`)
    }

    const titleExact = requestFixture('withGroups')
    titleExact.groups = [{ ...group(0), title: '😀'.repeat(48) }]
    expect(validateClassReviewSynthesisRequest(titleExact).ok).toBe(true)
    const titleOver = structuredClone(titleExact)
    groupsOf(titleOver)[0].title = '😀'.repeat(49)
    expectInvalid(titleOver, 'limit_exceeded', '/groups/0/title')

    const visibleExact = requestFixture('withGroups')
    visibleExact.groups = [{
      ...group(0),
      title: '😀'.repeat(40),
      excerpt: { originalText: '😀'.repeat(160), suggestionOrDiagnosis: '😀'.repeat(160) },
    }]
    expect(validateClassReviewSynthesisRequest(visibleExact).ok).toBe(true)
    const visibleOver = structuredClone(visibleExact)
    groupsOf(visibleOver)[0].title = '😀'.repeat(41)
    expectInvalid(visibleOver, 'limit_exceeded', '/groups/0')

    const unknownExcerptKey = requestFixture('withGroups')
    unknownExcerptKey.groups = [group(0, { originalText: 'x', suggestionOrDiagnosis: 'y', secondExcerpt: 'z' })]
    expectInvalid(unknownExcerptKey, 'unknown_key', '/groups/0/excerpt/secondExcerpt')

    const malformedUnicode = requestFixture('withGroups')
    malformedUnicode.groups = [{ ...group(0), title: '\ud800' }]
    expectInvalid(malformedUnicode, 'invalid_value', '/groups/0/title')
  })

  it('accepts exact evidence JSON 32 KiB and rejects 32 KiB + 1', () => {
    expect(validateClassReviewSynthesisRequest(requestWithGroupBytes(32 * 1024)).ok).toBe(true)
    expectInvalid(requestWithGroupBytes(32 * 1024 + 1), 'limit_exceeded', '/groups')
  })
})
