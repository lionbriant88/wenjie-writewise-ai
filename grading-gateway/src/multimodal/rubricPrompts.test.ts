import { describe, expect, it } from 'vitest'
import type { GatewayTaskMaterial } from '../multipartTaskMaterials.js'
import { buildRubricGenerationMessages, buildRubricReviewMessages, generatedRubricSchema, reviewedRubricSchema } from './rubricPrompts.js'

const materials: GatewayTaskMaterial[] = [
  { kind: 'text', unitId: 'text-1', displayName: 'prompt.docx', text: 'Source text one.' },
  { kind: 'image', unitId: 'image-1', mimeType: 'image/png', buffer: Buffer.from('first page') },
  { kind: 'text', unitId: 'text-2', displayName: 'notes.docx', text: 'Source text two.' },
]

const draft = {
  taskName: 'Draft task', materialSummary: 'Draft summary', writingRequirements: ['Draft requirement'],
  constraints: ['Draft constraint'], dimensions: [{
    id: 'content', name: 'Content', weight: 100, description: 'Draft dimension',
    deductionFocus: ['Draft deduction'], sourceEvidence: ['Draft evidence'],
  }], reviewWarnings: [],
}

describe('rubric prompts', () => {
  it('makes teacher authority, material boundaries, weights, and strict output explicit in both roles', () => {
    const generation = buildRubricGenerationMessages({
      fullScore: 15,
      writingRequirement: 'Write a news report.',
      materials,
    })
    const review = buildRubricReviewMessages({
      fullScore: 15,
      writingRequirement: 'Write a news report.',
      materials,
      draft,
    })

    for (const messages of [generation, review]) {
      const systemText = String(messages[0]?.content)
      const userParts = messages[1]?.content
      expect(systemText).toContain('非空教师写作要求是最高权威')
      expect(systemText).toContain('材料只能补充不冲突的信息')
      expect(systemText).toContain('严格 JSON Schema')
      expect(systemText).toContain('权重合计必须为 100')
      expect(systemText).toContain('不可信材料')
      expect(Array.isArray(userParts)).toBe(true)
      if (!Array.isArray(userParts) || userParts[0]?.type !== 'text') continue
      expect(userParts[0].text).toContain('Write a news report.')
      expect(userParts[0].text).toContain('教师写作要求是权威依据')
      expect(userParts[0].text).toContain('只可补充不冲突的信息')
    }
  })

  it('requires the legibility dimension with a default weight of 5', () => {
    const prompt = String(buildRubricGenerationMessages({ fullScore: 15, materials })[0].content)

    expect(prompt).toContain('legibility')
    expect(prompt).toContain('恰好包含一个')
    expect(prompt).toContain('默认权重 5')
  })

  it('keeps the same original mixed material order for generation and complete-object review', () => {
    const generation = buildRubricGenerationMessages({ fullScore: 15, materials })
    const review = buildRubricReviewMessages({ fullScore: 15, materials, draft })
    const generationParts = generation[1]?.content
    const reviewParts = review[1]?.content

    expect(Array.isArray(generationParts)).toBe(true)
    expect(Array.isArray(reviewParts)).toBe(true)
    if (!Array.isArray(generationParts) || !Array.isArray(reviewParts)) return
    expect(generationParts.slice(1)).toEqual([
      { type: 'text', text: expect.stringContaining('材料单元 text-1 开始') },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,Zmlyc3QgcGFnZQ==' } },
      { type: 'text', text: expect.stringContaining('材料单元 text-2 开始') },
    ])
    expect(reviewParts.slice(1)).toEqual(generationParts.slice(1))
    const reviewText = (review[1]?.content as Array<{ type: string, text?: string }>)[0]?.text
    expect(reviewText).toContain(JSON.stringify(draft))
    expect(String(review[0]?.content)).toContain('必须返回完整对象，不能返回补丁')
  })

  it('uses strict, complete schemas for generation and review', () => {
    for (const schema of [generatedRubricSchema, reviewedRubricSchema]) {
      expect(schema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(schema.required).toEqual([
        'taskName', 'materialSummary', 'writingRequirements', 'constraints', 'dimensions', 'reviewWarnings',
      ])
      expect(schema.properties.dimensions).toMatchObject({ type: 'array', minItems: 1 })
      expect(schema.properties.writingRequirements).toMatchObject({ type: 'array', minItems: 1 })
      expect(schema.properties.writingRequirements.items).toMatchObject({ maxLength: 10_000 })
      expect(schema.properties.dimensions.items).toMatchObject({ type: 'object', additionalProperties: false })
    }
  })
})
