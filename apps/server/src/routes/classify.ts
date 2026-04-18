import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  ClassifiedWorkUnit,
  ClassifyRequest,
  ClassifyResponse,
} from '@auctor/shared/api-types'
import {
  type Classification,
  type WorkUnit,
  WorkUnitTypeEnum,
} from '@auctor/shared/classification'
import { Hono } from 'hono'
import { z } from 'zod'
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

const WorkUnitSchema = z
  .object({
    id: z.string(),
    kind: WorkUnitTypeEnum,
    author: z.string(),
    branch: z.string(),
    date: z.string(),
    commit_shas: z.array(z.string()),
    commit_messages: z.array(z.string()),
    diff: z.string(),
    insertions: z.number(),
    deletions: z.number(),
    net: z.number(),
  })
  .strict()

const ClassifyRequestSchema = z
  .object({
    repo_path: z.string().min(1),
    work_units: z.array(WorkUnitSchema),
  })
  .strict()

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
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON request body' }, 400)
    }

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
  body: unknown
  cache: ClassificationCache
  classifyWorkUnit: ClassifyWorkUnitFn
  loadConfig: () => ClassifierConfig
  createLocalBackend: (
    config: ClassifierConfig['local'],
  ) => Promise<LocalClassifierBackend>
  json: HonoJson
}): Promise<Response> {
  const parsedRequest = parseClassifyRequest(input.body)
  if (!parsedRequest.ok) {
    return input.json({ error: parsedRequest.error }, 400)
  }

  const body = parsedRequest.data

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

function parseClassifyRequest(
  body: unknown,
): { ok: true; data: ClassifyRequest } | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: 'request body must be an object' }
  }

  const unknownKeys = Object.keys(body).filter(
    (key) => key !== 'repo_path' && key !== 'work_units',
  )
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: `unknown top-level field: ${unknownKeys[0]}`,
    }
  }

  if (!body.repo_path || typeof body.repo_path !== 'string') {
    return { ok: false, error: 'repo_path is required' }
  }

  if (!Array.isArray(body.work_units)) {
    return { ok: false, error: 'work_units is required' }
  }

  const parsed = ClassifyRequestSchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, error: classifyRequestError(parsed.error) }
  }

  return { ok: true, data: parsed.data }
}

function classifyRequestError(error: z.ZodError): string {
  const issue = error.issues[0]
  const topLevelPath = issue?.path[0]

  if (topLevelPath === 'repo_path') return 'repo_path is required'
  if (topLevelPath === 'work_units') return 'work_units contains invalid entry'

  return 'request body is invalid'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
