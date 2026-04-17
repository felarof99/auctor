import { describe, expect, test } from 'bun:test'
import { aggregateBundle } from './aggregate'
import type { RepoReport } from './report'

const DAILY = [
  { date: '2024-01-01', score: 1.5 },
  { date: '2024-01-02', score: 2.0 },
  { date: '2024-01-03', score: 0.5 },
]

function considered(
  repo: string,
  author: string,
): RepoReport['authors'][number]['considered'] {
  return {
    commits: [
      {
        repo,
        sha: `${author}-${repo}-commit`,
        message: `${author} commit in ${repo}`,
      },
    ],
    prs: [
      {
        repo,
        sha: `${author}-${repo}-merge`,
        pr_number: repo === 'repo1' ? 101 : 202,
        message: `${author} PR in ${repo}`,
      },
    ],
  }
}

function makeReport(
  repo: string,
  authors: RepoReport['authors'],
  overrides: Partial<RepoReport> = {},
): RepoReport {
  return {
    bundle: 'acme',
    repo,
    window: '2024-01-01/2024-01-03',
    window_days: 3,
    generated_at: '2024-01-04T00:00:00.000Z',
    authors,
    ...overrides,
  }
}

describe('aggregateBundle', () => {
  test('single-repo fixture: two authors, same totals, repos array, sorted by score desc', () => {
    const report = makeReport('repo1', [
      {
        author: 'alice',
        commits: 10,
        prs: 2,
        insertions: 100,
        deletions: 20,
        net: 80,
        score: 8.5,
        daily_scores: DAILY,
        considered: considered('repo1', 'alice'),
      },
      {
        author: 'bob',
        commits: 5,
        prs: 1,
        insertions: 50,
        deletions: 10,
        net: 40,
        score: 4.2,
        daily_scores: DAILY,
        considered: considered('repo1', 'bob'),
      },
    ])

    const result = aggregateBundle([report])

    expect(result.authors).toHaveLength(2)

    const alice = result.authors.find((a) => a.author === 'alice')
    const bob = result.authors.find((a) => a.author === 'bob')

    expect(alice).toBeDefined()
    expect(alice?.commits).toBe(10)
    expect(alice?.prs).toBe(2)
    expect(alice?.insertions).toBe(100)
    expect(alice?.deletions).toBe(20)
    expect(alice?.net).toBe(80)
    expect(alice?.score).toBe(8.5)
    expect(alice?.repos).toEqual(['repo1'])
    expect(alice?.considered.commits.map((c) => c.repo)).toEqual(['repo1'])
    expect(alice?.considered.prs.map((p) => p.pr_number)).toEqual([101])

    expect(bob).toBeDefined()
    expect(bob?.repos).toEqual(['repo1'])
    expect(bob?.considered.commits.map((c) => c.repo)).toEqual(['repo1'])

    // sorted by score desc: alice first
    expect(result.authors[0].author).toBe('alice')
    expect(result.authors[1].author).toBe('bob')
  })

  test('two-repo fixture: overlapping authors — sums, daily_scores merge, repos tracking', () => {
    const daily1 = [
      { date: '2024-01-01', score: 2.0 },
      { date: '2024-01-02', score: 3.0 },
    ]
    const daily2 = [
      { date: '2024-01-01', score: 1.0 },
      { date: '2024-01-02', score: 1.5 },
    ]

    const repo1 = makeReport('repo1', [
      {
        author: 'alice',
        commits: 10,
        prs: 2,
        insertions: 100,
        deletions: 20,
        net: 80,
        score: 5.0,
        daily_scores: daily1,
        considered: considered('repo1', 'alice'),
      },
      {
        author: 'bob',
        commits: 3,
        prs: 0,
        insertions: 30,
        deletions: 5,
        net: 25,
        score: 1.5,
        daily_scores: daily1,
        considered: considered('repo1', 'bob'),
      },
    ])

    const repo2 = makeReport('repo2', [
      {
        author: 'alice',
        commits: 6,
        prs: 1,
        insertions: 60,
        deletions: 10,
        net: 50,
        score: 3.0,
        daily_scores: daily2,
        considered: considered('repo2', 'alice'),
      },
    ])

    const result = aggregateBundle([repo1, repo2])

    expect(result.authors).toHaveLength(2)

    const alice = result.authors.find((a) => a.author === 'alice')
    const bob = result.authors.find((a) => a.author === 'bob')

    expect(alice?.commits).toBe(16)
    expect(alice?.prs).toBe(3)
    expect(alice?.insertions).toBe(160)
    expect(alice?.deletions).toBe(30)
    expect(alice?.net).toBe(130)
    expect(alice?.score).toBe(8.0)

    expect(alice?.daily_scores[0].score).toBe(3.0)
    expect(alice?.daily_scores[0].date).toBe('2024-01-01')
    expect(alice?.daily_scores[1].score).toBe(4.5)
    expect(alice?.daily_scores[1].date).toBe('2024-01-02')

    expect(alice?.repos).toEqual(['repo1', 'repo2'])
    expect(bob?.repos).toEqual(['repo1'])
    expect(alice?.considered.commits.map((c) => c.repo)).toEqual([
      'repo1',
      'repo2',
    ])
    expect(alice?.considered.prs.map((p) => p.pr_number)).toEqual([101, 202])
    expect(bob?.considered.commits.map((c) => c.repo)).toEqual(['repo1'])

    // sorted by score desc: alice (8.0) before bob (1.5)
    expect(result.authors[0].author).toBe('alice')
    expect(result.authors[1].author).toBe('bob')
  })

  test('metadata propagation: bundle/window/window_days from first report, generated_at is max', () => {
    const r1 = makeReport('repo1', [], {
      generated_at: '2024-01-04T12:00:00.000Z',
    })
    const r2 = makeReport('repo2', [], {
      generated_at: '2024-01-05T08:00:00.000Z',
    })

    const result = aggregateBundle([r1, r2])

    expect(result.bundle).toBe('acme')
    expect(result.window).toBe('2024-01-01/2024-01-03')
    expect(result.window_days).toBe(3)
    expect(result.generated_at).toBe('2024-01-05T08:00:00.000Z')
  })

  test('empty array throws an error mentioning "empty"', () => {
    expect(() => aggregateBundle([])).toThrow(/empty/i)
  })

  test('mismatched bundle names throws mentioning bundle mismatch', () => {
    const r1 = makeReport('repo1', [], { bundle: 'acme' })
    const r2 = makeReport('repo2', [], { bundle: 'other' })
    expect(() => aggregateBundle([r1, r2])).toThrow(/bundle/i)
  })

  test('mismatched window_days throws mentioning window_days mismatch', () => {
    const r1 = makeReport('repo1', [], { window_days: 7 })
    const r2 = makeReport('repo2', [], { window_days: 14 })
    expect(() => aggregateBundle([r1, r2])).toThrow(/window_days/i)
  })

  test('mismatched daily_scores length throws mentioning length mismatch', () => {
    const r1 = makeReport('repo1', [
      {
        author: 'alice',
        commits: 1,
        prs: 0,
        insertions: 10,
        deletions: 2,
        net: 8,
        score: 1.0,
        daily_scores: [{ date: '2024-01-01', score: 1.0 }],
        considered: considered('repo1', 'alice'),
      },
    ])
    const r2 = makeReport('repo2', [
      {
        author: 'alice',
        commits: 1,
        prs: 0,
        insertions: 10,
        deletions: 2,
        net: 8,
        score: 1.0,
        daily_scores: [
          { date: '2024-01-01', score: 1.0 },
          { date: '2024-01-02', score: 0.5 },
        ],
        considered: considered('repo2', 'alice'),
      },
    ])
    expect(() => aggregateBundle([r1, r2])).toThrow(/length/i)
  })

  test('mismatched daily_scores dates throws mentioning date mismatch', () => {
    const r1 = makeReport('repo1', [
      {
        author: 'alice',
        commits: 1,
        prs: 0,
        insertions: 10,
        deletions: 2,
        net: 8,
        score: 1.0,
        daily_scores: [{ date: '2024-01-01', score: 1.0 }],
        considered: considered('repo1', 'alice'),
      },
    ])
    const r2 = makeReport('repo2', [
      {
        author: 'alice',
        commits: 1,
        prs: 0,
        insertions: 10,
        deletions: 2,
        net: 8,
        score: 1.0,
        daily_scores: [{ date: '2024-01-02', score: 1.0 }],
        considered: considered('repo2', 'alice'),
      },
    ])
    expect(() => aggregateBundle([r1, r2])).toThrow(/date/i)
  })
})
