import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Classification } from '@auctor/shared/classification'
import { Hono } from 'hono'
import { ClassificationCache } from '../classifier/cache'
import { classifyRoute, createClassifyRoute } from './classify'

const app = new Hono()
app.route('/api', classifyRoute)
const tempDirs: string[] = []
const caches: ClassificationCache[] = []

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} failed: ${err}`)
  }
}

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'auctor-classify-route-test-'))
  tempDirs.push(dir)
  return dir
}

async function mkGitRepo(): Promise<string> {
  const dir = mkTmp()
  await run(['git', 'init', '-b', 'main'], dir)
  return dir
}

function postClassify(body: unknown) {
  return app.request('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createTestRoute(classify: () => Promise<Classification>): {
  app: Hono
  cache: ClassificationCache
} {
  const dir = mkTmp()
  const cache = new ClassificationCache(join(dir, 'cache.sqlite'))
  caches.push(cache)

  const app = new Hono()
  app.route(
    '/api',
    createClassifyRoute({
      cache,
      classifyWorkUnit: classify,
    }),
  )

  return { app, cache }
}

afterEach(() => {
  while (caches.length) {
    caches.pop()?.close()
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('POST /api/classify', () => {
  test('returns 400 when repo_path is missing', async () => {
    const res = await postClassify({ work_units: [] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('repo_path')
  })

  test('returns 400 when work_units is missing', async () => {
    const repoPath = await mkGitRepo()
    const res = await postClassify({ repo_path: repoPath })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('work_units')
  })

  test('returns 400 when repo_path is not a git repo', async () => {
    const repoPath = mkTmp()
    const res = await postClassify({
      repo_path: repoPath,
      work_units: [],
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('git repo')
  })

  test('returns 200 with empty classifications for empty work_units', async () => {
    const repoPath = await mkGitRepo()
    const res = await postClassify({ repo_path: repoPath, work_units: [] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.classifications).toEqual([])
  })

  test('does not reuse cached classification when work unit diff changes', async () => {
    const repoPath = await mkGitRepo()
    let classifyCalls = 0
    const classifications: Classification[] = [
      {
        type: 'feature',
        difficulty: 'medium',
        impact_score: 7,
        reasoning: 'first diff',
      },
      {
        type: 'bugfix',
        difficulty: 'easy',
        impact_score: 3,
        reasoning: 'second diff',
      },
    ]
    const { app: testApp } = createTestRoute(async () => {
      const classification = classifications[classifyCalls]
      classifyCalls += 1
      return classification
    })
    const baseUnit = {
      id: 'same-work-unit',
      kind: 'branch-day' as const,
      author: 'dev@example.com',
      branch: 'main',
      date: '2026-04-18',
      commit_shas: ['abc123'],
      commit_messages: ['change'],
      insertions: 1,
      deletions: 0,
      net: 1,
    }

    const first = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [{ ...baseUnit, diff: 'first diff' }],
      }),
    })
    const second = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [{ ...baseUnit, diff: 'second diff' }],
      }),
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await first.json()).classifications[0].classification).toEqual(
      classifications[0],
    )
    expect((await second.json()).classifications[0].classification).toEqual(
      classifications[1],
    )
    expect(classifyCalls).toBe(2)
  })
})
