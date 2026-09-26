import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Reservation {
  version: 1
  caseId: string
  inputTokenBound: number
  outputTokenBound: number
  reservedCnyMicros: number
  reservedUsdMicros: number
}

function accountedCost(directory: string, filename: string, reservation: Reservation) {
  const resultPath = join(directory, filename.replace('attempt-', 'result-'))
  if (!existsSync(resultPath)) return reservation
  let result
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8'))
  } catch { return reservation }
  const usage = result?.usage
  const prompt = usage?.totals?.promptTokens
  const completion = usage?.totals?.completionTokens
  const total = usage?.totals?.totalTokens
  if (usage?.uniqueAttempts !== 1 || ![prompt, completion, total].every((item) => item?.status === 'known' && Number.isSafeInteger(item.value) && item.value >= 0)
    || prompt.value + completion.value !== total.value) return reservation
  if (prompt.value > reservation.inputTokenBound || completion.value > reservation.outputTokenBound) throw Error('Observed usage exceeded reservation; stop for reconciliation.')
  return peakCost(prompt.value, completion.value)
}

function peakCost(inputTokens: number, outputTokens: number) {
  const reservedCnyMicros = 2 * inputTokens + 8 * outputTokens
  const reservedUsdMicros = Math.ceil(Math.max(.3 * inputTokens + 1.2 * outputTokens, reservedCnyMicros / 6))
  if (!Number.isSafeInteger(reservedCnyMicros) || !Number.isSafeInteger(reservedUsdMicros)) throw Error('Invalid cost bounds.')
  return { reservedCnyMicros, reservedUsdMicros }
}
// 2026-09-25 official peak prices per million: input CNY 2 / USD .30,
// output CNY 8 / USD 1.20. Never assume a cache hit or an off-peak discount.
// Also impose CNY .60 as a stricter local-currency envelope for the USD .10 test.
export function estimateReservation(body: any): Omit<Reservation, 'version' | 'caseId'> {
  if (body.model !== 'deepseek-flash' || !Number.isSafeInteger(body.max_tokens)
    || body.max_tokens < 1 || body.max_tokens > 16384 || !Array.isArray(body.messages)) throw Error('Invalid smoke request.')
  let textBytes = 0
  let images = 0
  for (const message of body.messages) {
    if (typeof message.content === 'string') textBytes += Buffer.byteLength(message.content)
    else if (Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === 'text' && typeof part.text === 'string') textBytes += Buffer.byteLength(part.text)
      else if (part.type === 'image_url' && /^data:image\/(png|jpeg|webp);base64,/.test(part.image_url?.url)) images++
      else throw Error('Unsupported smoke content.')
    }
    else throw Error('Unsupported smoke message.')
  }
  // Two tokens per UTF-8 byte and twice the documented 1024/image limit,
  // plus framing headroom. This bounds the small synthetic fixtures conservatively.
  const inputTokenBound = 2 * textBytes + 2048 * images + 4096 + 128 * body.messages.length
  const outputTokenBound = body.max_tokens
  return { inputTokenBound, outputTokenBound, ...peakCost(inputTokenBound, outputTokenBound) }
}

export function reserveSmokeCall(directory: string, caseId: string, body: unknown) {
  if (!/^[a-z-]{1,32}$/.test(caseId)) throw Error('Invalid smoke case.')
  const estimate = estimateReservation(body)
  mkdirSync(directory, { recursive: true })
  const lock = join(directory, 'reservation.lock')
  const descriptor = openSync(lock, 'wx')
  try {
    const entries = readdirSync(directory).filter((name) => /^attempt-\d+\.json$/.test(name)).map((name) => {
      const entry = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Reservation
      if (entry?.version !== 1 || typeof entry.caseId !== 'string' || !/^[a-z-]{1,32}$/.test(entry.caseId)
        || !Number.isSafeInteger(entry.inputTokenBound) || entry.inputTokenBound < 1
        || !Number.isSafeInteger(entry.outputTokenBound) || entry.outputTokenBound < 1 || entry.outputTokenBound > 16384
        || !Number.isSafeInteger(entry.reservedCnyMicros) || entry.reservedCnyMicros < 1
        || !Number.isSafeInteger(entry.reservedUsdMicros) || entry.reservedUsdMicros < 1) throw Error('Invalid smoke ledger.')
      const expected = peakCost(entry.inputTokenBound, entry.outputTokenBound)
      if (entry.reservedCnyMicros !== expected.reservedCnyMicros || entry.reservedUsdMicros !== expected.reservedUsdMicros) throw Error('Inconsistent smoke ledger.')
      return { ...entry, ...accountedCost(directory, name, entry) }
    })
    if (entries.length >= 3 || entries.some((entry) => entry.caseId === caseId)) throw Error('Smoke call already reserved or call cap reached.')
    if (entries.reduce((sum, entry) => sum + entry.reservedCnyMicros, estimate.reservedCnyMicros) > 600000
      || entries.reduce((sum, entry) => sum + entry.reservedUsdMicros, estimate.reservedUsdMicros) > 100000) throw Error('Smoke budget exceeded.')
    const ordinal = entries.length + 1
    const entry = { version: 1 as const, caseId, ...estimate, reservedAt: new Date().toISOString() }
    writeFileSync(join(directory, `attempt-${ordinal}.json`), JSON.stringify(entry, null, 2), { flag: 'wx' })
    return { ordinal, ...entry }
  } finally {
    closeSync(descriptor)
    unlinkSync(lock)
  }
}
