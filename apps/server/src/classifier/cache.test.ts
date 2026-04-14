import { afterEach, describe, expect, test } from 'bun:test'
import type { Classification } from '@auctor/shared/classification'
import { unlinkSync } from 'fs'
import { ClassificationCache } from './cache'

const DB_PATH = '/tmp/auctor-cache-test.sqlite'

function cleanup() {
  try {
    unlinkSync(DB_PATH)
  } catch {
    // file may not exist
  }
}

describe('ClassificationCache', () => {
  let cache: ClassificationCache

  afterEach(() => {
    cache?.close()
    cleanup()
  })

  const sampleClassification: Classification = {
    type: 'feature',
    difficulty: 'medium',
    impact_score: 7,
    reasoning: 'Adds new user authentication flow',
  }

  test('get returns null for missing key', () => {
    cache = new ClassificationCache(DB_PATH)
    expect(cache.get('nonexistent')).toBeNull()
  })

  test('set then get returns classification', () => {
    cache = new ClassificationCache(DB_PATH)
    cache.set('wu-1', sampleClassification)
    const result = cache.get('wu-1')
    expect(result).toEqual(sampleClassification)
  })

  test('set overwrites existing entry', () => {
    cache = new ClassificationCache(DB_PATH)
    cache.set('wu-1', sampleClassification)

    const updated: Classification = {
      type: 'bugfix',
      difficulty: 'easy',
      impact_score: 3,
      reasoning: 'Minor null check fix',
    }
    cache.set('wu-1', updated)

    const result = cache.get('wu-1')
    expect(result).toEqual(updated)
  })
})
