import { describe, expect, it } from 'vitest'
import type { GatewayImageInput } from '../providers/multimodalProviderTypes.js'
import type { ConfirmedTaskPackageV2 } from './types.js'
import { createCanonicalGradeIdentity } from './logicalRequestIdentity.js'

const versions = {
  gradingPolicyVersion: 'grading-policy-v1',
  providerSchemaVersion: 'essay-grading-provider-v2',
}

function task(): ConfirmedTaskPackageV2 {
  return {
    taskId: 'task-identity',
    fullScore: 20,
    materialSummary: 'Write a response.',
    writingRequirements: ['Address the prompt.', 'Use evidence.'],
    constraints: ['Write in English.', 'Stay on topic.'],
    rubric: {
      taskName: 'Teacher-facing task name',
      materialSummary: 'Write a response.',
      writingRequirements: ['Address the prompt.', 'Use evidence.'],
      constraints: ['Write in English.', 'Stay on topic.'],
      dimensions: [
        {
          id: 'content', name: 'Content', description: 'Complete the task.', weight: 60,
          deductionFocus: ['Missing evidence.'], sourceEvidence: ['Teacher source A.'],
        },
        {
          id: 'language', name: 'Language', description: 'Use accurate language.', weight: 40,
          deductionFocus: ['Grammar errors.'], sourceEvidence: ['Teacher source B.'],
        },
      ],
      reviewWarnings: ['  Verify the date.  ', 'Verify the date.', 'Check the quotation.'],
    },
  }
}

function pages(): GatewayImageInput[] {
  return [
    { pageId: 'internal-page-a', mimeType: 'image/png', buffer: Buffer.from([0, 1, 2, 3]) },
    { pageId: 'internal-page-b', mimeType: 'image/jpeg', buffer: Buffer.from([4, 5, 6]) },
  ]
}

function imageIdentity(overrides: Partial<Parameters<typeof createCanonicalGradeIdentity>[0]> = {}) {
  return createCanonicalGradeIdentity({
    task: task(), essayId: 'essay-a', pageIds: ['external-page-a', 'external-page-b'], pages: pages(),
    ...overrides,
  }, versions)
}

function textIdentity(confirmedTranscript: string, taskOverride = task()) {
  return createCanonicalGradeIdentity({
    task: taskOverride, essayId: 'essay-a', pageIds: [], pages: [], confirmedTranscript,
  }, versions)
}

function cloneTask(): ConfirmedTaskPackageV2 {
  return JSON.parse(JSON.stringify(task())) as ConfirmedTaskPackageV2
}

