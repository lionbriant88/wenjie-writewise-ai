const REDACTION_VERSION = 'class-review-redaction-v1' as const
const DETECTOR_VERSION = 'person-entity-detector-v1' as const
const PLACEHOLDER = '[REDACTED]'
const MAX_SOURCE_CODE_POINTS = 4096

export type RedactionOmissionReason =
  | 'malformed_input'
  | 'input_too_long'
  | 'unsafe_format'
  | 'prompt_injection'
  | 'entity_uncertain'
  | 'entity_detector_invalid'
  | 'residual_identifier'
  | 'meaning_destroyed'
  | 'invalid_evidence_key'

export interface PersonEntityHit {
  start: number
  end: number
  certainty: 'certain' | 'uncertain'
}

export interface PersonEntityDetector {
  detectorVersion: typeof DETECTOR_VERSION
  detect(text: string): readonly PersonEntityHit[]
}

export interface RedactionKnownNames {
  students: readonly string[]
  defaultStudentLabels: readonly string[]
  teachers: readonly string[]
  classNames: readonly string[]
  schoolNames: readonly string[]
  taskNames: readonly string[]
}

export interface RedactionInput {
  sourceText: string
  knownNames: RedactionKnownNames
  entityDetector: PersonEntityDetector
  scrubbedEvidenceKey: string
}

export type RedactionResult =
  | {
      status: 'kept'
      text: string
      redactionVersion: typeof REDACTION_VERSION
      scrubbedEvidenceKey: string
    }
  | {
      status: 'omitted'
      reason: RedactionOmissionReason
      redactionVersion: typeof REDACTION_VERSION
    }

type ScanResult = 'ok' | 'malformed' | 'too_long'

const EMAIL = /[\p{L}\p{N}][\p{L}\p{N}._%+-]{0,63}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu
const URL = /(?:https?:\/\/|www\.)[^\s<>{}[\]"']+/giu
const PHONE = /(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d){8}/gu
const LABELLED_ID = /(?:学号|学生编号|身份证号|证件号|student\s*(?:id|number)|identity\s*(?:id|number))\s*[:：]?\s*[A-Za-z0-9-]{4,32}/giu
const SOCIAL_ACCOUNT = /(?:微信|wechat|qq|社交账号|账号|account)\s*[:：]?\s*@?[A-Za-z0-9_.-]{3,64}/giu
const SOCIAL_HANDLE = /@[A-Za-z][A-Za-z0-9_.-]{2,63}/gu
const CONTINUOUS_DIGITS = /\d{6,}/gu
const FORMAT_CONTROL = /\p{Cf}/u
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u

function omitted(reason: RedactionOmissionReason): RedactionResult {
  return { status: 'omitted', reason, redactionVersion: REDACTION_VERSION }
}

function scanCodePoints(value: string, maximum: number): ScanResult {
  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return 'malformed'
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return 'malformed'
    }
    count += 1
    if (count > maximum) return 'too_long'
  }
  return 'ok'
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function hasPromptInjection(value: string): boolean {
  const normalized = asciiLower(value)
  return /ignore\s+(?:all\s+)?previous\s+instructions?/u.test(normalized)
    || /(?:reveal|show|print|output)\s+(?:the\s+)?system\s+prompt/u.test(normalized)
    || /you\s+are\s+(?:chatgpt|an?\s+ai|the\s+system)/u.test(normalized)
    || /follow\s+(?:my|the)\s+(?:next\s+)?instructions?/u.test(normalized)
    || /请?忽略(?:以上|此前|之前|所有)?指令/u.test(normalized)
    || /(?:输出|显示|泄露)(?:系统)?提示词/u.test(normalized)
}

function isBoundaryCodePoint(value: string | undefined): boolean {
  return value !== undefined && LETTER_OR_NUMBER.test(value)
}

function isAsciiIdentifierCodePoint(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value)
}

