import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ConvexClient } from '@auctor/database/client'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import {
  DIFFICULTY_WEIGHTS,
  TYPE_WEIGHTS,
} from '@auctor/shared/scoring-weights'
import {
  aggregateBundleResults,
  type PerRepoScoredUnit,
} from '../analyze-aggregate'
import { classifyWorkUnits } from '../api-client'
import { loadBundle } from '../bundle'
import {
  buildWorkUnitPayload,
  createConvexClient,
  ensureAuthors,
  ensureRepo,
  findExistingWorkUnit,
  insertAnalysisRun,
  insertWorkUnit,
} from '../convex-client'
import { getDiffForCommits } from '../git/diff'
import { fetchAllBranches } from '../git/fetch'
import {
  getGitLog,
  getMergeCommits,
  parseGitLog,
  parseTimeWindow,
} from '../git/log'
import { extractBranchDayUnits, extractPrUnits } from '../git/work-units'
import { renderLeaderboard, renderSparklines } from '../output'
import { calculateLocFactor, calculateUnitScore } from '../scoring'
import type { BundleConfig, BundleRepo } from '../types'

export async function analyze(
  configPath: string,
  timeWindow: string,
  jsonPath?: string,
  options?: { fetch?: boolean },
): Promise<void> {
  const absoluteConfigPath = resolve(configPath)
  const bundle = await loadBundle(absoluteConfigPath)

  const validRepos = bundle.repos.filter((r) => {
    if (!existsSync(`${r.path}/.git`)) {
      console.warn(`Skipping ${r.name}: ${r.path} is not a git repo`)
      return false
    }
    return true
  })
  if (validRepos.length === 0) {
    console.error('No valid repos in bundle.')
    process.exit(1)
  }
  if (bundle.engineers.length === 0) {
    console.error('No engineers in bundle. Run `auctor configure` first.')
    process.exit(1)
  }

  const since = parseTimeWindow(timeWindow)
  const daysMatch = timeWindow.match(/^-?(\d+)d$/)
  const daysInWindow = daysMatch ? Number.parseInt(daysMatch[1], 10) : 7

  let convexClient: ConvexClient | null = null
  let bundleRepoId: string | null = null
  let bundleAuthorIdMap = new Map<string, string>()
  if (bundle.convex_url) {
    try {
      convexClient = createConvexClient(bundle.convex_url)
      bundleRepoId = await ensureRepo(convexClient, bundle.name)
      bundleAuthorIdMap = await ensureAuthors(
        convexClient,
        bundleRepoId,
        bundle.engineers.map((username) => ({ username, whitelisted: true })),
      )
    } catch (err) {
      console.warn(
        'Warning: Convex initialization failed, continuing without cache.',
        err,
      )
      convexClient = null
      bundleRepoId = null
      bundleAuthorIdMap = new Map()
    }
  }

  const allScoredUnits: PerRepoScoredUnit[] = []
  for (const repo of validRepos) {
    const units = await analyzeSingleRepo(
      repo,
      bundle,
      since,
      convexClient,
      options,
    )
    allScoredUnits.push(...units)
  }

  const leaderboard = aggregateBundleResults(
    allScoredUnits,
    since,
    daysInWindow,
  )

  if (convexClient && bundleRepoId) {
    try {
      await insertAnalysisRun(convexClient, {
        repoId: bundleRepoId,
        timeWindow,
        analyzedAt: new Date().toISOString(),
        daysInWindow,
        authorScores: leaderboard.map((s) => ({
          authorId: bundleAuthorIdMap.get(s.author) ?? '',
          username: s.author,
          commits: s.commits,
          locAdded: s.insertions,
          locRemoved: s.deletions,
          locNet: s.net,
          score: s.score,
        })),
      })
    } catch (err) {
      console.warn('Warning: Failed to upload analysis run.', err)
    }
  }

  const plural = validRepos.length === 1 ? '' : 's'
  console.log(`\n${bundle.name} (${validRepos.length} repo${plural})`)
  console.log(renderLeaderboard(leaderboard))
  console.log(renderSparklines(leaderboard))

  const resultsDir = join(dirname(absoluteConfigPath), '.results')
  mkdirSync(resultsDir, { recursive: true })
  const resultPath = join(resultsDir, `${bundle.name}.json`)
  const result = {
    bundle: bundle.name,
    repos: validRepos.map((r) => r.name),
    window: timeWindow,
    analyzed_at: new Date().toISOString(),
    authors: leaderboard.map((s) => ({
      name: s.author,
      score: s.score,
      commits: s.commits,
      prs: s.prs,
      loc_added: s.insertions,
      loc_removed: s.deletions,
      loc_net: s.net,
      daily_scores: s.daily_scores,
    })),
  }
  await Bun.write(resultPath, JSON.stringify(result, null, 2))
  console.log(`\nResults written to ${resultPath}`)

  if (jsonPath) {
    const reportPath = resolve(jsonPath)
    mkdirSync(dirname(reportPath), { recursive: true })
    const report = {
      repo: bundle.name,
      generated_at: new Date().toISOString(),
      window_days: daysInWindow,
      authors: leaderboard.map((s) => ({
        author: s.author,
        commits: s.commits,
        prs: s.prs,
        insertions: s.insertions,
        deletions: s.deletions,
        net: s.net,
        score: Number(s.score.toFixed(4)),
      })),
    }
    await Bun.write(reportPath, JSON.stringify(report, null, 2))
    console.log(`Report written to ${reportPath}`)
  }

  if (convexClient) await convexClient.close()
}

