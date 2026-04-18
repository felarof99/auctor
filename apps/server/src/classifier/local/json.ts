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

function extractFirstBalancedObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

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
        return text.slice(start, index + 1)
      }
    }
  }

  return null
}

export function parseClassificationJson(text: string): Classification {
  const candidates = [
    text.trim(),
    ...extractJsonFences(text),
    extractFirstBalancedObject(text),
  ].filter((candidate): candidate is string => Boolean(candidate))

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