function previousCodePoint(value: string, index: number): string | undefined {
  if (index <= 0) return undefined
  const unit = value.charCodeAt(index - 1)
  if (unit >= 0xdc00 && unit <= 0xdfff && index >= 2) return value.slice(index - 2, index)
  return value[index - 1]
}

function nextCodePoint(value: string, index: number): string | undefined {
  if (index >= value.length) return undefined
  const unit = value.charCodeAt(index)
  if (unit >= 0xd800 && unit <= 0xdbff) return value.slice(index, index + 2)
  return value[index]
}

function replaceKnownName(value: string, rawName: string): string {
  const name = normalizeText(rawName)
  if (name.length === 0) return value
  const lowerValue = asciiLower(value)
  const lowerName = asciiLower(name)
  const usesLatinBoundary = /[A-Za-z]/.test(name)
  let cursor = 0
  let output = ''
  let changed = false
  while (cursor < value.length) {
    const match = lowerValue.indexOf(lowerName, cursor)
    if (match < 0) break
    const end = match + name.length
    const boundarySafe = !usesLatinBoundary || (
      !isBoundaryCodePoint(previousCodePoint(value, match))
      && !isBoundaryCodePoint(nextCodePoint(value, end))
    )
    if (!boundarySafe) {
      output += value.slice(cursor, match + 1)
      cursor = match + 1
      continue
    }
    output += value.slice(cursor, match) + PLACEHOLDER
    cursor = end
    changed = true
  }
  return changed ? output + value.slice(cursor) : value
}

function normalizedKnownNames(input: RedactionKnownNames): string[] | null {
  const values = [
    input.students,
    input.defaultStudentLabels,
    input.teachers,
    input.classNames,
    input.schoolNames,
    input.taskNames,
  ]
  if (values.some((items) => !Array.isArray(items))) return null
  const normalized: string[] = []
  for (const items of values) {
    for (const item of items) {
      if (typeof item !== 'string' || scanCodePoints(item, 256) !== 'ok') return null
      const value = normalizeText(item)
      if (value.length > 0) normalized.push(value)
    }
  }
  return Array.from(new Set(normalized)).sort((left, right) => (
    Array.from(right).length - Array.from(left).length
    || (left === right ? 0 : left < right ? -1 : 1)
  ))
}

function replaceStructuredPii(value: string): string {
  return value
    .replace(URL, PLACEHOLDER)
    .replace(EMAIL, PLACEHOLDER)
    .replace(PHONE, PLACEHOLDER)
    .replace(LABELLED_ID, PLACEHOLDER)
    .replace(SOCIAL_ACCOUNT, PLACEHOLDER)
    .replace(SOCIAL_HANDLE, PLACEHOLDER)
    .replace(CONTINUOUS_DIGITS, PLACEHOLDER)
}

function containsStructuredPii(value: string): boolean {
  const patterns = [URL, EMAIL, PHONE, LABELLED_ID, SOCIAL_ACCOUNT, SOCIAL_HANDLE, CONTINUOUS_DIGITS]
  return patterns.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(value)
  })
}

function validateHits(hits: readonly PersonEntityHit[], text: string): PersonEntityHit[] | null {
  if (!Array.isArray(hits)) return null
  const sorted = [...hits].sort((left, right) => left.start - right.start || left.end - right.end)
  let previousEnd = -1
  for (const hit of sorted) {
    if (
      !hit
      || !Number.isSafeInteger(hit.start)
      || !Number.isSafeInteger(hit.end)
      || hit.start < 0
      || hit.end <= hit.start
      || hit.end > text.length
      || hit.start < previousEnd
      || (hit.certainty !== 'certain' && hit.certainty !== 'uncertain')
      || (hit.start > 0 && /[\uDC00-\uDFFF]/.test(text[hit.start]))
      || (hit.end < text.length && /[\uDC00-\uDFFF]/.test(text[hit.end]))
    ) return null
    previousEnd = hit.end
  }
  return sorted
}

