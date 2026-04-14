import { describe, expect, test } from 'bun:test'
import type { Commit } from '../types'
import { extractBranchDayUnits, extractPrUnits } from './work-units'

function makeCommit(overrides: Partial<Commit> & { sha: string }): Commit {
  return {
    sha: overrides.sha,
    author: overrides.author ?? 'Alice',
    date: overrides.date ?? new Date('2026-04-10T12:00:00Z'),
    subject: overrides.subject ?? 'feat: something',
    insertions: overrides.insertions ?? 10,
    deletions: overrides.deletions ?? 5,
    isMerge: overrides.isMerge ?? false,
  }
}

describe('extractBranchDayUnits', () => {
  test('two commits from same author same day become one unit with summed stats', () => {
    const commits: Commit[] = [
      makeCommit({ sha: 'aaa', insertions: 10, deletions: 2 }),
      makeCommit({ sha: 'bbb', insertions: 20, deletions: 8 }),
    ]
    const units = extractBranchDayUnits(commits, 'main')
    expect(units).toHaveLength(1)
    expect(units[0].insertions).toBe(30)
    expect(units[0].deletions).toBe(10)
    expect(units[0].net).toBe(20)
    expect(units[0].commit_shas).toHaveLength(2)
    expect(units[0].kind).toBe('branch-day')
    expect(units[0].author).toBe('Alice')
    expect(units[0].branch).toBe('main')
  })

  test('commits on different days produce separate units', () => {
    const commits: Commit[] = [
      makeCommit({ sha: 'aaa', date: new Date('2026-04-10T12:00:00Z') }),
      makeCommit({ sha: 'bbb', date: new Date('2026-04-11T12:00:00Z') }),
    ]
    const units = extractBranchDayUnits(commits, 'main')
    expect(units).toHaveLength(2)
    const dates = units.map((u) => u.date).sort()
    expect(dates).toEqual(['2026-04-10', '2026-04-11'])
  })

  test('commits from different authors on same day produce separate units', () => {
    const commits: Commit[] = [
      makeCommit({ sha: 'aaa', author: 'Alice' }),
      makeCommit({ sha: 'bbb', author: 'Bob' }),
    ]
    const units = extractBranchDayUnits(commits, 'main')
    expect(units).toHaveLength(2)
    const authors = units.map((u) => u.author).sort()
    expect(authors).toEqual(['Alice', 'Bob'])
  })

  test('id is 16 hex chars', () => {
    const commits = [makeCommit({ sha: 'aaa' })]
    const units = extractBranchDayUnits(commits, 'main')
    expect(units[0].id).toMatch(/^[0-9a-f]{16}$/)
  })

  test('empty commits returns empty array', () => {
    expect(extractBranchDayUnits([], 'main')).toEqual([])
  })
})

describe('extractPrUnits', () => {
  test('filters to only merge commits', () => {
    const commits: Commit[] = [
      makeCommit({ sha: 'aaa', isMerge: false }),
      makeCommit({ sha: 'bbb', isMerge: true }),
      makeCommit({ sha: 'ccc', isMerge: false }),
    ]
    const units = extractPrUnits(commits)
    expect(units).toHaveLength(1)
    expect(units[0].commit_shas).toEqual(['bbb'])
    expect(units[0].kind).toBe('pr')
  })

  test('returns empty array when no merge commits', () => {
    const commits = [makeCommit({ sha: 'aaa', isMerge: false })]
    expect(extractPrUnits(commits)).toEqual([])
  })

  test('each merge commit becomes its own pr unit', () => {
    const commits: Commit[] = [
      makeCommit({
        sha: 'merge1',
        isMerge: true,
        insertions: 50,
        deletions: 10,
      }),
      makeCommit({
        sha: 'merge2',
        isMerge: true,
        insertions: 30,
        deletions: 5,
      }),
    ]
    const units = extractPrUnits(commits)
    expect(units).toHaveLength(2)
    expect(units[0].net).toBe(40)
    expect(units[1].net).toBe(25)
  })

  test('pr unit has correct date format YYYY-MM-DD', () => {
    const commits = [
      makeCommit({
        sha: 'aaa',
        isMerge: true,
        date: new Date('2026-04-10T12:00:00Z'),
      }),
    ]
    const units = extractPrUnits(commits)
    expect(units[0].date).toBe('2026-04-10')
  })
})
