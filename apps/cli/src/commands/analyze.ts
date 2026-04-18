import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { aggregateBundle } from '@auctor/shared/aggregate'
import type { ClassifiedWorkUnit } from '@auctor/shared/api-types'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import type { AuthorConsideredItems, RepoReport } from '@auctor/shared/report'
import {
  aggregateBundleResults,
  type PerRepoCommitDetail,
  type PerRepoScoredUnit,
} from '../analyze-aggregate'
import { classifyWorkUnits } from '../api-client'
import { loadBundle } from '../bundle'
import { resolveCommitsToGithubAuthors } from '../git/authors'
import { getDiffForCommits } from '../git/diff'
import { fetchAllBranches } from '../git/fetch'
import {
  getActiveBranches,
  getGitLogForBranch,
  getMergeCommitsForBranch,
  parseGitLog,
  parseTimeWindow,
} from '../git/log'
import { extractBranchDayUnits, extractPrUnits } from '../git/work-units'
import { renderLeaderboard, renderSparklines } from '../output'
import { calculateUnitScore } from '../scoring'
import type { BundleConfig, BundleRepo, Commit } from '../types'

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

  const activeBranches = await getActiveBranches(repo.path, since)
  let commits: Commit[] = []
  for (const branch of activeBranches) {
    const [logOutput, mergeShas] = await Promise.all([
      getGitLogForBranch(repo.path, branch, since),
      getMergeCommitsForBranch(repo.path, branch, since),
    ])
    const branchCommits = parseGitLog(logOutput, branch.name)
    for (const commit of branchCommits) {
      commit.isMerge = mergeShas.has(commit.sha)
    }
    commits.push(...branchCommits)
  }
  commits = await resolveCommitsToGithubAuthors(repo.path, commits)
  const engineerSet = new Set(bundle.engineers)
  commits = commits.filter((commit) => engineerSet.has(commit.author))
  if (commits.length === 0) return []

  const commitByBranchAndSha = new Map(
    commits.map((commit) => [
      `${commit.branch ?? 'unknown'}::${commit.sha}`,
      commit,
    ]),
  )
  const branchDayUnits = extractBranchDayUnits(commits)
  const prUnits = extractPrUnits(commits)
  const shellUnits = [...branchDayUnits, ...prUnits]

  const hydratedUnits: WorkUnit[] = await Promise.all(
    shellUnits.map(async (unit) => {
      const diff = await getDiffForCommits(repo.path, unit.commit_shas)
      return { ...unit, diff }
    }),
  )

  let classifications: Classification[]
  if (bundle.server_url) {
    const classifierRequestUnits = buildClassifierRequestUnits(hydratedUnits)
    const response = await classifyWorkUnits(
      bundle.server_url,
      repo.path,
      classifierRequestUnits,
    )
    classifications = buildClassificationsForUnits(
      classifierRequestUnits,
      response.classifications,
    )
  } else {
    const classificationMap = new Map<string, Classification>()
    for (const unit of hydratedUnits) {
      classificationMap.set(unit.id, {
        type: 'feature',
        difficulty: 'medium',
        impact_score: 5,
        reasoning: 'default classification',
      })
    }
    classifications = hydratedUnits.map((unit) => {
      const classification = classificationMap.get(unit.id)
      if (!classification) {
        throw new Error(`Missing classification for work unit ${unit.id}`)
      }
      return classification
    })
  }

  const scored: PerRepoScoredUnit[] = []
  for (const [index, unit] of hydratedUnits.entries()) {
    const classification = classifications[index]
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
      commitDetails: buildCommitDetailsForUnit(
        repo.name,
        unit,
        commitByBranchAndSha,
      ),
      considered: buildConsideredItemsForUnit(repo.name, unit),
    })
  }

  return scored
}

export function buildClassificationMap(
  classifications: ClassifiedWorkUnit[],
): Map<string, Classification> {
  const map = new Map<string, Classification>()
  for (const item of classifications) {
    if (map.has(item.id)) {
      throw new Error(`Duplicate classification for work unit ${item.id}`)
    }
    map.set(item.id, item.classification)
  }
  return map
}

export function buildClassifierRequestUnits(units: WorkUnit[]): WorkUnit[] {
  const idCounts = new Map<string, number>()
  for (const unit of units) {
    idCounts.set(unit.id, (idCounts.get(unit.id) ?? 0) + 1)
  }

  const usedIds = new Set(
    units.filter((unit) => idCounts.get(unit.id) === 1).map((unit) => unit.id),
  )

  return units.map((unit, index) => {
    if (idCounts.get(unit.id) === 1) {
      return unit
    }

    const baseId = `${unit.id}::classifier-${index}`
    let requestId = baseId
    let collisionIndex = 1
    while (usedIds.has(requestId)) {
      requestId = `${baseId}-${collisionIndex}`
      collisionIndex += 1
    }
    usedIds.add(requestId)

    return { ...unit, id: requestId }
  })
}

export function buildClassificationsForUnits(
  units: WorkUnit[],
  returned: ClassifiedWorkUnit[],
): Classification[] {
  if (returned.length !== units.length) {
    throw new Error(
      `Expected ${units.length} classifications but received ${returned.length}`,
    )
  }

  return units.map((unit, index) => {
    const item = returned[index]
    if (!item || item.id !== unit.id) {
      throw new Error(
        `Classification response mismatch at index ${index}: expected work unit ${unit.id} but received ${item?.id ?? 'missing'}`,
      )
    }
    return item.classification
  })
}

function buildCommitDetailsForUnit(
  repoName: string,
  unit: WorkUnit,
  commitByBranchAndSha: Map<string, Commit>,
): PerRepoCommitDetail[] {
  if (unit.kind === 'pr') return []
  return unit.commit_shas.map((sha, i) => {
    const commit = commitByBranchAndSha.get(`${unit.branch}::${sha}`)
    return {
      repo: repoName,
      branch: unit.branch,
      sha,
      message: unit.commit_messages[i] ?? '',
      insertions: commit?.insertions ?? 0,
      deletions: commit?.deletions ?? 0,
    }
  })
}

export function buildConsideredItemsForUnit(
  repoName: string,
  unit: WorkUnit,
): AuthorConsideredItems {
  if (unit.kind === 'pr') {
    const message = unit.commit_messages[0] ?? ''
    const prNumber = extractPrNumber(message)
    return {
      commits: [],
      prs: [
        {
          repo: repoName,
          branch: unit.branch,
          sha: unit.commit_shas[0] ?? '',
          ...(prNumber !== undefined ? { pr_number: prNumber } : {}),
          message,
        },
      ],
    }
  }

  return {
    commits: unit.commit_shas.map((sha, i) => ({
      repo: repoName,
      branch: unit.branch,
      sha,
      message: unit.commit_messages[i] ?? '',
    })),
    prs: [],
  }
}

function extractPrNumber(message: string): number | undefined {
  const match =
    message.match(/\(#(\d+)\)\s*$/) ?? message.match(/pull request #(\d+)/i)
  return match ? Number.parseInt(match[1], 10) : undefined
}
