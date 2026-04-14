import { existsSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { WorkUnit } from '@auctor/shared/classification'
import { classifyWorkUnits } from '../api-client'
import { getDiffForCommits } from '../git/diff'
import {
  getGitLog,
  getMergeCommits,
  parseGitLog,
  parseTimeWindow,
} from '../git/log'
import { extractBranchDayUnits, extractPrUnits } from '../git/work-units'
import { renderLeaderboard } from '../output'
import { calculateAuthorScore, calculateUnitScore } from '../scoring'
import type { AuthorStats, Config } from '../types'

export async function analyze(timeWindow: string, path: string): Promise<void> {
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

  // Classify work units
  const classificationMap = new Map<
    string,
    { type: string; difficulty: string; impact_score: number }
  >()

  if (config.server_url) {
    const repoUrl = config.repo_url ?? repoPath
    const response = await classifyWorkUnits(
      config.server_url,
      repoUrl,
      hydratedUnits,
    )
    for (const item of response.classifications) {
      classificationMap.set(item.id, item.classification)
    }
  } else {
    console.warn(
      'Warning: No server_url configured. Using default classification (feature/medium/5).',
    )
    for (const unit of hydratedUnits) {
      classificationMap.set(unit.id, {
        type: 'feature',
        difficulty: 'medium',
        impact_score: 5,
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
      scores: number[]
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
      difficulty: classification.difficulty as
        | 'trivial'
        | 'easy'
        | 'medium'
        | 'hard'
        | 'complex',
      type: classification.type as
        | 'feature'
        | 'bugfix'
        | 'refactor'
        | 'chore'
        | 'test'
        | 'docs',
      impact_score: classification.impact_score,
    })

    const existing = authorUnitsMap.get(unit.author) ?? {
      scores: [],
      commits: 0,
      prs: 0,
      insertions: 0,
      deletions: 0,
    }

    existing.scores.push(unitScore)
    existing.commits += unit.commit_shas.length
    if (unit.kind === 'pr') existing.prs++
    existing.insertions += unit.insertions
    existing.deletions += unit.deletions

    authorUnitsMap.set(unit.author, existing)
  }

  // Build leaderboard
  const leaderboard: AuthorStats[] = [...authorUnitsMap.entries()]
    .map(([author, data]) => ({
      author,
      commits: data.commits,
      prs: data.prs,
      insertions: data.insertions,
      deletions: data.deletions,
      net: data.insertions - data.deletions,
      score: calculateAuthorScore(data.scores, daysInWindow),
    }))
    .sort((a, b) => b.score - a.score)

  console.log(renderLeaderboard(leaderboard))

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
    })),
  }

  await Bun.write(resultPath, JSON.stringify(result, null, 2))
  console.log(`\nResults written to ${resultPath}`)
}
