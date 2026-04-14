import { describe, expect, test } from 'bun:test'
import {
  calculateAuthorScore,
  calculateLocFactor,
  calculateUnitScore,
} from './scoring'

describe('calculateLocFactor', () => {
  test('returns 0 for 0 LOC', () => {
    expect(calculateLocFactor(0)).toBe(0)
  })

  test('returns ~0.50 for 100 LOC', () => {
    const result = calculateLocFactor(100)
    expect(result).toBeGreaterThan(0.49)
    expect(result).toBeLessThan(0.52)
  })

  test('returns ~0.75 for 1000 LOC', () => {
    const result = calculateLocFactor(1000)
    expect(result).toBeGreaterThan(0.74)
    expect(result).toBeLessThan(0.76)
  })

  test('caps at 1.0 for 10000 LOC', () => {
    expect(calculateLocFactor(10000)).toBe(1.0)
  })

  test('caps at 1.0 for LOC exceeding cap', () => {
    expect(calculateLocFactor(50000)).toBe(1.0)
  })

  test('handles negative LOC (deletions)', () => {
    const positive = calculateLocFactor(500)
    const negative = calculateLocFactor(-500)
    expect(negative).toBeCloseTo(positive, 10)
  })
})

describe('calculateUnitScore', () => {
  test('hard feature with 400 LOC and impact 8 scores ~0.88', () => {
    const score = calculateUnitScore({
      net_loc: 400,
      difficulty: 'hard',
      type: 'feature',
      impact_score: 8,
    })
    expect(score).toBeGreaterThan(0.85)
    expect(score).toBeLessThan(0.92)
  })

  test('chore trivial scores low (< 0.1)', () => {
    const score = calculateUnitScore({
      net_loc: 10,
      difficulty: 'trivial',
      type: 'chore',
      impact_score: 1,
    })
    expect(score).toBeLessThan(0.1)
  })

  test('complex feature scores high (> 1.2)', () => {
    const score = calculateUnitScore({
      net_loc: 5000,
      difficulty: 'complex',
      type: 'feature',
      impact_score: 9,
    })
    expect(score).toBeGreaterThan(1.2)
  })
})

describe('calculateAuthorScore', () => {
  test('averages unit scores over days in window', () => {
    const scores = [0.5, 1.0, 1.5]
    const result = calculateAuthorScore(scores, 7)
    expect(result).toBeCloseTo(3.0 / 7, 10)
  })

  test('returns 0 for empty unit scores', () => {
    expect(calculateAuthorScore([], 7)).toBe(0)
  })
})
