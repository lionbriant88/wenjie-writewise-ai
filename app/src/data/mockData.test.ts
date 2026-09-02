import { describe, expect, it } from 'vitest'
import { aggregateClassReviewSnapshot } from '../services/classReview/aggregateClassReview'
import {
  buildClassReviewProjection,
  DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS,
  type PreparedGroupProjectionIdentityV1,
  type RedactionContext,
} from '../services/classReview/classReviewProjection'
import { redactClassReviewExcerpt, type PersonEntityDetector } from '../services/classReview/classReviewRedaction'
import { calculateTotalScore } from '../services/grading/scoringRules'
import { mockEssays, mockGradingResults, mockTasks } from './mockData'

function hashHexForClassReviewFixture(value: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    a ^= code
    a = Math.imul(a, 0x01000193) >>> 0
    b ^= code + index
    b = Math.imul(b, 0x85ebca6b) >>> 0
  }
  const parts: string[] = []
  for (let index = 0; index < 8; index += 1) {
    a = Math.imul(a ^ (b >>> 13), 0x01000193) >>> 0
    b = Math.imul(b ^ (a >>> 16), 0xc2b2ae35) >>> 0
    parts.push(((a ^ b) >>> 0).toString(16).padStart(8, '0'))
  }
  return parts.join('')
}

const fixtureEntityDetector: PersonEntityDetector = Object.freeze({
  detectorVersion: 'person-entity-detector-v1',
  detect: () => [],
})

