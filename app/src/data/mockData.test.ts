import { describe, expect, it } from 'vitest'
import { mockGradingResults } from './mockData'

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
})
