import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  getImageVariantPages,
  hashOrderedImagePages,
  type ImageVariantTransformer,
} from './imageVariants.js'

function baselineHash(pages: readonly Buffer[]): string {
  const digest = createHash('sha256')
  for (const page of pages) {
    const length = Buffer.allocUnsafe(8)
    length.writeBigUInt64BE(BigInt(page.byteLength))
    digest.update(length)
    digest.update(page)
  }
  return digest.digest('hex')
}

describe('offline image experiment isolation', () => {
  it.each([undefined, '', 'disabled'])(
    'returns the original ordered Buffer references when authorization is %s',
    async (authorization) => {
      const pages = [Buffer.from('page-one'), Buffer.from('page-two')]
      const transform = vi.fn<ImageVariantTransformer>()

      const selected = await getImageVariantPages(pages, {
        mode: 'original',
        authorization,
        transform,
      })

      expect(selected).toHaveLength(2)
      expect(selected[0]).toBe(pages[0])
      expect(selected[1]).toBe(pages[1])
      expect(transform).not.toHaveBeenCalled()
      expect(hashOrderedImagePages(selected)).toBe(hashOrderedImagePages(pages))
    },
  )

  it.each(['resize', 'reencode'] as const)(
    'rejects %s before invoking a transformer without separate approval',
    async (mode) => {
      const pages = [Buffer.from('private-marker')]
      const transform = vi.fn<ImageVariantTransformer>()

      await expect(getImageVariantPages(pages, {
        mode,
        authorization: 'disabled',
        transform,
      })).rejects.toThrow('image_experiment_not_authorized')
      expect(transform).not.toHaveBeenCalled()
    },
  )

  it('allows an injected transformer only with exact separate approval', async () => {
    const pages = [Buffer.from('page-one'), Buffer.from('page-two')]
    const variants = [Buffer.from('variant-one'), Buffer.from('variant-two')]
    const transform = vi.fn<ImageVariantTransformer>(async (_pages, mode) => {
      expect(mode).toBe('resize')
      return variants
    })

    const selected = await getImageVariantPages(pages, {
      mode: 'resize',
      authorization: 'approved',
      transform,
    })

    expect(selected).toEqual(variants)
    expect(transform).toHaveBeenCalledTimes(1)
  })

  it('isolates caller-owned pages from a transformer that mutates its input Buffers in place', async () => {
    const pages = [Buffer.from([0x11, 0x22]), Buffer.from([0x33, 0x44])]
    const originalDigest = hashOrderedImagePages(pages)
    let receivedPages: readonly Buffer[] | undefined

    const selected = await getImageVariantPages(pages, {
      mode: 'resize',
      authorization: 'approved',
      transform: (transformPages) => {
        receivedPages = transformPages
        transformPages[0]![0] = 0xff
        return transformPages
      },
    })

    expect(receivedPages?.[0]).not.toBe(pages[0])
    expect(selected[0]).not.toBe(pages[0])
    expect(selected[0]).toEqual(Buffer.from([0xff, 0x22]))
    expect(pages[0]).toEqual(Buffer.from([0x11, 0x22]))
    expect(pages[1]).toEqual(Buffer.from([0x33, 0x44]))
    expect(hashOrderedImagePages(pages)).toBe(originalDigest)
  })

  it('rejects a variant when the caller-owned source digest changes during transformation', async () => {
    const pages = [Buffer.from([0x11, 0x22])]

    await expect(getImageVariantPages(pages, {
      mode: 'reencode',
      authorization: 'approved',
      transform: (transformPages) => {
        pages[0]![0] = 0xff
        return transformPages
      },
    })).rejects.toThrow('source_image_pages_mutated')
  })

  it('rejects malformed transformer output and preserves the original digest', async () => {
    const pages = [Buffer.from('page-one'), Buffer.from('page-two')]
    const originalDigest = hashOrderedImagePages(pages)

    await expect(getImageVariantPages(pages, {
      mode: 'reencode',
      authorization: 'approved',
      transform: async () => [Buffer.from('only-one')],
    })).rejects.toThrow('invalid_image_variant_output')

    expect(hashOrderedImagePages(pages)).toBe(originalDigest)
  })

  it('uses length framing so ordered source hashes cannot be boundary-ambiguous', () => {
    const split = [Buffer.from('a'), Buffer.from('bc')]
    const joined = [Buffer.from('ab'), Buffer.from('c')]

    expect(hashOrderedImagePages(split)).toBe(baselineHash(split))
    expect(hashOrderedImagePages(split)).not.toBe(hashOrderedImagePages(joined))
  })
})
