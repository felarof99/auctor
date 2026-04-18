import { describe, expect, test } from 'bun:test'
import type { WorkUnit } from '@auctor/shared/classification'
import { buildClassifyPayload } from './api-client'

function makeUnit(): WorkUnit {
  return {
    id: 'abc',
    kind: 'branch-day',
    author: 'Alice',
    branch: 'main',
    date: '2026-04-10',
    commit_shas: ['sha1'],
    commit_messages: ['feat: something'],
    diff: '+line',
    insertions: 10,
    deletions: 0,
    net: 10,
  }
}

describe('buildClassifyPayload', () => {
  test('builds a repo_path-only request body', () => {
    const payload = buildClassifyPayload('/Users/me/repo', [makeUnit()])

    expect(payload.repo_path).toBe('/Users/me/repo')
    expect('repo_url' in payload).toBe(false)
    expect(payload.work_units).toHaveLength(1)
    expect(payload.work_units[0].id).toBe('abc')
  })
})
