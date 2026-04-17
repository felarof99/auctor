import { describe, expect, test } from 'bun:test'
import { parseGitLog, parseTimeWindow } from './log'

describe('parseTimeWindow', () => {
  test('parses -7d as 7 days ago', () => {
    const result = parseTimeWindow('-7d')
    const expected = new Date()
    expected.setDate(expected.getDate() - 7)
    expected.setHours(0, 0, 0, 0)
    expect(result.getTime()).toBe(expected.getTime())
  })

  test('parses -30d as 30 days ago', () => {
    const result = parseTimeWindow('-30d')
    const expected = new Date()
    expected.setDate(expected.getDate() - 30)
    expected.setHours(0, 0, 0, 0)
    expect(result.getTime()).toBe(expected.getTime())
  })

  test('parses 0d as start of today', () => {
    const result = parseTimeWindow('0d')
    const expected = new Date()
    expected.setHours(0, 0, 0, 0)
    expect(result.getTime()).toBe(expected.getTime())
  })

  test('parses 7d without minus sign', () => {
    const result = parseTimeWindow('7d')
    const expected = new Date()
    expected.setDate(expected.getDate() - 7)
    expected.setHours(0, 0, 0, 0)
    expect(result.getTime()).toBe(expected.getTime())
  })

  test('throws on invalid format', () => {
    expect(() => parseTimeWindow('abc')).toThrow('Invalid time window')
    expect(() => parseTimeWindow('7')).toThrow('Invalid time window')
    expect(() => parseTimeWindow('-7w')).toThrow('Invalid time window')
  })
})

describe('parseGitLog', () => {
  test('parses a single commit with stats', () => {
    const output = `COMMIT_START
abc123def
Alice
2026-04-10T14:30:00-07:00
feat: add user auth

 3 files changed, 45 insertions(+), 12 deletions(-)`

    const commits = parseGitLog(output)
    expect(commits).toHaveLength(1)
    expect(commits[0].sha).toBe('abc123def')
    expect(commits[0].author).toBe('Alice')
    expect(commits[0].subject).toBe('feat: add user auth')
    expect(commits[0].insertions).toBe(45)
    expect(commits[0].deletions).toBe(12)
    expect(commits[0].isMerge).toBe(false)
  })

  test('parses author email when present', () => {
    const output = `COMMIT_START
abc123def
Nikhil Sonti
nikhilsv92@gmail.com
2026-04-10T14:30:00-07:00
feat: add user auth

 3 files changed, 45 insertions(+), 12 deletions(-)`

    const commits = parseGitLog(output)
    expect(commits).toHaveLength(1)
    expect(commits[0].author).toBe('Nikhil Sonti')
    expect(commits[0].authorEmail).toBe('nikhilsv92@gmail.com')
    expect(commits[0].date.toISOString()).toBe('2026-04-10T21:30:00.000Z')
    expect(commits[0].subject).toBe('feat: add user auth')
  })

  test('parses multiple commits', () => {
    const output = `COMMIT_START
abc123
Alice
2026-04-10T14:30:00-07:00
feat: add auth

 2 files changed, 45 insertions(+), 12 deletions(-)
COMMIT_START
def456
Bob
2026-04-09T10:00:00-07:00
fix: typo

 1 file changed, 1 insertion(+), 1 deletion(-)`

    const commits = parseGitLog(output)
    expect(commits).toHaveLength(2)
    expect(commits[0].author).toBe('Alice')
    expect(commits[1].author).toBe('Bob')
    expect(commits[1].insertions).toBe(1)
    expect(commits[1].deletions).toBe(1)
  })

  test('handles commit with no stat line (no file changes)', () => {
    const output = `COMMIT_START
abc123
Alice
2026-04-10T14:30:00-07:00
Merge branch 'main'`

    const commits = parseGitLog(output)
    expect(commits).toHaveLength(1)
    expect(commits[0].insertions).toBe(0)
    expect(commits[0].deletions).toBe(0)
  })

  test('handles insertions only (no deletions)', () => {
    const output = `COMMIT_START
abc123
Alice
2026-04-10T14:30:00-07:00
feat: new file

 1 file changed, 50 insertions(+)`

    const commits = parseGitLog(output)
    expect(commits[0].insertions).toBe(50)
    expect(commits[0].deletions).toBe(0)
  })

  test('returns empty array for empty output', () => {
    expect(parseGitLog('')).toEqual([])
    expect(parseGitLog('  \n  ')).toEqual([])
  })
})
