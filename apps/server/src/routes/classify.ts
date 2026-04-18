import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  ClassifiedWorkUnit,
  ClassifyRequest,
  ClassifyResponse,
} from '@auctor/shared/api-types'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import { Hono } from 'hono'
import { classifyWorkUnit as classifyWithBedrock } from '../classifier/agent'
import {
  buildClassificationCacheKey,
  ClassificationCache,
} from '../classifier/cache'

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

  route.post('/classify', async (c) => {
    const body = (await c.req.json()) as Partial<ClassifyRequest>

    if (!body.repo_path || typeof body.repo_path !== 'string') {
      return c.json({ error: 'repo_path is required' }, 400)
    }

    if (!Array.isArray(body.work_units)) {
      return c.json({ error: 'work_units is required' }, 400)
    }

    const repoPath = await resolveGitRepoPath(body.repo_path)
    if (!repoPath) {
      return c.json({ error: 'repo_path must point to a git repo' }, 400)
    }

    if (body.work_units.length === 0) {
      return c.json({ classifications: [] } satisfies ClassifyResponse, 200)
    }

    const classifications: ClassifiedWorkUnit[] = []

    for (const unit of body.work_units) {
      const cacheKey = buildBedrockCacheKey(unit)
      const cached = cache.getByKey(cacheKey)
      if (cached) {
        classifications.push({ id: unit.id, classification: cached })
        continue
      }

      try {
        const classification = await classifyWorkUnit(unit, repoPath)
        cache.setByKey(cacheKey, unit.id, 'bedrock', null, classification)
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

    return c.json({ classifications } satisfies ClassifyResponse)
  })

  return route
}

export const classifyRoute = createClassifyRoute()
