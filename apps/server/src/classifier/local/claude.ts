export interface ClaudeArgsInput {
  model?: string
  effort?: string
  maxTurns?: number
  skipPermissions?: boolean
  skillBundleDir: string
}

export interface ParsedClaudeOutput {
  sessionId: string | null
  finalText: string
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const args = ['--print', '-', '--output-format', 'stream-json', '--verbose']

  if (input.maxTurns !== undefined && input.maxTurns > 0) {
    args.push('--max-turns', String(input.maxTurns))
  }

  if (input.skipPermissions !== false) {
    args.push('--dangerously-skip-permissions')
  }

  args.push('--add-dir', input.skillBundleDir)

  if (input.model) {
    args.push('--model', input.model)
  }

  if (input.effort) {
    args.push('--effort', input.effort)
  }

  return args
}

export function parseClaudeStreamJson(stdout: string): ParsedClaudeOutput {
  let sessionId: string | null = null
  let finalText = ''

  for (const line of stdout.split('\n')) {
    const event = parseJsonLine(line)
    if (!event) continue

    if (event.type === 'system' && event.subtype === 'init') {
      sessionId =
        readFirstString(event, ['session_id', 'sessionId']) ?? sessionId
      continue
    }

    if (event.type !== 'result') continue

    sessionId = readFirstString(event, ['session_id', 'sessionId']) ?? sessionId

    const result = readString(event, 'result')
    if (result !== null) {
      finalText = result
    }
  }

  return {
    sessionId,
    finalText: finalText.trim(),
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFirstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = readString(record, key)
    if (value !== null) return value
  }

  return null
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}
