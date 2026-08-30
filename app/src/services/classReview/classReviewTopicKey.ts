import type { ClassReviewIssueAggregate } from './aggregateClassReview'

const KEY_VERSION = 'topic-key-v1' as const
const MAX_COMPONENT_CODE_POINTS = 4096
const MAX_CHANGE_TYPES = 20
const MAX_OPAQUE_LENGTH = 128
const encoder = new TextEncoder()

export type TopicHmacDomain =
  | 'topic-fingerprint-v1'
  | 'topic-public-key-v1'
  | 'topic-collision-suffix-v1'

export interface TopicKeyClaim {
  taskScope: string
  keyVersion: typeof KEY_VERSION
  kind: TopicIdentity['kind']
  shortenedKey: string
  fingerprintDigest: string
  collisionSuffix: string
}

export interface TopicKeyRegistry {
  claim(input: TopicKeyClaim): Promise<string>
}

export interface TopicHmac {
  digest(domain: TopicHmacDomain, message: Uint8Array): Promise<Uint8Array>
  registry: TopicKeyRegistry
}

export interface AtomicTopicFingerprint {
  opaqueTaskScope: string
  type: ClassReviewIssueAggregate['type']
  subtype: ClassReviewIssueAggregate['subtype']
  changeTypes: readonly string[]
  correction: {
    original: string
    corrected: string
  } | null
  signature: string
}

export interface TopicIdentity {
  kind: 'atomic' | 'composite'
  keyVersion: typeof KEY_VERSION
  taskScope: string
  key: string
  fingerprintDigest: string
}

function fail(code: string): never {
  throw new Error(code)
}

function isWellFormedAndBounded(value: string, maximum: number): boolean {
  let codePoints = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
    codePoints += 1
    if (codePoints > maximum) return false
  }
  return true
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

function normalizeComponent(value: string): string {
  if (!isWellFormedAndBounded(value, MAX_COMPONENT_CODE_POINTS)) {
    return fail('topic_input_invalid')
  }
  const normalized = asciiLower(value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  if (normalized.length === 0) return fail('topic_input_invalid')
  return normalized
}

function validateOpaque(value: string): void {
  if (
    !isWellFormedAndBounded(value, MAX_OPAQUE_LENGTH)
    || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value)
  ) fail('topic_input_invalid')
}

function validateTaskScope(value: string): void {
  validateOpaque(value)
  if (!/^scope_v1_[0-9a-f]{32,64}$/.test(value)) return fail('topic_input_invalid')
}

function compareCodePoints(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function bytesToHex(value: Uint8Array): string {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    return fail('topic_hmac_invalid')
  }
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) return fail('topic_identity_invalid')
  const output = new Uint8Array(32)
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return output
}

function digestHex(value: string): string {
  if (!value.startsWith('fp1.') || !/^[0-9a-f]{64}$/.test(value.slice(4))) {
    return fail('topic_identity_invalid')
  }
  return value.slice(4)
}

function encodeCanonical(value: readonly unknown[]): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

async function safeDigest(
  hmac: TopicHmac,
  domain: TopicHmacDomain,
  message: Uint8Array,
): Promise<Uint8Array> {
  try {
    return await hmac.digest(domain, message)
  } catch {
    return fail('topic_hmac_failed')
  }
}

async function deriveIdentity(
  kind: TopicIdentity['kind'],
  taskScope: string,
  canonical: readonly unknown[],
  hmac: TopicHmac,
): Promise<TopicIdentity> {
  validateTaskScope(taskScope)
  if (!hmac || typeof hmac.digest !== 'function' || !hmac.registry) {
    return fail('topic_hmac_invalid')
  }
  const fingerprintHex = bytesToHex(
    await safeDigest(hmac, 'topic-fingerprint-v1', encodeCanonical(canonical)),
  )
  const fingerprintDigest = `fp1.${fingerprintHex}`
  const digestBytes = hexToBytes(fingerprintHex)
  const publicKeyHex = bytesToHex(await safeDigest(hmac, 'topic-public-key-v1', digestBytes))
  const suffixHex = bytesToHex(
    await safeDigest(hmac, 'topic-collision-suffix-v1', digestBytes),
  )
  const shortenedKey = `tk1.${publicKeyHex.slice(0, 16)}`
  let key: string
  try {
    key = await hmac.registry.claim({
      taskScope,
      keyVersion: KEY_VERSION,
      kind,
      shortenedKey,
      fingerprintDigest,
      collisionSuffix: suffixHex.slice(0, 12),
    })
  } catch {
    return fail('topic_registry_failed')
  }
  validateOpaque(key)
  return { kind, keyVersion: KEY_VERSION, taskScope, key, fingerprintDigest }
}

