import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

export const policyFixtureNames = [
  'ambiguous-work',
  'clear-enviroment',
  'ambiguous-cant',
  'grammar-and-logic',
] as const

function fixtureDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../test-fixtures/kimi-policy')
}

export function fixtureSvgPath(name: typeof policyFixtureNames[number]): string {
  return resolve(fixtureDirectory(), `${name}.svg`)
}

export function fixturePngPath(name: typeof policyFixtureNames[number]): string {
  return resolve(fixtureDirectory(), `${name}.png`)
}

export function renderFixturePng(svg: Buffer): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: true } }).render().asPng()
}

export async function renderPolicyGoldenFixtures(): Promise<void> {
  for (const name of policyFixtureNames) {
    await writeFile(fixturePngPath(name), renderFixturePng(await readFile(fixtureSvgPath(name))))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void renderPolicyGoldenFixtures()
}
