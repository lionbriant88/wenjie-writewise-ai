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

const EMAIL_CANDIDATE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu
const URL_CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>{}[\]"']+/giu
const PHONE_CANDIDATE = /(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d){8,}/gu
const LABELLED_ID_CANDIDATE = /(?:学号|学生编号|身份证号|证件号|student\s*(?:id|number)|identity\s*(?:id|number))\s*[:：]?\s*(?<identifier>[\p{L}\p{N}\p{M}_.+-]+)/giu
const SOCIAL_ACCOUNT_CANDIDATE = /(?:微信|wechat|qq|社交账号|账号|account)\s*[:：]?\s*(?<account>[@\p{L}\p{N}\p{M}_.+-]+)/giu
const SOCIAL_HANDLE_CANDIDATE = /@(?<handle>[\p{L}\p{N}\p{M}_.+-]+)/gu
const AT_TOKEN_CODE_POINT = /[@\p{L}\p{N}\p{M}_.+-]/u
const COMPLETE_AT_EMAIL = /^(?<local>[\p{L}\p{N}][\p{L}\p{N}\p{M}._+-]*)@(?<domain>[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+)$/u
const COMPLETE_AT_HANDLE = /^@(?<handle>[\p{L}\p{N}][\p{L}\p{N}\p{M}_.+-]*)$/u
const CONTINUOUS_DIGITS_CANDIDATE = /\d{6,}/gu
const FORMAT_CONTROL = /\p{Cf}/u
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const LATIN_SCRIPT = /\p{Script=Latin}/u
const COMBINING_MARK = /\p{M}/u

interface StructuredSpan {
  start: number
  end: number
}

interface StructuredScan {
  spans: StructuredSpan[]
  overlong: boolean
}

interface FoldedSourceRange {
  sourceStart: number
  sourceEnd: number
}

interface FoldedText {
  text: string
  sourceRanges: FoldedSourceRange[]
}

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

function foldUnicodeWithSourceMap(value: string): FoldedText | null {
  if (scanCodePoints(value, MAX_SOURCE_CODE_POINTS) !== 'ok') return null
  let text = ''
  const sourceRanges: FoldedSourceRange[] = []
  for (let sourceStart = 0; sourceStart < value.length;) {
    const sourceCodePoint = nextCodePoint(value, sourceStart)
    if (sourceCodePoint === undefined) return null
    const sourceEnd = sourceStart + sourceCodePoint.length
    const foldedCodePoint = sourceCodePoint.toUpperCase().toLowerCase()
    if (foldedCodePoint.length === 0 || scanCodePoints(foldedCodePoint, 8) !== 'ok') return null
    text += foldedCodePoint
    for (let index = 0; index < foldedCodePoint.length; index += 1) {
      sourceRanges.push({ sourceStart, sourceEnd })
    }
    sourceStart = sourceEnd
  }
  if (sourceRanges.length !== text.length) return null
  return { text, sourceRanges }
}

function hasPromptInjection(value: string): boolean {
  const normalized = asciiLower(normalizeText(value.replaceAll(PLACEHOLDER, ' ')))
  return /(?:ignore|disregard|forget|override|bypass)\s+(?:(?:the\s+)?(?:previous|prior|above|all)\s+){1,2}(?:instructions?|prompts?|rules?)/u.test(normalized)
    || /(?:reveal|disclose|show|print|leak|output)\s+(?:the\s+)?(?:hidden|system|developer)(?:\s+(?:hidden|system|developer))*\s+(?:prompts?|messages?|instructions?)/u.test(normalized)
    || /you\s+are\s+now\s+(?:the\s+)?(?:system|developer)(?:\s+role)?/u.test(normalized)
    || /act\s+as\s+(?:the\s+)?(?:system|developer)(?:\s+role)?/u.test(normalized)
    || /switch\s+to\s+(?:the\s+)?(?:system|developer)(?:\s+role)?/u.test(normalized)
    || /you\s+are\s+(?:chatgpt|an?\s+ai|the\s+system)/u.test(normalized)
    || /follow\s+(?:my|the)\s+(?:next\s+)?instructions?/u.test(normalized)
    || /请?(?:忽略|无视|忘记|覆盖|绕过)(?:此前|之前|以上|所有)(?:指令|提示|规则)/u.test(normalized)
    || /(?:泄露|显示|输出|打印)(?:系统|开发者|隐藏)(?:提示|消息|指令)(?:词)?/u.test(normalized)
    || /(?:你现在是|切换为|扮演)(?:系统|开发者)(?:角色)?/u.test(normalized)
}

function isLatinTokenContinuation(value: string | undefined): boolean {
  return value !== undefined && (
    LATIN_SCRIPT.test(value)
    || COMBINING_MARK.test(value)
    || /[0-9_]/u.test(value)
  )
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

function replaceKnownName(value: string, rawName: string): string | null {
  const name = normalizeText(rawName)
  if (name.length === 0) return value
  const foldedValue = foldUnicodeWithSourceMap(value)
  const foldedName = foldUnicodeWithSourceMap(name)
  if (!foldedValue || !foldedName || foldedName.text.length === 0) return null
  const usesLatinBoundary = LATIN_SCRIPT.test(name)
  let foldedCursor = 0
  let sourceCursor = 0
  let output = ''
  let changed = false
  while (foldedCursor < foldedValue.text.length) {
    const match = foldedValue.text.indexOf(foldedName.text, foldedCursor)
    if (match < 0) break
    const foldedEnd = match + foldedName.text.length
    const firstRange = foldedValue.sourceRanges[match]
    const lastRange = foldedValue.sourceRanges[foldedEnd - 1]
    if (!firstRange || !lastRange) return null
    const startsAtSourceBoundary = match === 0
      || foldedValue.sourceRanges[match - 1].sourceEnd <= firstRange.sourceStart
    const endsAtSourceBoundary = foldedEnd === foldedValue.text.length
      || foldedValue.sourceRanges[foldedEnd].sourceStart >= lastRange.sourceEnd
    if (!startsAtSourceBoundary || !endsAtSourceBoundary) return null
    const start = firstRange.sourceStart
    const end = lastRange.sourceEnd
    const boundarySafe = !usesLatinBoundary || (
      !isLatinTokenContinuation(previousCodePoint(value, start))
      && !isLatinTokenContinuation(nextCodePoint(value, end))
    )
    if (!boundarySafe) {
      foldedCursor = match + 1
      continue
    }
    output += value.slice(sourceCursor, start) + PLACEHOLDER
    sourceCursor = end
    foldedCursor = foldedEnd
    changed = true
  }
  return changed ? output + value.slice(sourceCursor) : value
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

function codePointLength(value: string): number {
  return Array.from(value).length
}

function collectCandidates(
  value: string,
  pattern: RegExp,
  isSafe: (match: RegExpMatchArray) => boolean,
  spans: StructuredSpan[],
): boolean {
  let overlong = false
  pattern.lastIndex = 0
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (!isSafe(match)) {
      overlong = true
      continue
    }
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  pattern.lastIndex = 0
  return overlong
}

function collectMaximalAtTokens(value: string, spans: StructuredSpan[]): boolean {
  let invalid = false
  const seen = new Set<string>()
  for (let index = 0; index < value.length;) {
    const codePoint = nextCodePoint(value, index)
    if (codePoint === undefined) return true
    if (codePoint !== '@') {
      index += codePoint.length
      continue
    }

    let start = index
    for (let previous = previousCodePoint(value, start); previous && AT_TOKEN_CODE_POINT.test(previous);) {
      start -= previous.length
      previous = previousCodePoint(value, start)
    }
    let end = index + codePoint.length
    for (let next = nextCodePoint(value, end); next && AT_TOKEN_CODE_POINT.test(next);) {
      end += next.length
      next = nextCodePoint(value, end)
    }

    const rangeKey = `${start}:${end}`
    if (!seen.has(rangeKey)) {
      seen.add(rangeKey)
      const token = value.slice(start, end)
      const email = token.match(COMPLETE_AT_EMAIL)
      const handle = token.match(COMPLETE_AT_HANDLE)
      const validEmail = email !== null
        && codePointLength(email.groups?.local ?? '') <= 64
      const validHandle = handle !== null
        && codePointLength(handle.groups?.handle ?? '') >= 3
        && codePointLength(handle.groups?.handle ?? '') <= 64
      if (validEmail || validHandle) {
        spans.push({ start, end })
      } else {
        invalid = true
      }
    }
    index = end
  }
  return invalid
}

function scanStructuredPii(value: string): StructuredScan {
  const spans: StructuredSpan[] = []
  let overlong = false
  overlong = collectCandidates(
    value,
    URL_CANDIDATE,
    (match) => codePointLength(match[0]) <= 256,
    spans,
  ) || overlong
  overlong = collectCandidates(
    value,
    EMAIL_CANDIDATE,
    (match) => codePointLength(match[0].slice(0, match[0].indexOf('@'))) <= 64,
    spans,
  ) || overlong
  overlong = collectMaximalAtTokens(value, spans) || overlong
  overlong = collectCandidates(
    value,
    PHONE_CANDIDATE,
    (match) => {
      const matched = match[0]
      const digits = matched.replace(/\D/gu, '')
      const subscriberDigits = /^\+?86/u.test(matched) ? digits.slice(2) : digits
      return subscriberDigits.length === 11
    },
    spans,
  ) || overlong
  overlong = collectCandidates(
    value,
    LABELLED_ID_CANDIDATE,
    (match) => {
      const token = match.groups?.identifier ?? ''
      return codePointLength(token) >= 4
        && codePointLength(token) <= 32
        && LETTER_OR_NUMBER.test(token)
    },
    spans,
  ) || overlong
  overlong = collectCandidates(
    value,
    SOCIAL_ACCOUNT_CANDIDATE,
    (match) => {
      const token = match.groups?.account ?? ''
      const atCount = token.match(/@/gu)?.length ?? 0
      return codePointLength(token) >= 3
        && codePointLength(token) <= 64
        && LETTER_OR_NUMBER.test(token)
        && atCount <= 1
    },
    spans,
  ) || overlong
  overlong = collectCandidates(
    value,
    SOCIAL_HANDLE_CANDIDATE,
    (match) => {
      const token = match.groups?.handle ?? ''
      return codePointLength(token) >= 3
        && codePointLength(token) <= 64
        && LETTER_OR_NUMBER.test(token)
    },
    spans,
  ) || overlong
  overlong = collectCandidates(
    value,
    CONTINUOUS_DIGITS_CANDIDATE,
    (match) => match[0].length <= 32,
    spans,
  ) || overlong

  const merged: StructuredSpan[] = []
  for (const span of spans.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged[merged.length - 1]
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return { spans: merged, overlong }
}

function replaceStructuredPii(value: string, spans: readonly StructuredSpan[]): string {
  let cursor = 0
  let output = ''
  for (const span of spans) {
    output += value.slice(cursor, span.start) + PLACEHOLDER
    cursor = span.end
  }
  return output + value.slice(cursor)
}

function containsStructuredPii(value: string): boolean {
  const scan = scanStructuredPii(value)
  return scan.overlong || scan.spans.length > 0
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

function containsKnownName(value: string, names: readonly string[]): boolean | null {
  for (const name of names) {
    const replaced = replaceKnownName(value, name)
    if (replaced === null) return null
    if (replaced !== value) return true
  }
  return false
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
  for (const name of names) {
    const replaced = replaceKnownName(scrubbed, name)
    if (replaced === null) return omitted('malformed_input')
    scrubbed = replaced
  }
  const structured = scanStructuredPii(scrubbed)
  if (structured.overlong) return omitted('residual_identifier')
  scrubbed = replaceStructuredPii(scrubbed, structured.spans)

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

  if (hasPromptInjection(scrubbed)) return omitted('prompt_injection')
  const residualKnownName = containsKnownName(scrubbed, names)
  if (residualKnownName === null) return omitted('malformed_input')
  if (
    FORMAT_CONTROL.test(scrubbed)
    || residualKnownName
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
