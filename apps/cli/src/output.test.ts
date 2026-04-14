import { describe, expect, test } from 'bun:test'
import { renderLeaderboard } from './output'
import type { AuthorStats } from './types'

describe('renderLeaderboard', () => {
  test('renders a table with author stats', () => {
    const stats: AuthorStats[] = [
      {
        author: 'alice',
        commits: 12,
        prs: 3,
        insertions: 1240,
        deletions: 380,
        net: 860,
        score: 0.82,
      },
      {
        author: 'bob',
        commits: 8,
        prs: 2,
        insertions: 650,
        deletions: 120,
        net: 530,
        score: 0.61,
      },
    ]

    const output = renderLeaderboard(stats)
    expect(output).toContain('alice')
    expect(output).toContain('bob')
    expect(output).toContain('Rank')
    expect(output).toContain('Author')
    expect(output).toContain('Commits')
    expect(output).toContain('PRs')
    expect(output).toContain('Score')
    expect(output).toContain('0.82')
    expect(output).toContain('0.61')
  })

  test('renders empty table when no stats', () => {
    const output = renderLeaderboard([])
    expect(output).toContain('Rank')
    expect(output).not.toContain('alice')
  })

  test('ranks are sequential starting at 1', () => {
    const stats: AuthorStats[] = [
      {
        author: 'a',
        commits: 1,
        prs: 0,
        insertions: 10,
        deletions: 0,
        net: 10,
        score: 0.5,
      },
      {
        author: 'b',
        commits: 1,
        prs: 0,
        insertions: 5,
        deletions: 0,
        net: 5,
        score: 0.3,
      },
    ]
    const output = renderLeaderboard(stats)
    const lines = output.split('\n')
    const dataLines = lines.filter(
      (l) => l.includes('│') && !l.includes('Rank'),
    )
    expect(dataLines[0]).toContain('1')
    expect(dataLines[1]).toContain('2')
  })
})
