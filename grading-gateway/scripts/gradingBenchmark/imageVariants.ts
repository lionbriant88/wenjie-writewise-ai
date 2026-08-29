import { createHash } from 'node:crypto'

export type ImageVariantMode = 'resize' | 'reencode'

export type ImageVariantTransformer = (
  pages: readonly Buffer[],
  mode: ImageVariantMode,
) => Promise<readonly Buffer[]> | readonly Buffer[]

export interface ImageVariantOptions {
  mode?: 'original' | ImageVariantMode
  authorization?: string
  transform?: ImageVariantTransformer
}

export function hashOrderedImagePages(pages: readonly Buffer[]): string {
  const digest = createHash('sha256')
  for (const page of pages) {
    if (!Buffer.isBuffer(page)) throw new Error('invalid_image_page')
    const length = Buffer.allocUnsafe(8)
    length.writeBigUInt64BE(BigInt(page.byteLength))
    digest.update(length)
    digest.update(page)
  }
  return digest.digest('hex')
}

export async function getImageVariantPages(
  pages: readonly Buffer[],
  options: ImageVariantOptions = {},
): Promise<readonly Buffer[]> {
  if (!Array.isArray(pages) || pages.length === 0 || pages.some((page) => !Buffer.isBuffer(page))) {
    throw new Error('invalid_image_pages')
  }

  const mode = options.mode ?? 'original'
  if (mode === 'original') return pages.slice()
  if (mode !== 'resize' && mode !== 'reencode') throw new Error('invalid_image_variant_mode')
  if (options.authorization !== 'approved') throw new Error('image_experiment_not_authorized')
  if (!options.transform) throw new Error('image_variant_transform_unavailable')

  const sourceDigest = hashOrderedImagePages(pages)
  const isolatedPages = pages.map((page) => Buffer.from(page))
  const transformed = await options.transform(isolatedPages, mode)
  if (hashOrderedImagePages(pages) !== sourceDigest) {
    throw new Error('source_image_pages_mutated')
  }
  if (!Array.isArray(transformed)
    || transformed.length !== pages.length
    || transformed.some((page) => !Buffer.isBuffer(page))) {
    throw new Error('invalid_image_variant_output')
  }
  return transformed.slice()
}
