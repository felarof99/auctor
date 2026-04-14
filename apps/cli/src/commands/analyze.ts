import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  getGitLog,
  getMergeCommits,
  parseGitLog,
  parseTimeWindow,
} from '../git/log'
import { renderLeaderboard } from '../output'
import { calculateScore } from '../scoring'
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

  const statsMap = new Map<string, Omit<AuthorStats, 'score'>>()

  for (const commit of commits) {
    const existing = statsMap.get(commit.author) ?? {
      author: commit.author,
      commits: 0,
      prs: 0,
      insertions: 0,
      deletions: 0,
      net: 0,
    }

    existing.commits++
    if (commit.isMerge) existing.prs++
    existing.insertions += commit.insertions
    existing.deletions += commit.deletions
    existing.net = existing.insertions - existing.deletions

    statsMap.set(commit.author, existing)
  }

  const leaderboard: AuthorStats[] = [...statsMap.values()]
    .map((s) => ({ ...s, score: calculateScore(s) }))
    .sort((a, b) => b.score - a.score)

  console.log(renderLeaderboard(leaderboard))
}
