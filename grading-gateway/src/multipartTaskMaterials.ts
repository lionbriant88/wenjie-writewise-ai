export const MAX_TASK_MATERIAL_UNITS = 10
export const MAX_TASK_MATERIAL_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_TASK_MATERIAL_TEXT_CHARACTERS = 30_000

type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

const MAX_WRITING_REQUIREMENT_CHARACTERS = 10_000
const SUPPORTED_IMAGE_TYPES = new Set<ImageMimeType>([
  'image/png',
  'image/jpeg',
  'image/webp',
])
const BODY_KEYS = ['requestId', 'fullScore', 'writingRequirement', 'materialManifest', 'textMaterials'] as const
const INVALID_REQUEST_MESSAGE = 'Task material request is invalid.'
const REQUEST_TOO_LARGE_MESSAGE = 'Task material upload exceeds the allowed limit.'

export type GatewayTaskMaterial =
  | {
      kind: 'image'
      unitId: string
      mimeType: ImageMimeType
      buffer: Buffer
    }
  | {
      kind: 'text'
      unitId: string
      displayName: string
      text: string
    }

export type WritingRequirementMode = 'required' | 'optional'

export type TaskMaterialMultipartValidationResult =
  | {
      ok: true
      value: {
        requestId: string
        fullScore: number
        writingRequirement?: string
        materials: GatewayTaskMaterial[]
      }
    }
  | {
      ok: false
      error: {
        code: 'invalid_request' | 'request_too_large'
        message: string
      }
    }

interface ImageManifestEntry {
  id: string
  kind: 'image'
  imageIndex: number
}

interface TextManifestEntry {
  id: string
  kind: 'text'
  textIndex: number
}

type ManifestEntry = ImageManifestEntry | TextManifestEntry

interface TextMaterialEntry {
  displayName: string
  text: string
}

function invalid(): TaskMaterialMultipartValidationResult {
  return { ok: false, error: { code: 'invalid_request', message: INVALID_REQUEST_MESSAGE } }
}

function tooLarge(): TaskMaterialMultipartValidationResult {
  return { ok: false, error: { code: 'request_too_large', message: REQUEST_TOO_LARGE_MESSAGE } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key))
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function readTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= maxLength ? trimmed : null
}

function readFullScore(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[1-9]\d{0,2}$/.test(trimmed)) return null
  const score = Number(trimmed)
  return score <= 100 ? score : null
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function readManifest(value: unknown): ManifestEntry[] | 'too_large' | null {
  const parsed = parseJson(value)
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  if (parsed.length > MAX_TASK_MATERIAL_UNITS) return 'too_large'

  const entries: ManifestEntry[] = []
  for (const item of parsed) {
    if (!isRecord(item)) return null
    const id = readTrimmedString(item.id, 128)
    if (!id) return null
    if (item.kind === 'image') {
      if (!hasExactlyKeys(item, ['id', 'kind', 'imageIndex']) || !Number.isInteger(item.imageIndex) || (item.imageIndex as number) < 0) return null
      entries.push({ id, kind: 'image', imageIndex: item.imageIndex as number })
    } else if (item.kind === 'text') {
      if (!hasExactlyKeys(item, ['id', 'kind', 'textIndex']) || !Number.isInteger(item.textIndex) || (item.textIndex as number) < 0) return null
      entries.push({ id, kind: 'text', textIndex: item.textIndex as number })
    } else {
      return null
    }
  }
  return new Set(entries.map((entry) => entry.id)).size === entries.length ? entries : null
}

function readTextMaterials(value: unknown): TextMaterialEntry[] | 'too_large' | null {
  const parsed = parseJson(value)
  if (!Array.isArray(parsed)) return null
  if (parsed.length > MAX_TASK_MATERIAL_UNITS) return 'too_large'

  const materials: TextMaterialEntry[] = []
  for (const item of parsed) {
    if (!isRecord(item) || !hasExactlyKeys(item, ['displayName', 'text'])) return null
    const displayName = readTrimmedString(item.displayName, 256)
    if (!displayName || typeof item.text !== 'string') return null
    const text = item.text.trim()
    if (!text) return null
    if (text.length > MAX_TASK_MATERIAL_TEXT_CHARACTERS) return 'too_large'
    materials.push({ displayName, text })
  }
  return materials
}

function hasExactIndexCoverage(indices: readonly number[], expectedCount: number): boolean {
  if (indices.length !== expectedCount || new Set(indices).size !== expectedCount) return false
  return indices.every((index) => index >= 0 && index < expectedCount)
}

export function validateTaskMaterialMultipart(
  body: unknown,
  files: readonly globalThis.Express.Multer.File[] | undefined,
  mode: WritingRequirementMode,
): TaskMaterialMultipartValidationResult {
  if (!isRecord(body) || !hasOnlyKeys(body, BODY_KEYS)) return invalid()

  const requestId = readTrimmedString(body.requestId, 128)
  const fullScore = readFullScore(body.fullScore)
  if (!requestId || fullScore === null) return invalid()

  let writingRequirement: string | undefined
  if (body.writingRequirement !== undefined) {
    if (typeof body.writingRequirement !== 'string') return invalid()
    const trimmedRequirement = body.writingRequirement.trim()
    if (trimmedRequirement.length > MAX_WRITING_REQUIREMENT_CHARACTERS) return tooLarge()
    writingRequirement = trimmedRequirement || undefined
  }
  if (mode === 'required' && !writingRequirement) return invalid()

  const manifest = readManifest(body.materialManifest)
  const textMaterials = readTextMaterials(body.textMaterials)
  if (manifest === 'too_large' || textMaterials === 'too_large') return tooLarge()
  if (!manifest || !textMaterials) return invalid()

  const imageFiles = files ?? []
  if (imageFiles.length > MAX_TASK_MATERIAL_UNITS) return tooLarge()
  if (imageFiles.some((file) => file.size > MAX_TASK_MATERIAL_IMAGE_BYTES || file.buffer.length > MAX_TASK_MATERIAL_IMAGE_BYTES)) {
    return tooLarge()
  }
  if (imageFiles.some((file) => !SUPPORTED_IMAGE_TYPES.has(file.mimetype as ImageMimeType))) return invalid()

  const imageIndices = manifest
    .filter((entry): entry is ImageManifestEntry => entry.kind === 'image')
    .map((entry) => entry.imageIndex)
  const textIndices = manifest
    .filter((entry): entry is TextManifestEntry => entry.kind === 'text')
    .map((entry) => entry.textIndex)
  if (!hasExactIndexCoverage(imageIndices, imageFiles.length) || !hasExactIndexCoverage(textIndices, textMaterials.length)) {
    return invalid()
  }

  const materials: GatewayTaskMaterial[] = manifest.map((entry) => {
    if (entry.kind === 'image') {
      const file = imageFiles[entry.imageIndex]!
      return {
        kind: 'image',
        unitId: entry.id,
        mimeType: file.mimetype as ImageMimeType,
        buffer: file.buffer,
      }
    }
    const material = textMaterials[entry.textIndex]!
    return {
      kind: 'text',
      unitId: entry.id,
      displayName: material.displayName,
      text: material.text,
    }
  })

  return {
    ok: true,
    value: {
      requestId,
      fullScore,
      ...(writingRequirement ? { writingRequirement } : {}),
      materials,
    },
  }
}
