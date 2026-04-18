const SAFE_CODEX_CONFIG_KEYS = new Set([
  'model',
  'model_reasoning_effort',
  'service_tier',
])
const SAFE_CODEX_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'none'])

export function normalizeCodexReasoningEffort(effort: string): string {
  const normalized = effort.trim().toLowerCase()
  return normalized === 'xhigh' ? 'high' : normalized
}

export function sanitizeCodexConfig(config: string): string {
  const lines: string[] = []

  for (const line of config.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[')) break

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(trimmed)
    if (!match) continue

    const [, key, value] = match
    const sanitizedValue = sanitizeCodexConfigValue(key, value.trim())
    if (sanitizedValue !== null) {
      lines.push(`${key} = ${sanitizedValue}`)
    }
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

function sanitizeCodexConfigValue(key: string, value: string): string | null {
  if (!SAFE_CODEX_CONFIG_KEYS.has(key)) return null
  if (key !== 'model_reasoning_effort') return value

  const effort = readTomlStringValue(value)
  if (effort === null) return null

  const normalized = normalizeCodexReasoningEffort(effort)
  if (SAFE_CODEX_REASONING_EFFORTS.has(normalized)) {
    return JSON.stringify(normalized)
  }

  return null
}

function readTomlStringValue(value: string): string | null {
  const quoted = /^(?:"([^"]*)"|'([^']*)')$/.exec(value)
  if (quoted) return quoted[1] ?? quoted[2] ?? ''

  const bare = /^[A-Za-z_-]+$/.exec(value)
  return bare ? value : null
}