async function analyzeSingleRepo(
  repo: BundleRepo,
  bundle: BundleConfig,
  since: Date,
  convexClient: ConvexClient | null,
  options?: { fetch?: boolean },
): Promise<PerRepoScoredUnit[]> {
  console.log(`\n[${repo.name}] analyzing ${repo.path}`)

  if (options?.fetch !== false) {
    try {
      await fetchAllBranches(repo.path)
    } catch (err) {
      console.warn(
        `[${repo.name}] git fetch failed, using local refs only. Coverage may be incomplete.`,
      )
      console.warn(String(err))
    }
  }

  let repoId: string | null = null
  let authorIdMap = new Map<string, string>()
  if (convexClient) {
    try {
      repoId = await ensureRepo(convexClient, repo.name)
      authorIdMap = await ensureAuthors(
        convexClient,
        repoId,
        bundle.engineers.map((username) => ({ username, whitelisted: true })),
      )
    } catch (err) {
      console.warn(`Warning: Convex init for ${repo.name} failed.`, err)
    }
  }

  const [logOutput, mergeShas] = await Promise.all([
    getGitLog(repo.path, since),
    getMergeCommits(repo.path, since),
  ])
  let commits = parseGitLog(logOutput)
  for (const commit of commits) {
    commit.isMerge = mergeShas.has(commit.sha)
  }
  const engineerSet = new Set(bundle.engineers)
  commits = commits.filter((c) => engineerSet.has(c.author))
  if (commits.length === 0) return []

  const branchDayUnits = extractBranchDayUnits(commits, 'main')
  const prUnits = extractPrUnits(commits)
  const shellUnits = [...branchDayUnits, ...prUnits]

  const hydratedUnits: WorkUnit[] = await Promise.all(
    shellUnits.map(async (unit) => {
      const diff = await getDiffForCommits(repo.path, unit.commit_shas)
      return { ...unit, diff }
    }),
  )

  const classificationMap = new Map<string, Classification>()
  const cachedIds = new Set<string>()
  let uncachedUnits = hydratedUnits
  if (convexClient && repoId) {
    for (const unit of hydratedUnits) {
      const authorId = authorIdMap.get(unit.author)
      if (!authorId) continue
      try {
        const unitType = unit.kind === 'branch-day' ? 'branch_day' : unit.kind
        const cached = await findExistingWorkUnit(
          convexClient,
          repoId,
          authorId,
          unit.date,
          unitType as 'pr' | 'branch_day',
          unit.branch,
        )
        if (cached) {
          cachedIds.add(unit.id)
          classificationMap.set(unit.id, {
            type: cached.classificationType,
            difficulty: cached.difficultyLevel,
            impact_score: cached.impactScore,
            reasoning: cached.reasoning,
          })
        }
      } catch {
        // skip cache check on error
      }
    }
    if (cachedIds.size > 0) {
      console.log(
        `[${repo.name}] Skipping ${cachedIds.size} cached work unit(s).`,
      )
      uncachedUnits = hydratedUnits.filter((u) => !cachedIds.has(u.id))
    }
  }

  if (bundle.server_url && uncachedUnits.length > 0) {
    const repoUrl = repo.repo_url ?? repo.path
    const response = await classifyWorkUnits(
      bundle.server_url,
      repoUrl,
      uncachedUnits,
    )
    for (const item of response.classifications) {
      classificationMap.set(item.id, item.classification)
    }
  } else if (!bundle.server_url) {
    for (const unit of uncachedUnits) {
      classificationMap.set(unit.id, {
        type: 'feature',
        difficulty: 'medium',
        impact_score: 5,
        reasoning: 'default classification',
      })
    }
  }

  const scored: PerRepoScoredUnit[] = []
  for (const unit of hydratedUnits) {
    const classification = classificationMap.get(unit.id)
    if (!classification) continue
    const unitScore = calculateUnitScore({
      net_loc: unit.net,
      difficulty: classification.difficulty,
      type: classification.type,
      impact_score: classification.impact_score,
    })

    if (convexClient && repoId && !cachedIds.has(unit.id)) {
      const authorId = authorIdMap.get(unit.author)
      if (authorId) {
        try {
          const locFactor = calculateLocFactor(unit.net)
          const formulaScore =
            locFactor * DIFFICULTY_WEIGHTS[classification.difficulty]
          const aiScore = classification.impact_score / 10
          const payload = buildWorkUnitPayload({
            workUnit: unit,
            repoId,
            authorId,
            classification,
            locFactor,
            formulaScore,
            aiScore,
            typeWeight: TYPE_WEIGHTS[classification.type],
            difficultyWeight: DIFFICULTY_WEIGHTS[classification.difficulty],
            unitScore,
          })
          await insertWorkUnit(convexClient, payload)
        } catch (err) {
          console.warn(`Warning: Failed to upload work unit ${unit.id}.`, err)
        }
      }
    }

    scored.push({
      author: unit.author,
      repoName: repo.name,
      date: unit.date,
      score: unitScore,
      commits: unit.commit_shas.length,
      isPr: unit.kind === 'pr',
      insertions: unit.insertions,
      deletions: unit.deletions,
    })
  }

  return scored
}
