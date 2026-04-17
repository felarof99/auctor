import { calculateAuthorScore, computeDailyScores } from './scoring'
import type { AuthorStats } from './types'

export interface PerRepoScoredUnit {
  author: string
  repoName: string
  date: string
  score: number
  commits: number
  isPr: boolean
  insertions: number
  deletions: number
}

interface AuthorBucket {
  scoredUnits: { date: string; score: number }[]
  commits: number
  prs: number
  insertions: number
  deletions: number
}

export function aggregateBundleResults(
  units: PerRepoScoredUnit[],
  since: Date,
  daysInWindow: number,
): AuthorStats[] {
  const buckets = new Map<string, AuthorBucket>()

  for (const u of units) {
    const b = buckets.get(u.author) ?? {
      scoredUnits: [],
      commits: 0,
      prs: 0,
      insertions: 0,
      deletions: 0,
    }
    b.scoredUnits.push({ date: u.date, score: u.score })
    b.commits += u.commits
    if (u.isPr) b.prs += 1
    b.insertions += u.insertions
    b.deletions += u.deletions
    buckets.set(u.author, b)
  }

  return [...buckets.entries()]
    .map(([author, b]) => ({
      author,
      commits: b.commits,
      prs: b.prs,
      insertions: b.insertions,
      deletions: b.deletions,
      net: b.insertions - b.deletions,
      score: calculateAuthorScore(
        b.scoredUnits.map((s) => s.score),
        daysInWindow,
      ),
      daily_scores: computeDailyScores(b.scoredUnits, since, daysInWindow),
    }))
    .sort((a, b) => b.score - a.score)
}