describe('createCanonicalGradeIdentity', () => {
  it('is stable across object insertion order and emits only opaque versioned digests', () => {
    const source = task()
    const reordered = {
      rubric: {
        reviewWarnings: [...source.rubric.reviewWarnings],
        dimensions: source.rubric.dimensions.map((dimension) => ({
          sourceEvidence: [...dimension.sourceEvidence], deductionFocus: [...dimension.deductionFocus],
          weight: dimension.weight, description: dimension.description, name: dimension.name, id: dimension.id,
        })),
        constraints: [...source.rubric.constraints], writingRequirements: [...source.rubric.writingRequirements],
        materialSummary: source.rubric.materialSummary, taskName: source.rubric.taskName,
      },
      constraints: [...source.constraints], writingRequirements: [...source.writingRequirements],
      materialSummary: source.materialSummary, fullScore: source.fullScore, taskId: source.taskId,
    } as ConfirmedTaskPackageV2

    const first = imageIdentity()
    const equivalent = imageIdentity({ task: reordered })

    expect(equivalent).toEqual(first)
    expect(first.rubricRevisionDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.essaySourceRevisionDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.payloadHash).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.logicalRequestId).toMatch(/^logical-grade-v1:[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(first)).not.toMatch(/task-identity|essay-a|Teacher-facing|Write a response/)
  })

  it('preserves business-array order in rubric, source, and complete payload identities', () => {
    const reorderedRequirements = cloneTask()
    reorderedRequirements.writingRequirements.reverse()
    expect(imageIdentity({ task: reorderedRequirements }).rubricRevisionDigest)
      .not.toBe(imageIdentity().rubricRevisionDigest)

    const original = imageIdentity()
    const reorderedPages = imageIdentity({
      pageIds: ['external-page-b', 'external-page-a'], pages: [...pages()].reverse(),
    })
    expect(reorderedPages.essaySourceRevisionDigest).not.toBe(original.essaySourceRevisionDigest)
    expect(reorderedPages.payloadHash).not.toBe(original.payloadHash)
  })

  it('uses the model-context review-warning normalization while hashing the full raw payload separately', () => {
    const raw = cloneTask()
    raw.rubric.reviewWarnings = ['  Keep this.  ', 'Keep this.', '😀'.repeat(5_001)]
    const normalized = cloneTask()
    normalized.rubric.reviewWarnings = ['Keep this.', '😀'.repeat(5_000)]

    const rawIdentity = imageIdentity({ task: raw })
    const normalizedIdentity = imageIdentity({ task: normalized })
    expect(rawIdentity.rubricRevisionDigest).toBe(normalizedIdentity.rubricRevisionDigest)
    expect(rawIdentity.logicalRequestId).toBe(normalizedIdentity.logicalRequestId)
    expect(rawIdentity.payloadHash).not.toBe(normalizedIdentity.payloadHash)
  })

  it('binds image mode to ordered index, MIME, byte length, and exact page bytes but not internal filenames or page IDs', () => {
    const baseline = imageIdentity()
    const renamed = pages().map((page, index) => ({
      ...page, pageId: `renamed-${index}`, filename: `private-${index}.png`,
    })) as GatewayImageInput[]
    expect(imageIdentity({ pages: renamed })).toEqual(baseline)

    const changedMime = pages()
    changedMime[0] = { ...changedMime[0], mimeType: 'image/webp' }
    expect(imageIdentity({ pages: changedMime }).essaySourceRevisionDigest).not.toBe(baseline.essaySourceRevisionDigest)

    const changedBytes = pages()
    changedBytes[0] = { ...changedBytes[0], buffer: Buffer.from([0, 1, 2, 4]) }
    expect(imageIdentity({ pages: changedBytes }).essaySourceRevisionDigest).not.toBe(baseline.essaySourceRevisionDigest)

    const changedLength = pages()
    changedLength[0] = { ...changedLength[0], buffer: Buffer.from([0, 1, 2, 3, 0]) }
    expect(imageIdentity({ pages: changedLength }).essaySourceRevisionDigest).not.toBe(baseline.essaySourceRevisionDigest)
  })

  it.each([
    ['trim', ' Exact text.'],
    ['case', 'exact text.'],
    ['trailing whitespace', 'Exact text. '],
    ['Unicode composition', 'Cafe\u0301'],
  ])('hashes confirmed UTF-8 text exactly without %s normalization', (_label, changed) => {
    expect(textIdentity(changed).essaySourceRevisionDigest)
      .not.toBe(textIdentity('Exact text.').essaySourceRevisionDigest)
  })

  it.each([
    ['task ID', () => imageIdentity({ task: { ...task(), taskId: 'task-other' } })],
    ['essay ID', () => imageIdentity({ essayId: 'essay-other' })],
    ['grading policy version', () => createCanonicalGradeIdentity({ task: task(), essayId: 'essay-a', pageIds: ['external-page-a', 'external-page-b'], pages: pages() }, { ...versions, gradingPolicyVersion: 'grading-policy-v2' })],
    ['Provider schema version', () => createCanonicalGradeIdentity({ task: task(), essayId: 'essay-a', pageIds: ['external-page-a', 'external-page-b'], pages: pages() }, { ...versions, providerSchemaVersion: 'essay-grading-provider-v2-legacy' })],
  ] as const)('binds the logical request ID to %s', (_label, changed) => {
    expect(changed().logicalRequestId).not.toBe(imageIdentity().logicalRequestId)
  })

  it.each([
    ['taskName', (value: ConfirmedTaskPackageV2) => { value.rubric.taskName = 'Changed private name.' }],
    ['deductionFocus', (value: ConfirmedTaskPackageV2) => { value.rubric.dimensions[0].deductionFocus = ['Changed private deduction.'] }],
    ['sourceEvidence', (value: ConfirmedTaskPackageV2) => { value.rubric.dimensions[0].sourceEvidence = ['Changed private evidence.'] }],
  ] as const)('keeps logical identity stable but detects a complete-payload %s conflict', (_label, mutate) => {
    const changedTask = cloneTask()
    mutate(changedTask)
    const baseline = imageIdentity()
    const changed = imageIdentity({ task: changedTask })
    expect(changed.logicalRequestId).toBe(baseline.logicalRequestId)
    expect(changed.payloadHash).not.toBe(baseline.payloadHash)
  })

  it('excludes an accidental caller request ID from every identity', () => {
    const base = { task: task(), essayId: 'essay-a', pageIds: ['external-page-a', 'external-page-b'], pages: pages() }
    const first = createCanonicalGradeIdentity({ ...base, requestId: 'caller-one' } as typeof base, versions)
    const second = createCanonicalGradeIdentity({ ...base, requestId: 'caller-two' } as typeof base, versions)
    expect(second).toEqual(first)
  })

  it.each([
    ['non-finite full score', () => imageIdentity({ task: { ...task(), fullScore: Number.POSITIVE_INFINITY } })],
    ['non-finite dimension weight', () => { const value = cloneTask(); value.rubric.dimensions[0].weight = Number.NaN; return imageIdentity({ task: value }) }],
    ['mismatched image manifest', () => imageIdentity({ pageIds: ['PRIVATE-PAGE-MARKER'], pages: [] })],
    ['mixed confirmed-text mode', () => imageIdentity({ confirmedTranscript: 'PRIVATE-TEXT-MARKER' })],
  ] as const)('fails closed with a content-free message for %s', (_label, run) => {
    let thrown: unknown
    try { run() } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(Error)
    expect(String(thrown)).not.toMatch(/PRIVATE|task-identity|essay-a|digest|[A-Za-z0-9_-]{43}/)
  })
})
