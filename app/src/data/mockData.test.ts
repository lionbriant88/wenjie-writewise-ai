import { describe, expect, it } from 'vitest'
import { mockEssays, mockGradingResults } from './mockData'

describe('mock grading result consistency', () => {
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
    }
  })
})
