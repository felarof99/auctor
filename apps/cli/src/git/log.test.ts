import { describe, expect, test } from 'bun:test'
import { parseTimeWindow } from './log'

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
