export type SafeImageDimensions =
  | { status: 'known'; width: number; height: number }
  | { status: 'unknown' }

type SupportedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

const HEADER_SCAN_LIMIT = 64 * 1024
const MAX_SAFE_DIMENSION = 100_000
const unknownDimensions: SafeImageDimensions = { status: 'unknown' }

function knownDimensions(width: number, height: number): SafeImageDimensions {
  return Number.isInteger(width) && Number.isInteger(height)
    && width >= 1 && width <= MAX_SAFE_DIMENSION
    && height >= 1 && height <= MAX_SAFE_DIMENSION
    ? { status: 'known', width, height }
    : unknownDimensions
}

function readPng(buffer: Buffer): SafeImageDimensions {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return unknownDimensions
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') return unknownDimensions
  return knownDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20))
}

const JPEG_START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function readJpeg(buffer: Buffer): SafeImageDimensions {
  const limit = Math.min(buffer.length, HEADER_SCAN_LIMIT)
  if (limit < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return unknownDimensions
  let offset = 2
  while (offset + 3 < limit) {
    if (buffer[offset] !== 0xff) return unknownDimensions
    while (offset < limit && buffer[offset] === 0xff) offset += 1
    if (offset >= limit) return unknownDimensions
    const marker = buffer[offset++]
    if (marker === 0xd9 || marker === 0xda) return unknownDimensions
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > limit) return unknownDimensions
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > limit) return unknownDimensions
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (segmentLength < 7) return unknownDimensions
      return knownDimensions(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3))
    }
    offset += segmentLength
  }
  return unknownDimensions
}

function readWebp(buffer: Buffer): SafeImageDimensions {
  if (buffer.length < 21 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return unknownDimensions
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    if (buffer.length < 30 || buffer.readUInt32LE(16) < 10) return unknownDimensions
    return knownDimensions(buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1)
  }
  if (chunk === 'VP8 ') {
    if (buffer.length < 30 || buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return unknownDimensions
    return knownDimensions(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff)
  }
  if (chunk === 'VP8L') {
    if (buffer.length < 25 || buffer[20] !== 0x2f) return unknownDimensions
    const bits = buffer.readUInt32LE(21)
    return knownDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  return unknownDimensions
}

export function readSafeImageDimensions(buffer: Buffer, mimeType: SupportedImageMimeType): SafeImageDimensions {
  if (mimeType === 'image/png') return readPng(buffer)
  if (mimeType === 'image/jpeg') return readJpeg(buffer)
  if (mimeType === 'image/webp') return readWebp(buffer)
  return unknownDimensions
}
