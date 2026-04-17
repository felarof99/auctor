import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { aggregateBundle } from '@auctor/shared/aggregate'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import type { RepoReport } from '@auctor/shared/report'
import {
  aggregateBundleResults,
  type PerRepoScoredUnit,
} from '../analyze-aggregate'
import { createAuthorResolver } from '../author-identity'
import { loadBundle } from '../bundle'
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
import { calculateUnitScore } from '../scoring'
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

  const resultsDir = join(dirname(absoluteConfigPath), '.results')
  mkdirSync(resultsDir, { recursive: true })

  const perRepoReports: RepoReport[] = []
  for (const repo of validRepos) {
    const units = await analyzeSingleRepo(repo, bundle, since, options)
    const authors = aggregateBundleResults(units, since, daysInWindow)
    const report: RepoReport = {
      bundle: bundle.name,
      repo: repo.name,
      window: timeWindow,
      window_days: daysInWindow,
      generated_at: new Date().toISOString(),
      authors,
    }
    perRepoReports.push(report)

    const repoResultPath = join(resultsDir, `${repo.name}.json`)
    await Bun.write(repoResultPath, JSON.stringify(report, null, 2))
    console.log(`[${repo.name}] wrote ${repoResultPath}`)
  }

  const aggregate = aggregateBundle(perRepoReports)

  const plural = validRepos.length === 1 ? '' : 's'
  console.log(`\n${bundle.name} (${validRepos.length} repo${plural})`)
  console.log(renderLeaderboard(aggregate.authors))
  console.log(renderSparklines(aggregate.authors))

  if (jsonPath) {
    const reportPath = resolve(jsonPath)
    mkdirSync(dirname(reportPath), { recursive: true })
    const flatReport = {
      bundle: aggregate.bundle,
      repo: aggregate.bundle,
      window: aggregate.window,
      window_days: aggregate.window_days,
      generated_at: aggregate.generated_at,
      authors: aggregate.authors.map((a) => ({
        author: a.author,
        commits: a.commits,
        prs: a.prs,
        insertions: a.insertions,
        deletions: a.deletions,
        net: a.net,
        score: Number(a.score.toFixed(4)),
        daily_scores: a.daily_scores,
      })),
    }
    await Bun.write(reportPath, JSON.stringify(flatReport, null, 2))
    console.log(`Report written to ${reportPath}`)
  }
}

async function analyzeSingleRepo(
  repo: BundleRepo,
  bundle: BundleConfig,
  since: Date,
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

  const [logOutput, mergeShas] = await Promise.all([
    getGitLog(repo.path, since),
    getMergeCommits(repo.path, since),
  ])
  let commits = parseGitLog(logOutput)
  for (const commit of commits) {
    commit.isMerge = mergeShas.has(commit.sha)
  }
  const resolveAuthor = createAuthorResolver(bundle)
  commits = commits.flatMap((commit) => {
    const author = resolveAuthor(commit)
    return author ? [{ ...commit, author }] : []
  })
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
  for (const unit of hydratedUnits) {
    classificationMap.set(unit.id, {
      type: 'feature',
      difficulty: 'medium',
      impact_score: 5,
      reasoning: 'default classification',
    })
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
