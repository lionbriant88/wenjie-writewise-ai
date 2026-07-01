export interface HighlightMatch {
  start: number
  end: number
  matchedText: string
}

export interface HighlightPart {
  text: string
  highlighted: boolean
}

interface NormalizedText {
  text: string
  originalIndexes: number[]
}

function normalizeWithMap(text: string): NormalizedText {
  let normalized = ''
  const originalIndexes: number[] = []
  let previousWasSpace = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const isSpace = /\s/.test(character)

    if (isSpace) {
      if (!previousWasSpace) {
        normalized += ' '
        originalIndexes.push(index)
      }
      previousWasSpace = true
      continue
    }

    normalized += character
    originalIndexes.push(index)
    previousWasSpace = false
  }

  return { text: normalized.trim(), originalIndexes }
}

export function findTextMatch(sourceText: string, targetText: string): HighlightMatch | null {
  const trimmedTarget = targetText.trim()

  if (!sourceText || !trimmedTarget) {
    return null
  }

  const directStart = sourceText.indexOf(trimmedTarget)

  if (directStart >= 0) {
    const end = directStart + trimmedTarget.length
    return {
      start: directStart,
      end,
      matchedText: sourceText.slice(directStart, end),
    }
  }

  const normalizedSource = normalizeWithMap(sourceText)
  const normalizedTarget = trimmedTarget.replace(/\s+/g, ' ')
  const normalizedStart = normalizedSource.text.indexOf(normalizedTarget)

  if (normalizedStart < 0) {
    return null
  }

  const normalizedEnd = normalizedStart + normalizedTarget.length
  const start = normalizedSource.originalIndexes[normalizedStart]
  const end = normalizedSource.originalIndexes[normalizedEnd - 1] + 1

  return {
    start,
    end,
    matchedText: sourceText.slice(start, end),
  }
}

export function splitTextByMatch(sourceText: string, match: HighlightMatch | null): HighlightPart[] {
  if (!match) {
    return [{ text: sourceText, highlighted: false }]
  }

  return [
    { text: sourceText.slice(0, match.start), highlighted: false },
    { text: sourceText.slice(match.start, match.end), highlighted: true },
    { text: sourceText.slice(match.end), highlighted: false },
  ].filter((part) => part.text.length > 0)
}
