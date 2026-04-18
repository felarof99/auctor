import { describe, expect, test } from 'bun:test'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import { BedrockClassifierBackend } from './agent'
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

describe('BedrockClassifierBackend', () => {
  test('classifies many work units serially and returns classifications by id', async () => {
    const first = workUnit('first')
    const second = workUnit('second')
    const calls: string[] = []
    const backend = new BedrockClassifierBackend(async (unit, repoPath) => {
      calls.push(`start:${unit.id}:${repoPath}`)
      await Promise.resolve()
      calls.push(`end:${unit.id}:${repoPath}`)
      return classification(unit.id)
    })

    const result = await backend.classifyMany({
      repoPath: '/repo',
      workUnits: [first, second],
    })

    expect(calls).toEqual([
      'start:first:/repo',
      'end:first:/repo',
      'start:second:/repo',
      'end:second:/repo',
    ])
    expect(result).toEqual(
      new Map([
        ['first', classification('first')],
        ['second', classification('second')],
      ]),
    )
  })
})

function workUnit(id: string): WorkUnit {
  return {
    id,
    kind: 'branch-day',
    author: 'Alice',
    branch: 'main',
    date: '2026-04-10',
    commit_shas: [`${id}-sha`],
    commit_messages: [`feat: add ${id}`],
    diff: `+function ${id}() {}`,
    insertions: 10,
    deletions: 0,
    net: 10,
  }
}

function classification(id: string): Classification {
  return {
    type: 'feature',
    difficulty: 'medium',
    impact_score: 5,
    reasoning: `classified ${id}`,
  }
}
