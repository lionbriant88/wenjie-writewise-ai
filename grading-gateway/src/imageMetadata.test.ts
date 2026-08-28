import { describe, expect, it } from 'vitest'
import { readSafeImageDimensions } from './imageMetadata.js'

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function jpeg(width: number, height: number) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ])
}

function webpVp8x(width: number, height: number) {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(22, 4)
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8X', 12, 'ascii')
  buffer.writeUInt32LE(10, 16)
  buffer.writeUIntLE(width - 1, 24, 3)
  buffer.writeUIntLE(height - 1, 27, 3)
  return buffer
}

describe('readSafeImageDimensions', () => {
  it('reads bounded PNG, JPEG, and WebP headers without returning image data', () => {
    expect(readSafeImageDimensions(png(1200, 700), 'image/png')).toEqual({ status: 'known', width: 1200, height: 700 })
    expect(readSafeImageDimensions(jpeg(640, 480), 'image/jpeg')).toEqual({ status: 'known', width: 640, height: 480 })
    expect(readSafeImageDimensions(webpVp8x(1920, 1080), 'image/webp')).toEqual({ status: 'known', width: 1920, height: 1080 })
    expect(JSON.stringify(readSafeImageDimensions(png(3, 2), 'image/png'))).not.toMatch(/buffer|bytes|base64/i)
  })

  it('returns unknown for malformed, mismatched, zero, or out-of-bound headers', () => {
    expect(readSafeImageDimensions(Buffer.from('not-an-image'), 'image/png')).toEqual({ status: 'unknown' })
    expect(readSafeImageDimensions(png(10, 20), 'image/jpeg')).toEqual({ status: 'unknown' })
    expect(readSafeImageDimensions(png(0, 20), 'image/png')).toEqual({ status: 'unknown' })
    expect(readSafeImageDimensions(png(100_001, 20), 'image/png')).toEqual({ status: 'unknown' })

    const lateJpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(70 * 1024), jpeg(32, 24).subarray(2)])
    expect(readSafeImageDimensions(lateJpeg, 'image/jpeg')).toEqual({ status: 'unknown' })
  })

  it('does not mutate, replace, resize, reorder, or re-encode the supplied buffer', () => {
    const input = webpVp8x(800, 600)
    const before = Buffer.from(input)
    const identity = input
    readSafeImageDimensions(input, 'image/webp')
    expect(input).toBe(identity)
    expect(input.equals(before)).toBe(true)
  })
})
