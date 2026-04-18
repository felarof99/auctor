import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  ClassifiedWorkUnit,
  ClassifyRequest,
  ClassifyResponse,
} from '@auctor/shared/api-types'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import { Hono } from 'hono'
import {
  BedrockClassifierBackend,
  classifyWorkUnit as classifyWithBedrock,
} from '../classifier/agent'
import type { ClassifierBackend } from '../classifier/backend'
import {
  buildClassificationCacheKey,
  ClassificationCache,
} from '../classifier/cache'
import {
  type ClassifierConfig,
  loadClassifierConfig,
} from '../classifier/config'
import {
  createLocalAgentClassifierBackend,
  type LocalAgentCacheContext,
} from '../classifier/local/backend'

const CACHE_DB = process.env.CACHE_DB || '/tmp/auctor-cache.sqlite'

// Ensure the cache directory exists before opening SQLite.
mkdirSync(dirname(CACHE_DB), { recursive: true })

const defaultCache = new ClassificationCache(CACHE_DB)

type ClassifyWorkUnitFn = (
  unit: WorkUnit,
  repoPath: string,
) => Promise<Classification>

interface ClassifyRouteDependencies {
  cache?: ClassificationCache
  classifyWorkUnit?: ClassifyWorkUnitFn
  loadConfig?: () => ClassifierConfig
  createLocalBackend?: (
    config: ClassifierConfig['local'],
  ) => Promise<LocalClassifierBackend>
}

interface LocalClassifierBackend extends ClassifierBackend {
  cacheContext: LocalAgentCacheContext
}

async function resolveGitRepoPath(repoPath: string): Promise<string | null> {
  const proc = Bun.spawn(
    ['git', '-C', repoPath, 'rev-parse', '--show-toplevel'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])
  if (code !== 0) return null
  return stdout.trim()
}

function buildBedrockCacheKey(unit: WorkUnit): string {
  return buildClassificationCacheKey({
    unit,
    backend: 'bedrock',
    executor: null,
    model: process.env.BEDROCK_MODEL_ID ?? null,
    effort: null,
    promptVersion: 'bedrock-v1',
    skillBundleHash: null,
  })
}

export function createClassifyRoute(
  dependencies: ClassifyRouteDependencies = {},
): Hono {
  const route = new Hono()
  const cache = dependencies.cache ?? defaultCache
  const classifyWorkUnit = dependencies.classifyWorkUnit ?? classifyWithBedrock
  const loadConfig = dependencies.loadConfig ?? loadClassifierConfig
  const createLocalBackend =
    dependencies.createLocalBackend ?? createLocalAgentClassifierBackend

  route.post('/classify', async (c) => {
    const body = (await c.req.json()) as Partial<ClassifyRequest>

    return handleClassifyRequest({
      body,
      cache,
      classifyWorkUnit,
      loadConfig,
      createLocalBackend,
      json: c.json.bind(c),
    })
  })

  return route
}

export const classifyRoute = createClassifyRoute()

async function handleClassifyRequest(input: {
  body: Partial<ClassifyRequest>
  cache: ClassificationCache
  classifyWorkUnit: ClassifyWorkUnitFn
  loadConfig: () => ClassifierConfig
  createLocalBackend: (
    config: ClassifierConfig['local'],
  ) => Promise<LocalClassifierBackend>
  json: HonoJson
}): Promise<Response> {
  const { body } = input

  if (!body.repo_path || typeof body.repo_path !== 'string') {
    return input.json({ error: 'repo_path is required' }, 400)
  }

  if (!Array.isArray(body.work_units)) {
    return input.json({ error: 'work_units is required' }, 400)
  }

  const repoPath = await resolveGitRepoPath(body.repo_path)
  if (!repoPath) {
    return input.json({ error: 'repo_path must point to a git repo' }, 400)
  }

  if (body.work_units.length === 0) {
    return input.json({ classifications: [] } satisfies ClassifyResponse, 200)
  }

  let config: ClassifierConfig
  try {
    config = input.loadConfig()
  } catch (err) {
    return input.json(
      { error: errorMessage(err, 'classifier config failed') },
      500,
    )
  }

  if (config.backend === 'local-agent') {
    let backend: LocalClassifierBackend
    try {
      backend = await input.createLocalBackend(config.local)
    } catch (err) {
      return input.json(
        { error: errorMessage(err, 'local classifier setup failed') },
        500,
      )
    }

    return classifyWithLocalBackend({
      cache: input.cache,
      backend,
      repoPath,
      workUnits: body.work_units,
      json: input.json,
    })
  }

  return classifyWithBedrockBackend({
    cache: input.cache,
    backend: new BedrockClassifierBackend(input.classifyWorkUnit),
    repoPath,
    workUnits: body.work_units,
    json: input.json,
  })
}

