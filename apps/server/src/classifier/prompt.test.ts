import { describe, expect, test } from 'bun:test'
import type { WorkUnit } from '@auctor/shared/classification'
import { buildClassificationPrompt } from './prompt'

const sampleUnit: WorkUnit = {
  id: 'wu-123',
  kind: 'pr',
  author: 'alice',
  branch: 'feat/add-login',
  date: '2026-04-10',
  commit_shas: ['abc123', 'def456'],
  commit_messages: ['add login form', 'wire up auth API'],
  diff: `diff --git a/src/login.ts b/src/login.ts
+export function login() { return true }`,
  insertions: 12,
  deletions: 3,
  net: 9,
}

describe('buildClassificationPrompt', () => {
  test('includes diff content', () => {
    const prompt = buildClassificationPrompt(sampleUnit)
    expect(prompt).toContain('login.ts')
    expect(prompt).toContain('export function login()')
    expect(prompt).toContain('```diff')
  })

  test('includes commit messages', () => {
    const prompt = buildClassificationPrompt(sampleUnit)
    expect(prompt).toContain('- add login form')
    expect(prompt).toContain('- wire up auth API')
  })

  test('includes metadata', () => {
    const prompt = buildClassificationPrompt(sampleUnit)
    expect(prompt).toContain('alice')
    expect(prompt).toContain('2026-04-10')
    expect(prompt).toContain('12')
  })

  test('includes classification instructions with all types and difficulties', () => {
    const prompt = buildClassificationPrompt(sampleUnit)

    for (const type of [
      'feature',
      'bugfix',
      'refactor',
      'chore',
      'test',
      'docs',
    ]) {
      expect(prompt).toContain(`\`${type}\``)
    }

    for (const diff of ['trivial', 'easy', 'medium', 'hard', 'complex']) {
      expect(prompt).toContain(`\`${diff}\``)
    }

    expect(prompt).toContain('impact_score')
    expect(prompt).toContain('reasoning')
  })
})
