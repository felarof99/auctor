import type {
  ClassifiedWorkUnit,
  ClassifyRequest,
  ClassifyResponse,
} from '@auctor/shared/api-types'
import { Hono } from 'hono'
import { classifyWorkUnit } from '../classifier/agent'
import { ClassificationCache } from '../classifier/cache'
import { RepoManager } from '../repo/manager'

const REPOS_DIR = process.env.REPOS_DIR || '/tmp/auctor-repos'
const CACHE_DB = process.env.CACHE_DB || '/tmp/auctor-cache.sqlite'

const repoManager = new RepoManager(REPOS_DIR)
const cache = new ClassificationCache(CACHE_DB)

export const classifyRoute = new Hono()

classifyRoute.post('/classify', async (c) => {
  const body = (await c.req.json()) as Partial<ClassifyRequest>

  if (!body.repo_url || typeof body.repo_url !== 'string') {
    return c.json({ error: 'repo_url is required' }, 400)
  }

  if (!Array.isArray(body.work_units)) {
    return c.json({ error: 'work_units is required' }, 400)
  }

  if (body.work_units.length === 0) {
    return c.json({ classifications: [] } satisfies ClassifyResponse, 200)
  }

  const repoDir = await repoManager.ensureRepo(body.repo_url)

  const classifications: ClassifiedWorkUnit[] = []

  for (const unit of body.work_units) {
    const cached = cache.get(unit.id)
    if (cached) {
      classifications.push({ id: unit.id, classification: cached })
      continue
    }

    try {
      const classification = await classifyWorkUnit(unit, repoDir)
      cache.set(unit.id, classification)
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
