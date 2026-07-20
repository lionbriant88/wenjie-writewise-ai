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
    if (/\s/u.test(character)) {
      if (!previousWasSpace) {
        normalized += ' '
        originalIndexes.push(index)
      }
      previousWasSpace = true
    } else {
      normalized += character
      originalIndexes.push(index)
      previousWasSpace = false
    }
  }
  return { text: normalized, originalIndexes }
}

export function matchTranscriptQuote(source: string, quote: string) {
  const trimmedQuote = quote.trim()
  if (!source || !trimmedQuote) return null
  const directStart = source.indexOf(trimmedQuote)
  if (directStart >= 0) return source.slice(directStart, directStart + trimmedQuote.length)

  const normalizedSource = normalizeWithMap(source)
  const normalizedQuote = trimmedQuote.replace(/\s+/gu, ' ')
  const start = normalizedSource.text.indexOf(normalizedQuote)
  if (start < 0) return null
  const end = start + normalizedQuote.length
  const originalStart = normalizedSource.originalIndexes[start]
  const originalEnd = normalizedSource.originalIndexes[end - 1] + 1
  return source.slice(originalStart, originalEnd)
}
