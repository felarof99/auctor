import { describe, expect, test } from 'bun:test'
import { buildClaudeArgs, parseClaudeStreamJson } from './claude'

describe('Claude local executor helpers', () => {
  test('builds args with model, effort, max turns, permissions, and skill bundle', () => {
    expect(
      buildClaudeArgs({
        model: 'claude-sonnet-4-5',
        effort: 'high',
        maxTurns: 3,
        skillBundleDir: '/tmp/auctor-skills',
      }),
    ).toEqual([
      '--print',
      '-',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '3',
      '--dangerously-skip-permissions',
      '--add-dir',
      '/tmp/auctor-skills',
      '--model',
      'claude-sonnet-4-5',
      '--effort',
      'high',
    ])
  })

  test('omits permissions and non-positive max turns when disabled', () => {
    expect(
      buildClaudeArgs({
        maxTurns: 0,
        skipPermissions: false,
        skillBundleDir: '/tmp/auctor-skills',
      }),
    ).toEqual([
      '--print',
      '-',
      '--output-format',
      'stream-json',
      '--verbose',
      '--add-dir',
      '/tmp/auctor-skills',
    ])
  })

  test('parses final result text and session id from stream-json', () => {
    const stdout = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'session-from-init',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: 'intermediate text' },
      }),
      JSON.stringify({
        type: 'result',
        session_id: 'session-from-result',
        result: '  final classification  ',
      }),
    ].join('\n')

    expect(parseClaudeStreamJson(stdout)).toEqual({
      sessionId: 'session-from-result',
      finalText: 'final classification',
    })
  })

  test('ignores malformed lines and keeps the later result', () => {
    const stdout = [
      'not json',
      JSON.stringify({
        type: 'result',
        session_id: 'first-session',
        result: 'first result',
      }),
      '{"type":',
      JSON.stringify({
        type: 'result',
        session_id: 'second-session',
        result: 'second result\n',
      }),
    ].join('\n')

    expect(parseClaudeStreamJson(stdout)).toEqual({
      sessionId: 'second-session',
      finalText: 'second result',
    })
  })
})
