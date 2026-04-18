import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Classification } from '@auctor/shared/classification'
import { Hono } from 'hono'
import {
  buildClassificationCacheKey,
  ClassificationCache,
} from '../classifier/cache'
import type { ClassifierConfig } from '../classifier/config'
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

function createRouteWithDependencies(
  dependencies: Parameters<typeof createClassifyRoute>[0],
): {
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
      ...dependencies,
    }),
  )

  return { app, cache }
}

function localConfig(
  overrides: Partial<ClassifierConfig['local']> = {},
): ClassifierConfig {
  return {
    backend: 'local-agent',
    local: {
      executors: [{ type: 'claude', command: 'claude', model: 'sonnet' }],
      maxParallel: 2,
      timeoutMs: 1000,
      repairAttempts: 1,
      skillPath: '/tmp/classifier-skill',
      extraSkillPaths: [],
      ...overrides,
    },
  }
}

function workUnit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    kind: 'branch-day' as const,
    author: 'dev@example.com',
    branch: 'main',
    date: '2026-04-18',
    commit_shas: ['abc123'],
    commit_messages: ['change'],
    diff: 'diff --git a/file.ts b/file.ts\n+change',
    insertions: 1,
    deletions: 0,
    net: 1,
    ...overrides,
  }
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
  test('returns 400 when request body is malformed JSON', async () => {
    const res = await app.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"repo_path":',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Invalid JSON request body',
    })
  })

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

  test('returns 400 when request includes an unknown top-level field', async () => {
    const repoPath = await mkGitRepo()
    const res = await postClassify({
      repo_path: repoPath,
      repo: 'unexpected',
      work_units: [],
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('unknown')
  })

  test('returns 400 for malformed work unit entries before calling classifier backend', async () => {
    const repoPath = await mkGitRepo()
    let configCalls = 0
    let classifyCalls = 0
    const { app: testApp } = createRouteWithDependencies({
      loadConfig: () => {
        configCalls += 1
        return { backend: 'bedrock', local: localConfig().local }
      },
      classifyWorkUnit: async () => {
        classifyCalls += 1
        return {
          type: 'feature',
          difficulty: 'medium',
          impact_score: 5,
          reasoning: 'should not classify malformed request',
        }
      },
    })

    const res = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [{}],
      }),
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('work_units')
    expect(configCalls).toBe(0)
    expect(classifyCalls).toBe(0)
  })

  test('returns 400 for duplicate work unit ids before calling classifier backend', async () => {
    const repoPath = await mkGitRepo()
    let configCalls = 0
    let classifyCalls = 0
    const { app: testApp } = createRouteWithDependencies({
      loadConfig: () => {
        configCalls += 1
        return { backend: 'bedrock', local: localConfig().local }
      },
      classifyWorkUnit: async () => {
        classifyCalls += 1
        return {
          type: 'feature',
          difficulty: 'medium',
          impact_score: 5,
          reasoning: 'should not classify duplicate request ids',
        }
      },
    })

    const res = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [
          workUnit({ id: 'duplicate-unit', diff: 'first diff' }),
          workUnit({ id: 'duplicate-unit', diff: 'second diff' }),
        ],
      }),
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('duplicate-unit')
    expect(configCalls).toBe(0)
    expect(classifyCalls).toBe(0)
  })

  test('returns 400 for blank work unit ids before calling classifier backend', async () => {
    const repoPath = await mkGitRepo()
    let configCalls = 0
    const { app: testApp } = createRouteWithDependencies({
      loadConfig: () => {
        configCalls += 1
        return { backend: 'bedrock', local: localConfig().local }
      },
    })

    const res = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [workUnit({ id: '' })],
      }),
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('work_units')
    expect(configCalls).toBe(0)
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

  test('does not reuse stale Bedrock cache entries keyed without the default model', async () => {
    const repoPath = await mkGitRepo()
    let classifyCalls = 0
    const staleClassification: Classification = {
      type: 'chore',
      difficulty: 'trivial',
      impact_score: 1,
      reasoning: 'stale null-model cache entry',
    }
    const freshClassification: Classification = {
      type: 'feature',
      difficulty: 'medium',
      impact_score: 7,
      reasoning: 'fresh default-model classification',
    }
    const unit = workUnit()
    const { app: testApp, cache } = createTestRoute(async () => {
      classifyCalls += 1
      return freshClassification
    })
    const staleNullModelKey = buildClassificationCacheKey({
      unit,
      backend: 'bedrock',
      executor: null,
      model: null,
      effort: null,
      promptVersion: 'bedrock-v1',
      skillBundleHash: null,
    })
    cache.setByKey(
      staleNullModelKey,
      unit.id,
      'bedrock',
      null,
      staleClassification,
    )

    const res = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [unit],
      }),
    })

    expect(res.status).toBe(200)
    expect((await res.json()).classifications[0].classification).toEqual(
      freshClassification,
    )
    expect(classifyCalls).toBe(1)
  })

  test('does not reuse local-agent cached classifications across repo paths', async () => {
    const firstRepoPath = await mkGitRepo()
    const secondRepoPath = await mkGitRepo()
    let backendCalls = 0
    const unit = workUnit()
    const { app: testApp } = createRouteWithDependencies({
      loadConfig: () => localConfig(),
      createLocalBackend: async () => ({
        cacheContext: {
          backend: 'local-agent',
          executor: 'executors:hash-a',
          model: null,
          effort: null,
          promptVersion: 'local-agent-v1',
          skillBundleHash: 'skill-hash-a',
        },
        async classifyMany({ repoPath, workUnits }) {
          backendCalls += 1
          return new Map(
            workUnits.map((workUnit) => [
              workUnit.id,
              {
                type: 'feature',
                difficulty: 'medium',
                impact_score: 5,
                reasoning: repoPath,
              } satisfies Classification,
            ]),
          )
        },
      }),
    })

    const first = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: firstRepoPath,
        work_units: [unit],
      }),
    })
    const second = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: secondRepoPath,
        work_units: [unit],
      }),
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstReasoning = (await first.json()).classifications[0]
      .classification.reasoning
    const secondReasoning = (await second.json()).classifications[0]
      .classification.reasoning
    expect(firstReasoning).not.toBe(secondReasoning)
    expect(backendCalls).toBe(2)
  })

  test('selects local-agent backend and returns classifications in request order', async () => {
    const repoPath = await mkGitRepo()
    const calls: string[] = []
    const classifications = new Map<string, Classification>([
      [
        'unit-1',
        {
          type: 'feature',
          difficulty: 'medium',
          impact_score: 7,
          reasoning: 'first local result',
        },
      ],
      [
        'unit-2',
        {
          type: 'bugfix',
          difficulty: 'easy',
          impact_score: 3,
          reasoning: 'second local result',
        },
      ],
    ])
    const { app: testApp } = createRouteWithDependencies({
      loadConfig: () => localConfig(),
      classifyWorkUnit: async () => {
        throw new Error('bedrock should not be called')
      },
      createLocalBackend: async () => ({
        cacheContext: {
          backend: 'local-agent',
          executor: 'executors:hash-a',
          model: null,
          effort: null,
          promptVersion: 'local-agent-v1',
          skillBundleHash: 'skill-hash-a',
        },
        async classifyMany({ workUnits }) {
          calls.push(...workUnits.map((unit) => unit.id))
          return classifications
        },
      }),
    })

    const res = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [workUnit({ id: 'unit-1' }), workUnit({ id: 'unit-2' })],
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      classifications: [
        { id: 'unit-1', classification: classifications.get('unit-1') },
        { id: 'unit-2', classification: classifications.get('unit-2') },
      ],
    })
    expect(calls).toEqual(['unit-1', 'unit-2'])
  })

  test('returns 500 without fallback classification when local-agent fails', async () => {
    const repoPath = await mkGitRepo()
    const { app: testApp } = createRouteWithDependencies({
      loadConfig: () => localConfig(),
      createLocalBackend: async () => ({
        cacheContext: {
          backend: 'local-agent',
          executor: 'executors:hash-a',
          model: null,
          effort: null,
          promptVersion: 'local-agent-v1',
          skillBundleHash: 'skill-hash-a',
        },
        async classifyMany() {
          throw new Error('local executor crashed')
        },
      }),
    })

    const res = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [workUnit()],
      }),
    })

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('local executor crashed')
    expect(json.classifications).toBeUndefined()
  })

  test('does not reuse local-agent cached classifications across skill or config changes', async () => {
    const repoPath = await mkGitRepo()
    let backendCalls = 0
    let skillBundleHash = 'skill-hash-a'
    let executorSignature = 'executors:hash-a'
    const { app: testApp } = createRouteWithDependencies({
      loadConfig: () => localConfig(),
      createLocalBackend: async () => ({
        cacheContext: {
          backend: 'local-agent',
          executor: executorSignature,
          model: null,
          effort: null,
          promptVersion: 'local-agent-v1',
          skillBundleHash,
        },
        async classifyMany({ workUnits }) {
          backendCalls += 1
          return new Map(
            workUnits.map((unit) => [
              unit.id,
              {
                type: 'feature',
                difficulty: 'medium',
                impact_score: 5,
                reasoning: `${skillBundleHash}:${executorSignature}`,
              } satisfies Classification,
            ]),
          )
        },
      }),
    })
    const unit = workUnit()

    const first = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [unit],
      }),
    })
    skillBundleHash = 'skill-hash-b'
    executorSignature = 'executors:hash-b'
    const second = await testApp.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_path: repoPath,
        work_units: [unit],
      }),
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(
      (await first.json()).classifications[0].classification.reasoning,
    ).toBe('skill-hash-a:executors:hash-a')
    expect(
      (await second.json()).classifications[0].classification.reasoning,
    ).toBe('skill-hash-b:executors:hash-b')
    expect(backendCalls).toBe(2)
  })
})
