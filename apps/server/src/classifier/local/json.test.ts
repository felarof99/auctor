import { describe, expect, test } from 'bun:test'
import type { Classification } from '@auctor/shared/classification'
import { parseClassificationJson } from './json'

const sampleClassification: Classification = {
  type: 'feature',
  difficulty: 'medium',
  impact_score: 7,
  reasoning: 'Adds a local classifier path',
}

describe('parseClassificationJson', () => {
  test('parses raw classification JSON', () => {
    expect(
      parseClassificationJson(JSON.stringify(sampleClassification)),
    ).toEqual(sampleClassification)
  })

  test('parses classification JSON from a fenced json block', () => {
    const text = [
      'The classification is:',
      '```json',
      JSON.stringify(sampleClassification, null, 2),
      '```',
    ].join('\n')

    expect(parseClassificationJson(text)).toEqual(sampleClassification)
  })

  test('parses the first balanced JSON object embedded in text', () => {
    const text = `Here is the result: ${JSON.stringify(sampleClassification)}. Done.`

    expect(parseClassificationJson(text)).toEqual(sampleClassification)
  })

  test('skips earlier embedded JSON that does not match the classification schema', () => {
    const text = [
      'Initial metadata:',
      JSON.stringify({ status: 'ok', tokens: 1200 }),
      'Final classification:',
      JSON.stringify(sampleClassification),
    ].join('\n')

    expect(parseClassificationJson(text)).toEqual(sampleClassification)
  })

  test('parses a valid classification nested inside an invalid wrapper object', () => {
    const nestedClassification: Classification = {
      ...sampleClassification,
      reasoning: 'nested',
    }
    const text = [
      'wrapper',
      JSON.stringify({
        metadata: { tokens: 12 },
        classification: nestedClassification,
      }),
    ].join(' ')

    expect(parseClassificationJson(text)).toEqual(nestedClassification)
  })

  test('throws a validation error for invalid classification JSON', () => {
    const invalid = JSON.stringify({
      type: 'not-a-type',
      difficulty: 'medium',
      impact_score: 7,
      reasoning: 'Invalid type',
    })

    expect(() => parseClassificationJson(invalid)).toThrow(
      /^Classification validation failed:/,
    )
  })
})
