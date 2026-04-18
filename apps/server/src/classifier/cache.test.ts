import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import {
  buildClassificationCacheKey,
  ClassificationCache,
  type ClassificationCacheKeyInput,
} from './cache'

function createTempDbPath(): { dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'auctor-cache-test-'))
  return { dbPath: join(dir, 'cache.sqlite'), dir }
}

const sampleClassification: Classification = {
  type: 'feature',
  difficulty: 'medium',
  impact_score: 7,
  reasoning: 'Adds new user authentication flow',
}

function baseWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'wu-1',
    kind: 'branch-day',
    author: 'dev@example.com',
    branch: 'feat/local-agent-classifier',
    date: '2026-04-18',
    commit_shas: ['abc123', 'def456'],
    commit_messages: ['Add local classifier', 'Wire cache'],
    diff: 'diff-content-1',
    insertions: 12,
    deletions: 3,
    net: 9,
    ...overrides,
  }
}

function baseCacheKeyInput(
  overrides: Partial<ClassificationCacheKeyInput> = {},
): ClassificationCacheKeyInput {
  return {
    unit: baseWorkUnit(),
    backend: 'local',
    executor: 'claude',
    model: 'claude-sonnet-4-5',
    effort: 'medium',
    promptVersion: 'classifier-v1',
    skillBundleHash: 'skills-1',
    ...overrides,
  }
}

describe('buildClassificationCacheKey', () => {
  test('changes when unit diff changes', () => {
    const first = buildClassificationCacheKey(baseCacheKeyInput())
    const second = buildClassificationCacheKey(
      baseCacheKeyInput({ unit: baseWorkUnit({ diff: 'diff-content-2' }) }),
    )

    expect(second).not.toBe(first)
  })

  test('preserves commit SHA order in the cache key', () => {
    const first = buildClassificationCacheKey(baseCacheKeyInput())
    const second = buildClassificationCacheKey(
      baseCacheKeyInput({
        unit: baseWorkUnit({ commit_shas: ['def456', 'abc123'] }),
      }),
    )

    expect(second).not.toBe(first)
  })

  test('changes when skill bundle hash changes', () => {
    const first = buildClassificationCacheKey(baseCacheKeyInput())
    const second = buildClassificationCacheKey(
      baseCacheKeyInput({ skillBundleHash: 'skills-2' }),
    )

    expect(second).not.toBe(first)
  })

  test('is stable for equivalent input object key ordering', () => {
    const first = buildClassificationCacheKey(baseCacheKeyInput())
    const second = buildClassificationCacheKey({
      backend: 'local',
      effort: 'medium',
      executor: 'claude',
      model: 'claude-sonnet-4-5',
      promptVersion: 'classifier-v1',
      skillBundleHash: 'skills-1',
      unit: baseWorkUnit(),
    })

    expect(second).toBe(first)
  })
})

describe('ClassificationCache', () => {
  let cache: ClassificationCache | undefined
  let tempDir: string | undefined

  afterEach(() => {
    cache?.close()
    cache = undefined
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true })
      tempDir = undefined
    }
  })

  function openCache(): ClassificationCache {
    const temp = createTempDbPath()
    tempDir = temp.dir
    cache = new ClassificationCache(temp.dbPath)
    return cache
  }

  test('getByKey returns null for missing cache key', () => {
    const opened = openCache()

    expect(opened.getByKey('missing-key')).toBeNull()
  })

  test('setByKey then getByKey returns classification', () => {
    const opened = openCache()
    const cacheKey = buildClassificationCacheKey(baseCacheKeyInput())

    opened.setByKey(cacheKey, 'wu-1', 'local', 'claude', sampleClassification)

    expect(opened.getByKey(cacheKey)).toEqual(sampleClassification)
  })

  test('legacy set then get still uses work unit id as cache key', () => {
    const opened = openCache()

    opened.set('wu-legacy', sampleClassification)

    expect(opened.get('wu-legacy')).toEqual(sampleClassification)
    expect(opened.getByKey('wu-legacy')).toEqual(sampleClassification)
  })

  test('migrates legacy schema and preserves existing classifications', () => {
    const temp = createTempDbPath()
    tempDir = temp.dir

    const legacyDb = new Database(temp.dbPath)
    legacyDb.exec(`
      CREATE TABLE classifications (
        work_unit_id TEXT PRIMARY KEY,
        classification_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `)
    legacyDb
      .prepare(
        'INSERT INTO classifications (work_unit_id, classification_json) VALUES (?, ?)',
      )
      .run('wu-old', JSON.stringify(sampleClassification))
    legacyDb.close()

    cache = new ClassificationCache(temp.dbPath)

    expect(cache.get('wu-old')).toEqual(sampleClassification)
    expect(cache.getByKey('wu-old')).toEqual(sampleClassification)
  })
})
