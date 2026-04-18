import { describe, expect, test } from 'bun:test'
import { sanitizeCodexConfig } from './codex-config'

describe('Codex config sanitization', () => {
  test('preserves reasoning effort when TOML value has an inline comment', () => {
    expect(
      sanitizeCodexConfig('model_reasoning_effort = "xhigh" # local default\n'),
    ).toBe('model_reasoning_effort = "high"\n')
  })

  test('does not treat comment markers inside quoted strings as comments', () => {
    expect(sanitizeCodexConfig('model = "gpt-5#codex" # keep model\n')).toBe(
      'model = "gpt-5#codex"\n',
    )
  })
})
