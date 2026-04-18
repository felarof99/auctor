import { describe, expect, test } from 'bun:test'
import type { WorkUnit } from '@auctor/shared/classification'
import { buildConsideredItemsForUnit } from './analyze'

function makeUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'unit-1',
    kind: 'branch-day',
    author: 'alice',
    branch: 'main',
    date: '2026-04-17',
    commit_shas: ['aaa1111', 'bbb2222'],
    commit_messages: ['feat: first', 'fix: second'],
    diff: '',
    insertions: 10,
    deletions: 2,
    net: 8,
    ...overrides,
  }
}

describe('buildConsideredItemsForUnit', () => {
  test('turns branch-day work units into raw commit provenance', () => {
    const considered = buildConsideredItemsForUnit('browseros-main', makeUnit())

    expect(considered).toEqual({
      commits: [
        {
          repo: 'browseros-main',
          branch: 'main',
          sha: 'aaa1111',
          message: 'feat: first',
        },
        {
          repo: 'browseros-main',
          branch: 'main',
          sha: 'bbb2222',
          message: 'fix: second',
        },
      ],
      prs: [],
    })
  })

  test('turns PR work units into merge commit provenance with parsed PR number', () => {
    const considered = buildConsideredItemsForUnit(
      'browseros-main',
      makeUnit({
        kind: 'pr',
        commit_shas: ['ccc3333'],
        commit_messages: ['feat: add mcp guard (#710)'],
      }),
    )

    expect(considered).toEqual({
      commits: [],
      prs: [
        {
          repo: 'browseros-main',
          branch: 'main',
          sha: 'ccc3333',
          pr_number: 710,
          message: 'feat: add mcp guard (#710)',
        },
      ],
    })
  })

  test('uses merge commit SHA when PR number cannot be parsed', () => {
    const considered = buildConsideredItemsForUnit(
      'browseros-main',
      makeUnit({
        kind: 'pr',
        commit_shas: ['ddd4444'],
        commit_messages: ['merge feature branch'],
      }),
    )

    expect(considered).toEqual({
      commits: [],
      prs: [
        {
          repo: 'browseros-main',
          branch: 'main',
          sha: 'ddd4444',
          message: 'merge feature branch',
        },
      ],
    })
  })

  test('parses GitHub merge commit PR numbers', () => {
    const considered = buildConsideredItemsForUnit(
      'browseros-main',
      makeUnit({
        kind: 'pr',
        commit_shas: ['eee5555'],
        commit_messages: ['chore: merge pull request #690 (feat/acls)'],
      }),
    )

    expect(considered.prs[0].pr_number).toBe(690)
  })
})
