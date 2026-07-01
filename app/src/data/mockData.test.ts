import { describe, expect, it } from 'vitest'
import { mockEssays, mockGradingResults } from './mockData'

describe('mock grading result consistency', () => {
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
        const relatedErrorId = (revision as { relatedErrorId?: string }).relatedErrorId
        const annotation = relatedErrorId ? annotationsById.get(relatedErrorId) : undefined

        expect(
          relatedErrorId,
          `${result.id}/${revision.id} should reference an error annotation`,
        ).toBeTruthy()
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
})