async function classifyWithBedrockBackend(input: {
  cache: ClassificationCache
  backend: BedrockClassifierBackend
  repoPath: string
  workUnits: WorkUnit[]
  json: HonoJson
}): Promise<Response> {
  const classifications: ClassifiedWorkUnit[] = []

  for (const unit of input.workUnits) {
    const cacheKey = buildBedrockCacheKey(unit)
    const cached = input.cache.getByKey(cacheKey)
    if (cached) {
      classifications.push({ id: unit.id, classification: cached })
      continue
    }

    try {
      const result = await input.backend.classifyMany({
        repoPath: input.repoPath,
        workUnits: [unit],
      })
      const classification = result.get(unit.id)
      if (!classification) {
        throw new Error(`Bedrock returned no classification for ${unit.id}`)
      }
      input.cache.setByKey(cacheKey, unit.id, 'bedrock', null, classification)
      classifications.push({ id: unit.id, classification })
    } catch (err) {
      console.warn(
        `Classification failed for ${unit.id}, using default:`,
        err instanceof Error ? err.message : err,
      )
      const fallback = {
        type: 'feature' as const,
        difficulty: 'medium' as const,
        impact_score: 5,
        reasoning: `Classification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      }
      classifications.push({ id: unit.id, classification: fallback })
    }
  }

  return input.json({ classifications } satisfies ClassifyResponse)
}

async function classifyWithLocalBackend(input: {
  cache: ClassificationCache
  backend: LocalClassifierBackend
  repoPath: string
  workUnits: WorkUnit[]
  json: HonoJson
}) {
  const results: (ClassifiedWorkUnit | undefined)[] = new Array(
    input.workUnits.length,
  )
  const missing: { index: number; unit: WorkUnit; cacheKey: string }[] = []

  input.workUnits.forEach((unit, index) => {
    const cacheKey = buildLocalCacheKey(unit, input.backend.cacheContext)
    const cached = input.cache.getByKey(cacheKey)

    if (cached) {
      results[index] = { id: unit.id, classification: cached }
      return
    }

    missing.push({ index, unit, cacheKey })
  })

  if (missing.length > 0) {
    let classified: Map<string, Classification>
    try {
      classified = await input.backend.classifyMany({
        repoPath: input.repoPath,
        workUnits: missing.map((item) => item.unit),
      })
    } catch (err) {
      return input.json(
        { error: errorMessage(err, 'local classifier failed') },
        500,
      )
    }

    for (const item of missing) {
      const classification = classified.get(item.unit.id)
      if (!classification) {
        return input.json(
          {
            error: `local classifier returned no classification for ${item.unit.id}`,
          },
          500,
        )
      }

      input.cache.setByKey(
        item.cacheKey,
        item.unit.id,
        input.backend.cacheContext.backend,
        input.backend.cacheContext.executor,
        classification,
      )
      results[item.index] = { id: item.unit.id, classification }
    }
  }

  return input.json({
    classifications: results as ClassifiedWorkUnit[],
  } satisfies ClassifyResponse)
}

function buildLocalCacheKey(
  unit: WorkUnit,
  context: LocalAgentCacheContext,
): string {
  return buildClassificationCacheKey({
    unit,
    backend: context.backend,
    executor: context.executor,
    model: context.model,
    effort: context.effort,
    promptVersion: context.promptVersion,
    skillBundleHash: context.skillBundleHash,
  })
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

type HonoJson = (object: object, status?: 200 | 400 | 500) => Response
