import { describe, expect, test } from 'bun:test'
import {
  buildMicroscopeReport,
  groupByDay,
  type MicroscopeCommit,
  renderMicroscope,
} from './microscope-output'

const commits: MicroscopeCommit[] = [
  {
    repo: 'main',
    sha: 'aaaaaaabbbbbbb',
    subject: 'fix: X',
    insertions: 10,
    deletions: 2,
    date: new Date('2026-04-17T12:00:00Z'),
  },
  {
    repo: 'docs',
    sha: 'ccccccc1111111',
    subject: 'docs: Y',
    insertions: 5,
    deletions: 0,
    date: new Date('2026-04-17T08:00:00Z'),
  },
  {
    repo: 'main',
    sha: 'deadbee2222222',
    subject: 'feat: Z',
    insertions: 100,
    deletions: 30,
    date: new Date('2026-04-16T20:00:00Z'),
  },
]

describe('groupByDay', () => {
  test('groups commits by YYYY-MM-DD and sorts days descending', () => {
    const days = groupByDay(commits)
    expect(days).toHaveLength(2)
    expect(days[0].date).toBe('2026-04-17')
    expect(days[0].commits).toHaveLength(2)
    expect(days[1].date).toBe('2026-04-16')
    expect(days[1].commits).toHaveLength(1)
  })

  test('sums per-day totals', () => {
    const [today, yesterday] = groupByDay(commits)
    expect(today.totals).toEqual({ commits: 2, insertions: 15, deletions: 2 })
    expect(yesterday.totals).toEqual({
      commits: 1,
      insertions: 100,
      deletions: 30,
    })
  })
})

describe('renderMicroscope', () => {
  test('includes header, day blocks, and repo-tagged commits', () => {
    const out = renderMicroscope({
      username: 'alice',
      bundleName: 'browseros',
      window: '-7d',
      days: groupByDay(commits),
    })
    expect(out).toContain('microscope: alice')
    expect(out).toContain('browseros')
    expect(out).toContain('2026-04-17')
    expect(out).toContain('2026-04-16')
    expect(out).toContain('[main]')
    expect(out).toContain('[docs]')
    expect(out).toContain('fix: X')
    expect(out).toContain('+10/-2')
  })

  test('renders an empty state message when no days', () => {
    const out = renderMicroscope({
      username: 'alice',
      bundleName: 'browseros',
      window: '-7d',
      days: [],
    })
    expect(out).toContain('no commits')
  })
})

describe('buildMicroscopeReport', () => {
  test('builds a JSON-ready report object', () => {
    const days = groupByDay(commits)
    const r = buildMicroscopeReport({
      username: 'alice',
      bundleName: 'browseros',
      window: '-7d',
      days,
    })
    expect(r.bundle).toBe('browseros')
    expect(r.username).toBe('alice')
    expect(r.window).toBe('-7d')
    expect(r.days).toHaveLength(2)
    expect(r.days[0].commits[0]).toMatchObject({
      repo: 'main',
      sha: 'aaaaaaabbbbbbb',
      subject: 'fix: X',
    })
    expect(typeof r.generated_at).toBe('string')
  })
})