describe('mock grading result consistency', () => {
  it('derives every synthetic total from the shared current scoring rule', () => {
    for (const result of mockGradingResults) {
      expect(result.totalScore, `${result.id} should reconcile with its dimensions`).toBe(
        calculateTotalScore(result.dimensionScores.map(({ score }) => score), 15),
      )
    }
  })

  it('initializes every canonical task and essay generation explicitly', () => {
    expect(mockTasks.every((task) => task.rubricGeneration === 0)).toBe(true)
    expect(mockEssays.every((essay) => essay.sourceGeneration === 0)).toBe(true)
  })

  it('initializes every synthetic grading result revision explicitly', () => {
    expect(mockGradingResults.every((result) => result.resultRevision === 0)).toBe(true)
  })

  it('keeps every unfinished canonical essay in the current actionable queue state', () => {
    const activeStatuses = mockEssays
      .filter((essay) => essay.status !== 'completed' && essay.status !== 'needs_review')
      .map((essay) => essay.status)

    expect(new Set(activeStatuses)).toEqual(new Set(['pending_grading']))
  })

  it('provides full text revision data for completed mock grading results', () => {
    for (const result of mockGradingResults) {
      expect(result.fullTextRevision, `${result.id} should include full text revision`).toBeDefined()
      expect(result.fullTextRevision?.correctedText).toContain('I suggest you join the club.')
      expect(result.fullTextRevision?.polishedText).toContain('I suggest that you join the club.')
      expect(result.fullTextRevision?.sentencePairs.length).toBeGreaterThanOrEqual(3)
      expect(result.fullTextRevision?.logicNotes.join(' ')).toContain('上下文关联度差')
      expect(
        result.fullTextRevision?.logicIssues.some((issue) => issue.needsTeacherReview),
        `${result.id} should include a teacher-review logic issue`,
      ).toBe(true)
    }
  })

  it('links each sentence revision to its matching error annotation', () => {
    for (const result of mockGradingResults) {
      const annotationsById = new Map(
        result.errorAnnotations.map((annotation) => [annotation.id, annotation]),
      )

      for (const revision of result.sentenceRevisions) {
        const relatedErrorIds = revision.relatedErrorIds
        const annotation = relatedErrorIds.length === 1 ? annotationsById.get(relatedErrorIds[0]) : undefined

        expect(
          relatedErrorIds,
          `${result.id}/${revision.id} should reference an error annotation`,
        ).toHaveLength(1)
        expect(annotation, `${result.id}/${revision.id} should reference an existing annotation`).toBeDefined()
        expect(revision.original).toBe(annotation?.original)
        expect(revision.revised).toBe(annotation?.suggestion)
      }
    }
  })

  it('keeps issue and expression source phrases visible in the mock essay text', () => {
    const essaysById = new Map(mockEssays.map((essay) => [essay.id, essay]))

    for (const result of mockGradingResults) {
      const essay = essaysById.get(result.essayId)

      expect(essay, `${result.id} should belong to an existing essay`).toBeDefined()

      for (const annotation of result.errorAnnotations) {
        expect(
          essay?.ocrText,
          `${result.id}/${annotation.id} original issue should be present in source text`,
        ).toContain(annotation.original)
      }

      for (const upgrade of result.upgradedExpressions) {
        expect(
          essay?.ocrText,
          `${result.id}/${upgrade.id} expression upgrade should be present in source text`,
        ).toContain(upgrade.original)
      }

      for (const pair of result.fullTextRevision?.sentencePairs ?? []) {
        expect(
          essay?.ocrText,
          `${result.id}/${pair.id} sentence pair original should be present in source text`,
        ).toContain(pair.original)
      }

      for (const logicIssue of result.fullTextRevision?.logicIssues ?? []) {
        expect(
          essay?.ocrText,
          `${result.id}/${logicIssue.id} logic issue original should be present in source text`,
        ).toContain(logicIssue.original)
      }
    }
  })

  it('keeps task-3 usable as a complete class-review fixture', () => {
    const task = mockTasks.find((item) => item.id === 'task-3')

    expect(task).toBeDefined()

    const aggregate = aggregateClassReviewSnapshot({
      task: task!,
      essays: mockEssays,
      results: mockGradingResults,
    })

    expect(aggregate.exclusions).toEqual([])
    expect(aggregate.includedEssayCount).toBe(12)
    expect(aggregate.issueEligibleEssayCount).toBe(12)
    expect(aggregate.partialIssueChannelCount).toBe(0)
    expect(aggregate.commonIssueGroups.length).toBeGreaterThan(0)
    expect(aggregate.commonIssueGroups.some((group) => group.type === 'grammar')).toBe(true)
    expect(aggregate.clearSpellingItems).toEqual([
      expect.objectContaining({
        originalWord: 'enviroment',
        correctedWord: 'environment',
        studentCount: 12,
        occurrenceCount: 12,
      }),
    ])

    const topicIndexes = new Map<string, number>()
    const redactionContext: RedactionContext = {
      prepare(group) {
        const currentIndex = topicIndexes.get(group.fingerprint) ?? topicIndexes.size + 1
        topicIndexes.set(group.fingerprint, currentIndex)
        const suffix = currentIndex.toString(16).padStart(16, '0')
        const evidenceKey = `scrub_v1_${suffix.padEnd(32, 'a')}`
        return {
          atomicTopic: {
            kind: 'atomic',
            keyVersion: 'topic-key-v1',
            taskScope: `scope_v1_${'a'.repeat(64)}`,
            key: `tk1.${suffix}`,
            fingerprintDigest: `fp1.${suffix.padEnd(64, 'b')}`,
          },
          title: {
            status: 'kept',
            text: group.title,
            redactionVersion: 'class-review-redaction-v1',
            scrubbedEvidenceKey: evidenceKey,
          },
          excerpt: {
            originalText: {
              status: 'kept',
              text: group.originalText,
              redactionVersion: 'class-review-redaction-v1',
              scrubbedEvidenceKey: evidenceKey,
            },
            suggestionOrDiagnosis: {
              status: 'kept',
              text: group.suggestionOrDiagnosis,
              redactionVersion: 'class-review-redaction-v1',
              scrubbedEvidenceKey: evidenceKey,
            },
          },
        }
      },
    }
    const projection = buildClassReviewProjection({
      aggregate,
      redactionContext,
      limits: DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS,
    })
    expect(projection.status).toBe('ready')
    if (projection.status === 'ready') {
      expect(projection.projection.groups.length).toBeGreaterThan(0)
    }

    const taskEssays = mockEssays.filter((essay) => essay.taskId === task!.id)
    const productLikeRedactionContext: RedactionContext = {
      prepare(group): PreparedGroupProjectionIdentityV1 {
        const digest = hashHexForClassReviewFixture(`${task!.id}\u0000${group.fingerprint}`)
        const redact = (sourceText: string, seed: string) => redactClassReviewExcerpt({
          sourceText,
          knownNames: {
            students: [],
            defaultStudentLabels: taskEssays.map((essay) => essay.essayNumber),
            teachers: [],
            classNames: [task!.className],
            schoolNames: [],
            taskNames: [task!.taskName],
          },
          entityDetector: fixtureEntityDetector,
          scrubbedEvidenceKey: `scrub_v1_${hashHexForClassReviewFixture(seed)}`,
        })
        return {
          atomicTopic: {
            kind: 'atomic',
            keyVersion: 'topic-key-v1',
            taskScope: `scope_v1_${hashHexForClassReviewFixture(`class-review-task:${task!.id}`).slice(0, 64)}`,
            key: `tk1.${digest.slice(0, 16)}`,
            fingerprintDigest: `fp1.${digest}`,
          },
          title: redact(group.title, `${digest}:title`),
          excerpt: {
            originalText: redact(group.originalText, `${digest}:original`),
            suggestionOrDiagnosis: redact(group.suggestionOrDiagnosis, `${digest}:suggestion`),
          },
        }
      },
    }
    for (const group of aggregate.issueGroups) {
      const prepared = productLikeRedactionContext.prepare(group)
      if (prepared === null) {
        throw new Error(`expected product-like redaction to keep ${group.type} group`)
      }
      expect(prepared.atomicTopic.taskScope, `${group.type} task scope`).toMatch(/^scope_v1_[0-9a-f]{32,64}$/)
      expect(prepared.atomicTopic.key, `${group.type} topic key`).toMatch(/^tk1\.[0-9a-f]{16}$/)
      expect(prepared.atomicTopic.fingerprintDigest, `${group.type} fingerprint digest`).toMatch(/^fp1\.[0-9a-f]{64}$/)
      expect(prepared.title.redactionVersion, `${group.type} title redaction`).toBe('class-review-redaction-v1')
      expect(prepared.excerpt?.originalText.redactionVersion, `${group.type} original redaction`).toBe('class-review-redaction-v1')
      expect(prepared.excerpt?.suggestionOrDiagnosis.redactionVersion, `${group.type} suggestion redaction`).toBe('class-review-redaction-v1')
    }
    const productLikeProjection = buildClassReviewProjection({
      aggregate,
      redactionContext: productLikeRedactionContext,
      limits: DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS,
    })
    expect(productLikeProjection.status).toBe('ready')
  })
})
