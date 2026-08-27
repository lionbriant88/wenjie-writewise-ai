import { describe, expect, it } from 'vitest'
import type { GatewayTaskMaterial } from '../multipartTaskMaterials.js'
import { buildMaterialContextMessages, materialContextSchema } from './materialContextPrompts.js'

const materials: GatewayTaskMaterial[] = [
  { kind: 'text', unitId: 'text-1', displayName: 'prompt.docx', text: 'Supplementary prompt.' },
  { kind: 'image', unitId: 'image-1', mimeType: 'image/webp', buffer: Buffer.from('image bytes') },
]

describe('material context prompts', () => {
  it('puts authoritative teacher text before the ordered source materials', () => {
    const messages = buildMaterialContextMessages({
      fullScore: 25,
      writingRequirement: 'Write a formal email.',
      materials,
    })
    const systemText = String(messages[0]?.content)
    const userParts = messages[1]?.content

    expect(systemText).toContain('非空教师写作要求是最高权威')
    expect(systemText).toContain('材料只能补充不冲突的信息')
    expect(systemText).toContain('严格 JSON Schema')
    expect(Array.isArray(userParts)).toBe(true)
    if (!Array.isArray(userParts)) return
    expect(userParts.map((part) => part.type)).toEqual(['text', 'text', 'image_url'])
    expect(userParts[0]).toMatchObject({ type: 'text' })
    if (userParts[0]?.type !== 'text') return
    expect(userParts[0].text).toContain('25')
    expect(userParts[0].text).toContain('Write a formal email.')
    expect(userParts[0].text).toContain('教师写作要求是权威依据')
    expect(userParts[0].text).toContain('只可补充不冲突的信息')
    expect(userParts[1]).toMatchObject({ type: 'text', text: expect.stringContaining('材料单元 text-1 开始') })
    expect(userParts[2]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/webp;base64,aW1hZ2UgYnl0ZXM=' },
    })
  })

  it('uses the strict four-field material-context schema', () => {
    expect(materialContextSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['materialSummary', 'writingRequirements', 'constraints', 'reviewWarnings'],
    })
    expect(Object.keys(materialContextSchema.properties)).toEqual([
      'materialSummary', 'writingRequirements', 'constraints', 'reviewWarnings',
    ])
  })
})
