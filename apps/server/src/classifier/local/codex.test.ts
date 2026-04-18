import { describe, expect, test } from 'bun:test'
import { buildCodexArgs, parseCodexJsonl } from './codex'

describe('Codex local executor helpers', () => {
  test('builds args with model, effort, bypass flag, and trailing prompt stdin', () => {
    expect(
      buildCodexArgs({
        model: 'gpt-5.2-codex',
        effort: 'high',
      }),
    ).toEqual([
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'gpt-5.2-codex',
      '-c',
      'model_reasoning_effort="high"',
      '-',
    ])
  })

  test('omits bypass flag when disabled', () => {
    expect(buildCodexArgs({ bypassApprovals: false })).toEqual([
      'exec',
      '--json',
      '-',
    ])
  })

  test('parses final agent message and thread id', () => {
    const stdout = [
      JSON.stringify({
        type: 'thread.started',
        thread_id: 'thread-123',
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'tool_call', output: 'ignored' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: '  final classification  ',
        },
      }),
    ].join('\n')

    expect(parseCodexJsonl(stdout)).toEqual({
      threadId: 'thread-123',
      finalText: 'final classification',
    })
  })

  test('parses current Codex agent messages from nested msg events', () => {
    const classificationJson = JSON.stringify({
      type: 'feature',
      difficulty: 'hard',
      impact_score: 8,
      reasoning: 'classified by codex 0.22',
    })
    const stdout = [
      JSON.stringify({
        type: 'thread.started',
        thread_id: 'thread-456',
      }),
      JSON.stringify({
        id: '0',
        msg: {
          type: 'agent_reasoning',
          text: 'ignored reasoning',
        },
      }),
      JSON.stringify({
        id: '1',
        msg: {
          type: 'agent_message',
          message: `  ${classificationJson}  `,
        },
      }),
    ].join('\n')

    expect(parseCodexJsonl(stdout)).toEqual({
      threadId: 'thread-456',
      finalText: classificationJson,
    })
  })

  test('ignores malformed lines and keeps the latest agent message', () => {
    const stdout = [
      '{bad json',
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: 'first answer',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          content: 'second answer\n',
        },
      }),
    ].join('\n')

    expect(parseCodexJsonl(stdout)).toEqual({
      threadId: null,
      finalText: 'second answer',
    })
  })
})
