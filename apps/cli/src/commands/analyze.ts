import { existsSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { ConvexClient } from '@auctor/database/client'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import {
  DIFFICULTY_WEIGHTS,
  TYPE_WEIGHTS,
} from '@auctor/shared/scoring-weights'
import { classifyWorkUnits } from '../api-client'
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
import {
  getGitLog,
  getMergeCommits,
  parseGitLog,
  parseTimeWindow,
} from '../git/log'
import { extractBranchDayUnits, extractPrUnits } from '../git/work-units'
import { renderLeaderboard, renderSparklines } from '../output'
import {
  calculateAuthorScore,
  calculateLocFactor,
  calculateUnitScore,
  computeDailyScores,
} from '../scoring'
import type { AuthorStats, Config } from '../types'

export async function analyze(
  timeWindow: string,
  path: string,
  jsonPath?: string,
): Promise<void> {
  const repoPath = resolve(path)
  const gitDir = join(repoPath, '.git')

  if (!existsSync(gitDir)) {
    console.error(`Not a git repository: ${repoPath}`)
    process.exit(1)
  }

  const configPath = join(repoPath, '.auctor.json')
  if (!existsSync(configPath)) {
    console.error('No config found. Run `auctor configure` first.')
    process.exit(1)
  }

  const config: Config = JSON.parse(await Bun.file(configPath).text())

  let convexClient: ConvexClient | null = null
  let repoId: string | null = null
  let authorIdMap = new Map<string, string>()

  if (config.convex_url) {
    try {
      convexClient = createConvexClient(config.convex_url)
      repoId = await ensureRepo(convexClient, basename(repoPath))
      authorIdMap = await ensureAuthors(
        convexClient,
        repoId,
        config.authors.map((username) => ({ username, whitelisted: true })),
      )
    } catch (err) {
      console.warn(
        'Warning: Convex initialization failed, continuing without cache.',
        err,
      )
      convexClient = null
      repoId = null
      authorIdMap = new Map()
    }
  }

  const since = parseTimeWindow(timeWindow)

  const [logOutput, mergeShas] = await Promise.all([
    getGitLog(repoPath, since),
    getMergeCommits(repoPath, since),
  ])

  let commits = parseGitLog(logOutput)

  for (const commit of commits) {
    commit.isMerge = mergeShas.has(commit.sha)
  }

  const authorSet = new Set(config.authors)
  commits = commits.filter((c) => authorSet.has(c.author))

  if (commits.length === 0) {
    console.log('No commits found for whitelisted authors in this time window.')
    return
  }

  // Extract work units
  const branchDayUnits = extractBranchDayUnits(commits, 'main')
  const prUnits = extractPrUnits(commits)
  const shellUnits = [...branchDayUnits, ...prUnits]

  // Hydrate diffs
  const hydratedUnits: WorkUnit[] = await Promise.all(
    shellUnits.map(async (unit) => {
      const diff = await getDiffForCommits(repoPath, unit.commit_shas)
      return { ...unit, diff }
    }),
  )

  // Cache check — skip units already stored in Convex
  let uncachedUnits = hydratedUnits
  if (convexClient && repoId) {
    const cachedIds = new Set<string>()
    for (const unit of hydratedUnits) {
      const authorId = authorIdMap.get(unit.author)
      if (!authorId) continue
      try {
        const unitType = unit.kind === 'branch-day' ? 'branch_day' : unit.kind
        const exists = await findExistingWorkUnit(
          convexClient,
          repoId,
          authorId,
          unit.date,
          unitType as 'pr' | 'branch_day',
          unit.branch,
        )
        if (exists) cachedIds.add(unit.id)
      } catch {
        // skip cache check on error
      }
    }
    if (cachedIds.size > 0) {
      console.log(`Skipping ${cachedIds.size} cached work unit(s).`)
      uncachedUnits = hydratedUnits.filter((u) => !cachedIds.has(u.id))
    }
  }

  // Classify work units
  const classificationMap = new Map<string, Classification>()

  if (config.server_url && uncachedUnits.length > 0) {
    const repoUrl = config.repo_url ?? repoPath
    const response = await classifyWorkUnits(
      config.server_url,
      repoUrl,
      uncachedUnits,
    )
    for (const item of response.classifications) {
      classificationMap.set(item.id, item.classification)
    }
  } else if (!config.server_url) {
    console.warn(
      'Warning: No server_url configured. Using default classification (feature/medium/5).',
    )
    for (const unit of uncachedUnits) {
      classificationMap.set(unit.id, {
        type: 'feature',
        difficulty: 'medium',
        impact_score: 5,
        reasoning: 'default classification',
      })
    }
  }

  // Parse days from time window
  const daysMatch = timeWindow.match(/^-?(\d+)d$/)
  const daysInWindow = daysMatch ? parseInt(daysMatch[1], 10) : 7

  // Score each unit and aggregate per author
  const authorUnitsMap = new Map<
    string,
    {
      scoredUnits: { date: string; score: number }[]
      commits: number
      prs: number
      insertions: number
      deletions: number
    }
  >()

  for (const unit of hydratedUnits) {
    const classification = classificationMap.get(unit.id)
    if (!classification) continue

    const unitScore = calculateUnitScore({
      net_loc: unit.net,
      difficulty: classification.difficulty,
      type: classification.type,
      impact_score: classification.impact_score,
    })

    // Upload newly classified work units to Convex
    if (convexClient && repoId) {
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

    const existing = authorUnitsMap.get(unit.author) ?? {
      scoredUnits: [],
      commits: 0,
      prs: 0,
      insertions: 0,
      deletions: 0,
    }

    existing.scoredUnits.push({ date: unit.date, score: unitScore })
    existing.commits += unit.commit_shas.length
    if (unit.kind === 'pr') existing.prs++
    existing.insertions += unit.insertions
    existing.deletions += unit.deletions

    authorUnitsMap.set(unit.author, existing)
  }

  // Build leaderboard with daily scores
  const leaderboard: AuthorStats[] = [...authorUnitsMap.entries()]
    .map(([author, data]) => {
      const allScores = data.scoredUnits.map((u) => u.score)
      const daily_scores = computeDailyScores(
        data.scoredUnits,
        since,
        daysInWindow,
      )
      return {
        author,
        commits: data.commits,
        prs: data.prs,
        insertions: data.insertions,
        deletions: data.deletions,
        net: data.insertions - data.deletions,
        score: calculateAuthorScore(allScores, daysInWindow),
        daily_scores,
      }
    })
    .sort((a, b) => b.score - a.score)

  // Upload analysis run to Convex
  if (convexClient && repoId) {
    try {
      await insertAnalysisRun(convexClient, {
        repoId,
        timeWindow,
        analyzedAt: new Date().toISOString(),
        daysInWindow,
        authorScores: leaderboard.map((s) => ({
          authorId: authorIdMap.get(s.author) ?? '',
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

  console.log(renderLeaderboard(leaderboard))
  console.log(renderSparklines(leaderboard))

  // Write JSON result
  const resultsDir = join(repoPath, '.auctor', 'results')
  mkdirSync(resultsDir, { recursive: true })

  const repoName = basename(repoPath)
  const resultPath = join(resultsDir, `${repoName}.json`)

  const result = {
    repo: repoName,
    window: timeWindow,
    analyzed_at: new Date().toISOString(),
    authors: leaderboard.map((s) => ({
      name: s.author,
      score: s.score,
      commits: s.commits,
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
    const reportDir = join(reportPath, '..')
    mkdirSync(reportDir, { recursive: true })

    const report = {
      repo: config.repo_url ?? repoName,
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
