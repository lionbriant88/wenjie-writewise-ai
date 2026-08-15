import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { fixturePngPath, fixtureSvgPath, policyFixtureNames, renderFixturePng } from './renderPolicyGoldenFixtures.js'

describe('policy fixture renderer', () => {
  it.each(policyFixtureNames)('keeps %s PNG byte-identical to its deterministic SVG rendering', async (name) => {
    const [svg, png] = await Promise.all([
      readFile(fixtureSvgPath(name)),
      readFile(fixturePngPath(name)),
    ])

    expect(renderFixturePng(svg)).toEqual(png)
  })
})
