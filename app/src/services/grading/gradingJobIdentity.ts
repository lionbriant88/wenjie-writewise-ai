export interface GradingJobVersion {
  taskId: string
  essayId: string
  sourceGeneration: number
  rubricGeneration: number
}

export interface GradingJobIdentityStore {
  getOrCreate(version: GradingJobVersion): string
  invalidateEssay(essayId: string): void
}

type RubricGenerationMap = Map<number, string>
type SourceGenerationMap = Map<number, RubricGenerationMap>
type EssayMap = Map<string, SourceGenerationMap>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INJECTED_SOURCE_ATTEMPTS = 16
const SECURE_SOURCE_ATTEMPTS = 32

function assertGeneration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`)
  }
}

function normalizeOpaqueId(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null

  const trimmed = candidate.trim()
  const uuid = trimmed.startsWith('grading-') ? trimmed.slice('grading-'.length) : trimmed
  if (!UUID_PATTERN.test(uuid)) return null

  return `grading-${uuid.toLowerCase()}`
}

function secureRandomUuid(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
  }

  throw new Error('Secure grading job identity generation is unavailable')
}

export function createGradingJobIdentityStore(
  randomId?: () => string,
): GradingJobIdentityStore {
  const tasks = new Map<string, EssayMap>()
  const issuedIds = new Set<string>()

  const acceptCandidate = (candidate: unknown): string | null => {
    const normalized = normalizeOpaqueId(candidate)
    if (!normalized || issuedIds.has(normalized)) return null
    issuedIds.add(normalized)
    return normalized
  }

  const createId = (): string => {
    if (randomId) {
      for (let attempt = 0; attempt < INJECTED_SOURCE_ATTEMPTS; attempt += 1) {
        try {
          const accepted = acceptCandidate(randomId())
          if (accepted) return accepted
        } catch {
          break
        }
      }
    }

    for (let attempt = 0; attempt < SECURE_SOURCE_ATTEMPTS; attempt += 1) {
      const accepted = acceptCandidate(secureRandomUuid())
      if (accepted) return accepted
    }

    throw new Error('Unable to create a unique grading job identity')
  }

  return {
    getOrCreate(version) {
      assertGeneration(version.sourceGeneration, 'sourceGeneration')
      assertGeneration(version.rubricGeneration, 'rubricGeneration')
      const existing = tasks
        .get(version.taskId)
        ?.get(version.essayId)
        ?.get(version.sourceGeneration)
        ?.get(version.rubricGeneration)
      if (existing) return existing

      const id = createId()
      let essays = tasks.get(version.taskId)
      if (!essays) {
        essays = new Map()
        tasks.set(version.taskId, essays)
      }

      let sourceGenerations = essays.get(version.essayId)
      if (!sourceGenerations) {
        sourceGenerations = new Map()
        essays.set(version.essayId, sourceGenerations)
      }

      let rubricGenerations = sourceGenerations.get(version.sourceGeneration)
      if (!rubricGenerations) {
        rubricGenerations = new Map()
        sourceGenerations.set(version.sourceGeneration, rubricGenerations)
      }

      rubricGenerations.set(version.rubricGeneration, id)
      return id
    },

    invalidateEssay(essayId) {
      for (const [taskId, essays] of tasks) {
        essays.delete(essayId)
        if (essays.size === 0) tasks.delete(taskId)
      }
    },
  }
}
