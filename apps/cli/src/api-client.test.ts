import { describe, expect, test } from 'bun:test'
import type { WorkUnit } from '@auctor/shared/classification'
import { buildClassifyPayload } from './api-client'

describe('buildClassifyPayload', () => {
  test('builds a valid request body', () => {
    const units: WorkUnit[] = [
      {
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
      },
    ]
    const payload = buildClassifyPayload('https://github.com/user/repo', units)
    expect(payload.repo_url).toBe('https://github.com/user/repo')
    expect(payload.work_units).toHaveLength(1)
    expect(payload.work_units[0].id).toBe('abc')
  })
})
