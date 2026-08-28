import { createHash } from 'node:crypto'
import type { GatewayImageInput } from '../providers/multimodalProviderTypes.js'
import { isWellFormedUnicode } from './transcriptRange.js'
import { canonicalTaskContextJson, projectModelTaskContext } from './modelTaskContext.js'
import type { ConfirmedTaskPackageV2 } from './types.js'

const LOGICAL_REQUEST_ID_VERSION = 'logical-grade-v1'
const PAYLOAD_HASH_VERSION = 'grading-payload-v1'
const IMAGE_SOURCE_VERSION = 'essay-images-v1'
const CONFIRMED_TEXT_SOURCE_VERSION = 'essay-confirmed-text-v1'
const REQUEST_VERSION = 'multimodal-grading-request-v2'
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const INVALID_IDENTITY_MESSAGE = 'Invalid canonical grading identity input.'

export interface CanonicalGradeIdentity {
  rubricRevisionDigest: string
  essaySourceRevisionDigest: string
  logicalRequestId: string
  payloadHash: string
}

interface CanonicalGradeIdentityInput {
  task: ConfirmedTaskPackageV2
  essayId: string
  pageIds: readonly string[]
  pages: readonly GatewayImageInput[]
  confirmedTranscript?: string
}

interface IdentityVersions {
  gradingPolicyVersion: string
  providerSchemaVersion: string
}

function invalidIdentity(): never {
  throw new TypeError(INVALID_IDENTITY_MESSAGE)
}

function canonicalJson(value: unknown, ancestors: Set<object> = new Set()): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalidIdentity()
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    if (!isWellFormedUnicode(value)) return invalidIdentity()
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return invalidIdentity()
    ancestors.add(value)
    const serialized = `[${value.map((item) => canonicalJson(item, ancestors)).join(',')}]`
    ancestors.delete(value)
    return serialized
  }
  if (typeof value !== 'object') return invalidIdentity()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return invalidIdentity()
  if (ancestors.has(value)) return invalidIdentity()
  ancestors.add(value)
  const record = value as Record<string, unknown>
  const serialized = `{${Object.keys(record).sort().map((key) => {
    if (!isWellFormedUnicode(key) || record[key] === undefined) return invalidIdentity()
    return `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`
  }).join(',')}}`
  ancestors.delete(value)
  return serialized
}

function sha256Base64Url(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('base64url')
}

function assertIdentityStrings(input: CanonicalGradeIdentityInput, versions: IdentityVersions): void {
  for (const value of [
    input.task.taskId,
    input.essayId,
    versions.gradingPolicyVersion,
    versions.providerSchemaVersion,
    ...input.pageIds,
  ]) {
    if (!value || !isWellFormedUnicode(value)) invalidIdentity()
  }
}

function imageDescriptors(pages: readonly GatewayImageInput[]) {
  return pages.map((page, index) => {
    if (!Buffer.isBuffer(page.buffer) || !IMAGE_MIME_TYPES.has(page.mimeType)) invalidIdentity()
    return {
      index,
      mimeType: page.mimeType,
      byteLength: page.buffer.length,
      sha256: sha256Base64Url(page.buffer),
    }
  })
}

export function createCanonicalGradeIdentity(
  input: CanonicalGradeIdentityInput,
  versions: IdentityVersions,
): CanonicalGradeIdentity {
  assertIdentityStrings(input, versions)
  const confirmedTextMode = input.confirmedTranscript !== undefined
  if (confirmedTextMode) {
    if (input.pages.length !== 0 || input.pageIds.length !== 0 || !isWellFormedUnicode(input.confirmedTranscript ?? '')) {
      invalidIdentity()
    }
  } else if (input.pages.length === 0 || input.pages.length !== input.pageIds.length) {
    invalidIdentity()
  }

  const modelTaskContext = projectModelTaskContext(input.task)
  canonicalJson(modelTaskContext)
  const rubricRevisionDigest = sha256Base64Url(canonicalTaskContextJson(modelTaskContext))
  const descriptors = confirmedTextMode ? [] : imageDescriptors(input.pages)
  const sourceFrame = confirmedTextMode
    ? {
        version: CONFIRMED_TEXT_SOURCE_VERSION,
        mode: 'confirmed_text',
        byteLength: Buffer.byteLength(input.confirmedTranscript ?? '', 'utf8'),
        sha256: sha256Base64Url(Buffer.from(input.confirmedTranscript ?? '', 'utf8')),
      }
    : { version: IMAGE_SOURCE_VERSION, mode: 'images', pages: descriptors }
  const essaySourceRevisionDigest = sha256Base64Url(canonicalJson(sourceFrame))

  const logicalDigest = sha256Base64Url(canonicalJson({
    version: LOGICAL_REQUEST_ID_VERSION,
    taskId: input.task.taskId,
    essayId: input.essayId,
    essaySourceRevisionDigest,
    rubricRevisionDigest,
    gradingPolicyVersion: versions.gradingPolicyVersion,
    providerSchemaVersion: versions.providerSchemaVersion,
  }))

  const payloadHash = sha256Base64Url(canonicalJson({
    version: PAYLOAD_HASH_VERSION,
    requestVersion: REQUEST_VERSION,
    essayId: input.essayId,
    pageIds: [...input.pageIds],
    task: input.task,
    source: confirmedTextMode
      ? { mode: 'confirmed_text', confirmedTranscript: input.confirmedTranscript }
      : { mode: 'images', pages: descriptors },
  }))

  return {
    rubricRevisionDigest,
    essaySourceRevisionDigest,
    logicalRequestId: `${LOGICAL_REQUEST_ID_VERSION}:${logicalDigest}`,
    payloadHash,
  }
}
