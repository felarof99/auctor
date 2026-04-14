import { describe, expect, test } from 'bun:test'
import { calculateScore } from './scoring'

describe('calculateScore', () => {
  test('returns 0 for zero activity', () => {
    const score = calculateScore({
      author: 'alice',
      commits: 0,
      prs: 0,
      insertions: 0,
      deletions: 0,
      net: 0,
    })
    expect(score).toBe(0)
  })

  test('scores a moderately active engineer', () => {
    const score = calculateScore({
      author: 'alice',
      commits: 10,
      prs: 2,
      insertions: 500,
      deletions: 100,
      net: 400,
    })
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('caps at 1.0 for very high activity', () => {
    const score = calculateScore({
      author: 'alice',
      commits: 100,
      prs: 20,
      insertions: 10000,
      deletions: 1000,
      net: 9000,
    })
    expect(score).toBeLessThanOrEqual(1)
  })

  test('higher activity produces higher score', () => {
    const low = calculateScore({
      author: 'alice',
      commits: 2,
      prs: 0,
      insertions: 50,
      deletions: 10,
      net: 40,
    })
    const high = calculateScore({
      author: 'bob',
      commits: 15,
      prs: 4,
      insertions: 1500,
      deletions: 300,
      net: 1200,
    })
    expect(high).toBeGreaterThan(low)
  })
})
