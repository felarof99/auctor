import {
  type Classification,
  ClassificationSchema,
} from '@auctor/shared/classification'

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function validateClassification(value: unknown): Classification {
  const parsed = ClassificationSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(parsed.error.message)
  }
  return parsed.data
}

function tryParseCandidate(candidate: string): Classification {
  return validateClassification(JSON.parse(candidate))
}

function extractJsonFences(text: string): string[] {
  return [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((match) =>
    match[1].trim(),
  )
}

function findBalancedObjectEnd(text: string, start: number): number | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }

  return null
}

function extractBalancedObjects(text: string): string[] {
  const objects: string[] = []

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue

    const end = findBalancedObjectEnd(text, index)
    if (end === null) continue

    objects.push(text.slice(index, end + 1))
  }

  return objects
}

export function parseClassificationJson(text: string): Classification {
  const candidates = [
    text.trim(),
    ...extractJsonFences(text),
    ...extractBalancedObjects(text),
  ].filter(Boolean)

  const errors: string[] = []

  for (const candidate of candidates) {
    try {
      return tryParseCandidate(candidate)
    } catch (error) {
      errors.push(formatError(error))
    }
  }

  throw new Error(
    `Classification validation failed: ${errors.at(-1) ?? 'no JSON object found'}`,
  )
}