function replaceEntityHits(
  text: string,
  hits: readonly PersonEntityHit[],
): { text: string; cutIdentifier: boolean } {
  let cursor = 0
  let output = ''
  let cutIdentifier = false
  for (const hit of hits) {
    if (
      isAsciiIdentifierCodePoint(previousCodePoint(text, hit.start))
      || isAsciiIdentifierCodePoint(nextCodePoint(text, hit.end))
    ) cutIdentifier = true
    output += text.slice(cursor, hit.start) + PLACEHOLDER
    cursor = hit.end
  }
  return { text: output + text.slice(cursor), cutIdentifier }
}

function containsKnownName(value: string, names: readonly string[]): boolean {
  return names.some((name) => replaceKnownName(value, name) !== value)
}

function hasEnoughMeaning(value: string): boolean {
  const remainder = normalizeText(value.replaceAll(PLACEHOLDER, ''))
  let count = 0
  let hasLetterOrNumber = false
  for (const codePoint of remainder) {
    count += 1
    if (!hasLetterOrNumber && LETTER_OR_NUMBER.test(codePoint)) hasLetterOrNumber = true
  }
  return count >= 8 && hasLetterOrNumber
}

export function redactClassReviewExcerpt(input: RedactionInput): RedactionResult {
  if (!input || typeof input !== 'object' || typeof input.sourceText !== 'string') {
    return omitted('malformed_input')
  }
  const scan = scanCodePoints(input.sourceText, MAX_SOURCE_CODE_POINTS)
  if (scan === 'malformed') return omitted('malformed_input')
  if (scan === 'too_long') return omitted('input_too_long')
  if (
    typeof input.scrubbedEvidenceKey !== 'string'
    || !/^scrub_v1_[0-9a-f]{32,64}$/.test(input.scrubbedEvidenceKey)
  ) return omitted('invalid_evidence_key')

  const text = normalizeText(input.sourceText)
  if (FORMAT_CONTROL.test(text)) return omitted('unsafe_format')
  if (hasPromptInjection(text)) return omitted('prompt_injection')
  const names = normalizedKnownNames(input.knownNames)
  if (!names) return omitted('malformed_input')

  let scrubbed = text
  for (const name of names) scrubbed = replaceKnownName(scrubbed, name)
  scrubbed = replaceStructuredPii(scrubbed)

  if (
    !input.entityDetector
    || input.entityDetector.detectorVersion !== DETECTOR_VERSION
    || typeof input.entityDetector.detect !== 'function'
  ) return omitted('entity_detector_invalid')
  let rawHits: readonly PersonEntityHit[]
  try {
    rawHits = input.entityDetector.detect(scrubbed)
  } catch {
    return omitted('entity_detector_invalid')
  }
  const hits = validateHits(rawHits, scrubbed)
  if (!hits) return omitted('entity_detector_invalid')
  if (hits.some((hit) => hit.certainty === 'uncertain')) return omitted('entity_uncertain')
  const replacedEntities = replaceEntityHits(scrubbed, hits)
  scrubbed = replacedEntities.text
  if (replacedEntities.cutIdentifier) return omitted('residual_identifier')

  if (
    FORMAT_CONTROL.test(scrubbed)
    || hasPromptInjection(scrubbed)
    || containsKnownName(scrubbed, names)
    || containsStructuredPii(scrubbed)
  ) return omitted('residual_identifier')
  let residualHits: readonly PersonEntityHit[]
  try {
    residualHits = input.entityDetector.detect(scrubbed)
  } catch {
    return omitted('entity_detector_invalid')
  }
  const validatedResidualHits = validateHits(residualHits, scrubbed)
  if (!validatedResidualHits) return omitted('entity_detector_invalid')
  if (validatedResidualHits.length > 0) return omitted('residual_identifier')
  if (!hasEnoughMeaning(scrubbed)) return omitted('meaning_destroyed')

  return {
    status: 'kept',
    text: scrubbed,
    redactionVersion: REDACTION_VERSION,
    scrubbedEvidenceKey: input.scrubbedEvidenceKey,
  }
}
