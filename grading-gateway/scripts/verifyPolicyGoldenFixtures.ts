import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const policyFixtureNames = [
  'ambiguous-work',
  'clear-enviroment',
  'ambiguous-cant',
  'grammar-and-logic',
] as const

type PolicyFixtureName = typeof policyFixtureNames[number]
type VerificationResult = { ok: true } | { ok: false; reason: 'invalid_png_signature' | 'dimension_mismatch' | 'length_mismatch' | 'hash_mismatch' }

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const canonicalFixtures: Record<PolicyFixtureName, { width: number; height: number; length: number; sha256: string }> = {
  'ambiguous-work': { width: 1200, height: 700, length: 19490, sha256: 'd5dc34ba61e4a5d42ed48c14969f7d54057348b9ee91888a7eb7a223640c9d29' },
  'clear-enviroment': { width: 1200, height: 700, length: 24820, sha256: 'f6b730bfedd6e604ea7c2e75d5666535b9f65e479d1b6742416ced49e23fe75f' },
  'ambiguous-cant': { width: 1200, height: 700, length: 21692, sha256: '40f48114164351456c8a4ab0020172014f1fd62b5d83b38949b1c537c6a0e138' },
  'grammar-and-logic': { width: 1200, height: 700, length: 44739, sha256: 'f5efcdb5ff50e91537df5fc6732568f07eda9787651020a263331707409d4011' },
}

function fixtureDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../test-fixtures/kimi-policy')
}

export function fixturePngPath(name: PolicyFixtureName): string {
  return resolve(fixtureDirectory(), `${name}.png`)
}

export function verifyCanonicalPolicyFixture(name: PolicyFixtureName, png: Buffer): VerificationResult {
  const expected = canonicalFixtures[name]
  if (png.length < 24 || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return { ok: false, reason: 'invalid_png_signature' }
  if (png.readUInt32BE(16) !== expected.width || png.readUInt32BE(20) !== expected.height) return { ok: false, reason: 'dimension_mismatch' }
  if (png.length !== expected.length) return { ok: false, reason: 'length_mismatch' }
  if (createHash('sha256').update(png).digest('hex') !== expected.sha256) return { ok: false, reason: 'hash_mismatch' }
  return { ok: true }
}

export async function verifyPolicyGoldenFixtures(): Promise<boolean> {
  for (const name of policyFixtureNames) {
    if (!(verifyCanonicalPolicyFixture(name, await readFile(fixturePngPath(name))).ok)) return false
  }
  return true
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void verifyPolicyGoldenFixtures().then((ok) => { process.exitCode = ok ? 0 : 1 }).catch(() => { process.exitCode = 1 })
}
