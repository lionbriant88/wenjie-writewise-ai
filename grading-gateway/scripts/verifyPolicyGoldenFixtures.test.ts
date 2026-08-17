import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  policyFixtureNames,
  fixturePngPath,
  verifyCanonicalPolicyFixture,
} from './verifyPolicyGoldenFixtures.js'

describe('canonical policy PNG verification', () => {
  it.each(policyFixtureNames)('accepts committed %s bytes with the fixed signature, dimensions, length, and hash', async (name) => {
    expect(verifyCanonicalPolicyFixture(name, await readFile(fixturePngPath(name)))).toEqual({ ok: true })
  })

  it('fails when canonical PNG content changes', async () => {
    const bytes = Buffer.from(await readFile(fixturePngPath('ambiguous-work')))
    bytes[100] = bytes[100]! ^ 0xff
    expect(verifyCanonicalPolicyFixture('ambiguous-work', bytes)).toEqual({ ok: false, reason: 'hash_mismatch' })
  })

  it('fails before hashing when the PNG signature changes', async () => {
    const bytes = Buffer.from(await readFile(fixturePngPath('ambiguous-work')))
    bytes[0] = 0
    expect(verifyCanonicalPolicyFixture('ambiguous-work', bytes)).toEqual({ ok: false, reason: 'invalid_png_signature' })
  })

  it('fails before hashing when canonical dimensions change', async () => {
    const bytes = Buffer.from(await readFile(fixturePngPath('ambiguous-work')))
    bytes.writeUInt32BE(1199, 16)
    expect(verifyCanonicalPolicyFixture('ambiguous-work', bytes)).toEqual({ ok: false, reason: 'dimension_mismatch' })
  })
})
