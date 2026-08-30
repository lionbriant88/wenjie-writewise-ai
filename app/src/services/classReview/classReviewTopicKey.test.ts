import { describe, expect, it } from 'vitest'
import {
  deriveAtomicTopicKey,
  deriveCompositeTopicKey,
  createInMemoryTopicKeyRegistry,
  type AtomicTopicFingerprint,
  type TopicHmac,
} from './classReviewTopicKey'

const encoder = new TextEncoder()

function deterministicBytes(domain: string, message: Uint8Array): Uint8Array {
  const input = encoder.encode(`${domain}\u0000${Array.from(message).join(',')}`)
  let state = 0x811c9dc5
  for (const byte of input) {
    state ^= byte
    state = Math.imul(state, 0x01000193) >>> 0
  }
  const output = new Uint8Array(32)
  for (let index = 0; index < output.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    output[index] = state & 0xff
  }
  return output
}

function createTestHmac(
  digest: TopicHmac['digest'] = async (domain, message) => deterministicBytes(domain, message),
): TopicHmac {
  return {
    digest,
    registry: createInMemoryTopicKeyRegistry(),
  }
}

const baseFingerprint: AtomicTopicFingerprint = {
  opaqueTaskScope: 'scope_v1_47d0f8802ce54696b96d027a6b744871',
  type: 'grammar',
  subtype: null,
  changeTypes: ['grammar'],
  correction: {
    original: 'She go to school.',
    corrected: 'She goes to school.',
  },
  signature: 'essay-private-17|She go to school.',
}

