import { describe, expect, test } from 'bun:test'
import type { WorkUnit } from '@auctor/shared/classification'
import { buildClassificationPrompt } from './prompt'

describe('classifyWorkUnit', () => {
  test('prompt is well-formed for Bedrock classification', () => {
    const unit: WorkUnit = {
      id: 'test-id',
      kind: 'branch-day',
      author: 'Alice',
      branch: 'main',
      date: '2026-04-10',
      commit_shas: ['abc'],
      commit_messages: ['feat: add login'],
      diff: '+function login() {}',
      insertions: 10,
      deletions: 0,
      net: 10,
    }
    const prompt = buildClassificationPrompt(unit)
    expect(prompt).toContain('classifying a work unit')
    expect(prompt.length).toBeGreaterThan(100)
  })
})
