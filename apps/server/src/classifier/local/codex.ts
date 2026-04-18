import { normalizeCodexReasoningEffort } from './codex-config'

export interface CodexArgsInput {
  model?: string
  effort?: string
  bypassApprovals?: boolean
}

export interface ParsedCodexOutput {
  threadId: string | null
  finalText: string
}

export function buildCodexArgs(input: CodexArgsInput): string[] {
  const args = ['exec', '--json']

  if (input.bypassApprovals !== false) {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  }

  if (input.model) {
    args.push('--model', input.model)
  }

  if (input.effort) {
    args.push(
      '-c',
      `model_reasoning_effort=${JSON.stringify(
        normalizeCodexReasoningEffort(input.effort),
      )}`,
    )
  }

  args.push('-')

  return args
}

export function parseCodexJsonl(stdout: string): ParsedCodexOutput {
  let threadId: string | null = null
  let finalText = ''

  for (const line of stdout.split('\n')) {
    const event = parseJsonLine(line)
    if (!event) continue

    if (event.type === 'thread.started') {
      threadId = readFirstString(event, ['thread_id', 'threadId']) ?? threadId
      continue
    }

    const message =
      event.type === 'item.completed' && isRecord(event.item)
        ? event.item
        : isRecord(event.msg)
          ? event.msg
          : null
    if (!message || message.type !== 'agent_message') continue

    const text =
      readString(message, 'message') ??
      readString(message, 'text') ??
      readString(message, 'content') ??
      readTextFromMessageContent(message.content)

    if (text !== null) {
      finalText = text
    }
  }

  return {
    threadId,
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

function readTextFromMessageContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      return readString(part, 'text') ?? ''
    })
    .join('')
}
