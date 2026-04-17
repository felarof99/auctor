import { describe, expect, test } from 'bun:test'
import {
  aggregateBundleResults,
  type PerRepoScoredUnit,
} from './analyze-aggregate'

describe('aggregateBundleResults', () => {
  test('sums commits, prs, LOC, and scores across repos per author', () => {
    const units: PerRepoScoredUnit[] = [
      {
        author: 'alice',
        repoName: 'main',
        date: '2026-04-15',
        score: 0.5,
        commits: 2,
        isPr: false,
        insertions: 40,
        deletions: 10,
        considered: {
          commits: [
            { repo: 'main', sha: 'alice-main-1', message: 'feat: alice main' },
          ],
          prs: [],
        },
      },
      {
        author: 'alice',
        repoName: 'docs',
        date: '2026-04-16',
        score: 0.3,
        commits: 1,
        isPr: true,
        insertions: 20,
        deletions: 5,
        considered: {
          commits: [],
          prs: [
            {
              repo: 'docs',
              sha: 'alice-docs-merge',
              pr_number: 42,
              message: 'feat: docs (#42)',
            },
          ],
        },
      },
      {
        author: 'bob',
        repoName: 'main',
        date: '2026-04-15',
        score: 0.2,
        commits: 1,
        isPr: false,
        insertions: 10,
        deletions: 0,
        considered: {
          commits: [
            { repo: 'main', sha: 'bob-main-1', message: 'fix: bob main' },
          ],
          prs: [],
        },
      },
    ]

    const since = new Date('2026-04-14T00:00:00Z')
    const out = aggregateBundleResults(units, since, 7)

    const alice = out.find((a) => a.author === 'alice')
    expect(alice).toBeDefined()
    if (!alice) return
    expect(alice.commits).toBe(3)
    expect(alice.prs).toBe(1)
    expect(alice.insertions).toBe(60)
    expect(alice.deletions).toBe(15)
    expect(alice.net).toBe(45)
    expect(alice.score).toBeGreaterThan(0)
    expect(alice.daily_scores.length).toBe(7)
    expect(alice.considered.commits).toEqual([
      { repo: 'main', sha: 'alice-main-1', message: 'feat: alice main' },
    ])
    expect(alice.considered.prs).toEqual([
      {
        repo: 'docs',
        sha: 'alice-docs-merge',
        pr_number: 42,
        message: 'feat: docs (#42)',
      },
    ])

    const bob = out.find((a) => a.author === 'bob')
    expect(bob).toBeDefined()
    if (!bob) return
    expect(bob.commits).toBe(1)
    expect(bob.prs).toBe(0)
    expect(bob.insertions).toBe(10)
    expect(bob.deletions).toBe(0)
    expect(bob.considered.commits).toEqual([
      { repo: 'main', sha: 'bob-main-1', message: 'fix: bob main' },
    ])
    expect(bob.considered.prs).toEqual([])

    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score)
  })

  test('returns empty array when no units', () => {
    expect(aggregateBundleResults([], new Date(), 7)).toEqual([])
  })
})