export function createInMemoryTopicKeyRegistry(): TopicKeyRegistry {
  const claims = new Map<string, Map<string, string>>()
  return {
    async claim(input): Promise<string> {
      validateTaskScope(input.taskScope)
      validateOpaque(input.shortenedKey)
      validateOpaque(input.fingerprintDigest)
      validateOpaque(input.collisionSuffix)
      if (input.keyVersion !== KEY_VERSION) return fail('topic_version_mismatch')
      if (input.kind !== 'atomic' && input.kind !== 'composite') {
        return fail('topic_identity_invalid')
      }
      const claimScope = JSON.stringify([
        input.taskScope,
        input.keyVersion,
        input.shortenedKey,
      ])
      let claimedDigests = claims.get(claimScope)
      if (!claimedDigests) {
        claimedDigests = new Map()
        claims.set(claimScope, claimedDigests)
      }
      const existing = claimedDigests.get(input.fingerprintDigest)
      if (existing) return existing
      if (claimedDigests.size === 0) {
        claimedDigests.set(input.fingerprintDigest, input.shortenedKey)
        return input.shortenedKey
      }

      let collisionKey = `${input.shortenedKey}.${input.collisionSuffix}`
      let discriminator = 2
      const usedKeys = new Set(claimedDigests.values())
      while (usedKeys.has(collisionKey)) {
        collisionKey = `${input.shortenedKey}.${input.collisionSuffix}.${discriminator}`
        discriminator += 1
      }
      claimedDigests.set(input.fingerprintDigest, collisionKey)
      return collisionKey
    },
  }
}

export async function deriveAtomicTopicKey(
  input: AtomicTopicFingerprint,
  hmac: TopicHmac,
): Promise<TopicIdentity> {
  if (!input || typeof input !== 'object') return fail('topic_input_invalid')
  validateTaskScope(input.opaqueTaskScope)
  const allowedTypes = new Set(['grammar', 'spelling', 'word_choice', 'structure', 'logic'])
  if (!allowedTypes.has(input.type)) return fail('topic_input_invalid')
  const subtype = input.subtype === null ? null : normalizeComponent(input.subtype)
  if (!Array.isArray(input.changeTypes) || input.changeTypes.length > MAX_CHANGE_TYPES) {
    return fail('topic_input_invalid')
  }
  const changeTypes = Array.from(new Set(input.changeTypes.map(normalizeComponent)))
    .sort(compareCodePoints)
  const correction = input.correction === null
    ? null
    : [
        normalizeComponent(input.correction.original),
        normalizeComponent(input.correction.corrected),
      ]
  const signature = normalizeComponent(input.signature)
  const canonical = [
    KEY_VERSION,
    'atomic',
    input.opaqueTaskScope,
    input.type,
    subtype,
    changeTypes,
    correction,
    signature,
  ] as const
  return deriveIdentity('atomic', input.opaqueTaskScope, canonical, hmac)
}

function validateIdentity(identity: TopicIdentity): void {
  if (!identity || typeof identity !== 'object') return fail('topic_identity_invalid')
  validateTaskScope(identity.taskScope)
  validateOpaque(identity.key)
  validateOpaque(identity.fingerprintDigest)
  digestHex(identity.fingerprintDigest)
}

export async function deriveCompositeTopicKey(
  members: readonly TopicIdentity[],
  hmac: TopicHmac,
): Promise<TopicIdentity> {
  if (!Array.isArray(members) || members.length === 0) return fail('topic_members_empty')
  for (const member of members) validateIdentity(member)
  const first = members[0]
  for (const member of members) {
    if (member.keyVersion !== first.keyVersion) return fail('topic_version_mismatch')
    if (member.taskScope !== first.taskScope) return fail('topic_scope_mismatch')
    if (member.kind !== 'atomic') return fail('topic_member_not_atomic')
  }
  if (first.keyVersion !== KEY_VERSION) return fail('topic_version_mismatch')

  const unique = new Map<string, TopicIdentity>()
  for (const member of members) {
    unique.set(JSON.stringify([member.key, member.fingerprintDigest]), member)
  }
  const sorted = Array.from(unique.values()).sort((left, right) => (
    compareCodePoints(left.key, right.key)
    || compareCodePoints(left.fingerprintDigest, right.fingerprintDigest)
  ))
  if (sorted.length === 1) return sorted[0]

  const canonical = [
    KEY_VERSION,
    'composite',
    first.taskScope,
    sorted.map((member) => [member.key, member.fingerprintDigest]),
  ] as const
  return deriveIdentity('composite', first.taskScope, canonical, hmac)
}