describe('class review topic identity', () => {
  it('keeps an atomic identity stable across generations and canonical text forms', async () => {
    const deterministicHmac = createTestHmac()
    const first = await deriveAtomicTopicKey(baseFingerprint, deterministicHmac)
    const second = await deriveAtomicTopicKey({
      ...baseFingerprint,
      changeTypes: ['grammar', 'grammar'],
      correction: {
        original: '  Ｓｈｅ   ｇｏ to school.  ',
        corrected: 'SHE GOES TO SCHOOL.',
      },
      signature: '  ESSAY-PRIVATE-17|SHE   GO TO SCHOOL. ',
    }, deterministicHmac)

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      kind: 'atomic',
      keyVersion: 'topic-key-v1',
      taskScope: baseFingerprint.opaqueTaskScope,
    })
  })

  it('uses an unambiguous canonical fingerprint for exact correction boundaries', async () => {
    const deterministicHmac = createTestHmac()
    const left = await deriveAtomicTopicKey({
      ...baseFingerprint,
      correction: { original: 'ab', corrected: 'c' },
      signature: 'same',
    }, deterministicHmac)
    const right = await deriveAtomicTopicKey({
      ...baseFingerprint,
      correction: { original: 'a', corrected: 'bc' },
      signature: 'same',
    }, deterministicHmac)

    expect(right.key).not.toBe(left.key)
    expect(right.fingerprintDigest).not.toBe(left.fingerprintDigest)
  })

  it('changes atomic identity across opaque task scopes without exposing source identity or text', async () => {
    const deterministicHmac = createTestHmac()
    const first = await deriveAtomicTopicKey(baseFingerprint, deterministicHmac)
    const second = await deriveAtomicTopicKey({
      ...baseFingerprint,
      opaqueTaskScope: 'scope_v1_3be04bc73de74ad2a80a43ae5ca66f52',
    }, deterministicHmac)
    const serialized = JSON.stringify([first, second])

    expect(second.key).not.toBe(first.key)
    expect(second.fingerprintDigest).not.toBe(first.fingerprintDigest)
    expect(serialized).not.toContain('essay-private-17')
    expect(serialized).not.toContain('She go to school')
    expect(serialized).not.toContain('She goes to school')
  })

  it('returns the exact atomic identity for a single-member composite', async () => {
    const deterministicHmac = createTestHmac()
    const atomic = await deriveAtomicTopicKey(baseFingerprint, deterministicHmac)

    await expect(deriveCompositeTopicKey([atomic], deterministicHmac)).resolves.toEqual(atomic)
  })

  it('deduplicates and sorts composite members while membership changes create a new topic', async () => {
    const deterministicHmac = createTestHmac()
    const grammar = await deriveAtomicTopicKey(baseFingerprint, deterministicHmac)
    const structure = await deriveAtomicTopicKey({
      ...baseFingerprint,
      type: 'structure',
      changeTypes: ['coherence'],
      correction: null,
      signature: 'paragraph transition is missing',
    }, deterministicHmac)
    const logic = await deriveAtomicTopicKey({
      ...baseFingerprint,
      type: 'logic',
      subtype: 'missing_cause_effect',
      changeTypes: ['logic_bridge'],
      correction: null,
      signature: 'cause and effect bridge is missing',
    }, deterministicHmac)

    const forward = await deriveCompositeTopicKey(
      [grammar, structure, grammar],
      deterministicHmac,
    )
    const reverse = await deriveCompositeTopicKey([structure, grammar], deterministicHmac)
    const changed = await deriveCompositeTopicKey([structure, grammar, logic], deterministicHmac)

    expect(reverse).toEqual(forward)
    expect(forward).toMatchObject({ kind: 'composite', keyVersion: 'topic-key-v1' })
    expect(changed.key).not.toBe(forward.key)
    expect(changed.fingerprintDigest).not.toBe(forward.fingerprintDigest)
  })

  it('rejects empty, mixed-scope, mixed-version, and nested composite member sets safely', async () => {
    const deterministicHmac = createTestHmac()
    const first = await deriveAtomicTopicKey(baseFingerprint, deterministicHmac)
    const otherScope = await deriveAtomicTopicKey({
      ...baseFingerprint,
      opaqueTaskScope: 'scope_v1_3be04bc73de74ad2a80a43ae5ca66f52',
    }, deterministicHmac)
    const composite = await deriveCompositeTopicKey([
      first,
      await deriveAtomicTopicKey({ ...baseFingerprint, signature: 'another issue' }, deterministicHmac),
    ], deterministicHmac)

    await expect(deriveCompositeTopicKey([], deterministicHmac))
      .rejects.toThrow('topic_members_empty')
    await expect(deriveCompositeTopicKey([first, otherScope], deterministicHmac))
      .rejects.toThrow('topic_scope_mismatch')
    await expect(deriveCompositeTopicKey([
      first,
      { ...first, keyVersion: 'topic-key-v2' as 'topic-key-v1' },
    ], deterministicHmac)).rejects.toThrow('topic_version_mismatch')
    await expect(deriveCompositeTopicKey([first, composite], deterministicHmac))
      .rejects.toThrow('topic_member_not_atomic')
  })

  it('uses full fingerprint digests to separate forced shortened-key collisions deterministically', async () => {
    const collisionHmac = createTestHmac(async (domain, message) => {
      if (domain === 'topic-public-key-v1') return new Uint8Array(32).fill(0x2a)
      return deterministicBytes(domain, message)
    })
    const first = await deriveAtomicTopicKey(baseFingerprint, collisionHmac)
    const secondInput = { ...baseFingerprint, signature: 'a genuinely different issue' }
    const second = await deriveAtomicTopicKey(secondInput, collisionHmac)
    const secondAgain = await deriveAtomicTopicKey(secondInput, collisionHmac)

    expect(second.fingerprintDigest).not.toBe(first.fingerprintDigest)
    expect(second.key).not.toBe(first.key)
    expect(second.key).toBe(secondAgain.key)
    expect(second.key.split('.')).toHaveLength(3)
  })

  it('keeps collision claims for the coordinator registry lifetime without pretending to persist them', async () => {
    const digest: TopicHmac['digest'] = async (domain, message) => {
      if (domain === 'topic-public-key-v1') return new Uint8Array(32).fill(0x44)
      return deterministicBytes(domain, message)
    }
    const firstLifetime = createTestHmac(digest)
    const first = await deriveAtomicTopicKey(baseFingerprint, firstLifetime)
    const collisionInput = { ...baseFingerprint, signature: 'collision member two' }
    const collision = await deriveAtomicTopicKey(collisionInput, firstLifetime)
    const collisionLaterGeneration = await deriveAtomicTopicKey(collisionInput, firstLifetime)
    const newCoordinatorLifetime = createTestHmac(digest)
    const afterRestart = await deriveAtomicTopicKey(collisionInput, newCoordinatorLifetime)

    expect(collisionLaterGeneration.key).toBe(collision.key)
    expect(collision.key).not.toBe(first.key)
    expect(afterRestart.key).toBe(first.key)
    expect(afterRestart.key).not.toBe(collision.key)
  })

  it('shares one full-digest collision namespace across atomic and composite identities', async () => {
    const collisionHmac = createTestHmac(async (domain, message) => {
      if (domain === 'topic-public-key-v1') return new Uint8Array(32).fill(0x55)
      return deterministicBytes(domain, message)
    })
    const first = await deriveAtomicTopicKey(baseFingerprint, collisionHmac)
    const second = await deriveAtomicTopicKey({
      ...baseFingerprint,
      signature: 'second member for a composite topic',
    }, collisionHmac)
    const composite = await deriveCompositeTopicKey([first, second], collisionHmac)

    expect(composite.key).not.toBe(first.key)
    expect(composite.key).not.toBe(second.key)
  })

  it('rejects ordinary business task IDs where an HMAC-derived opaque scope is required', async () => {
    const deterministicHmac = createTestHmac()

    await expect(deriveAtomicTopicKey({
      ...baseFingerprint,
      opaqueTaskScope: 'task-raw-17',
    }, deterministicHmac)).rejects.toThrow('topic_input_invalid')
  })

  it('accepts exact bounded canonical components and rejects the next code point', async () => {
    const deterministicHmac = createTestHmac()
    const atLimit = 'a'.repeat(4096)
    const aboveLimit = `${atLimit}a`

    await expect(deriveAtomicTopicKey({
      ...baseFingerprint,
      signature: atLimit,
    }, deterministicHmac)).resolves.toMatchObject({ kind: 'atomic' })
    await expect(deriveAtomicTopicKey({
      ...baseFingerprint,
      signature: aboveLimit,
    }, deterministicHmac)).rejects.toThrow('topic_input_invalid')
  })

  it('rejects malformed Unicode and never includes rejected values in errors', async () => {
    const deterministicHmac = createTestHmac()
    const privateText = `private-${String.fromCharCode(0xd800)}-student`

    await expect(deriveAtomicTopicKey({
      ...baseFingerprint,
      signature: privateText,
    }, deterministicHmac)).rejects.toThrow('topic_input_invalid')
    try {
      await deriveAtomicTopicKey({ ...baseFingerprint, signature: privateText }, deterministicHmac)
      throw new Error('expected rejection')
    } catch (error) {
      expect(String(error)).not.toContain('private-')
      expect(String(error)).not.toContain('student')
    }
  })

  it('sanitizes injected HMAC failures instead of propagating canonical source content', async () => {
    const privateMarker = 'She go to school.'
    const failingHmac = createTestHmac(async () => {
      throw new Error(`crypto failed while processing ${privateMarker}`)
    })

    try {
      await deriveAtomicTopicKey(baseFingerprint, failingHmac)
      throw new Error('expected rejection')
    } catch (error) {
      expect(String(error)).toContain('topic_hmac_failed')
      expect(String(error)).not.toContain(privateMarker)
    }
  })
})
