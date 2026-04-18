import type { AuthorConsideredItems } from '@auctor/shared/report'
import { calculateAuthorScore, computeDailyScores } from './scoring'
import type { AuthorStats } from './types'

export interface PerRepoCommitDetail {
  repo: string
  sha: string
  branch?: string
  message: string
  insertions: number
  deletions: number
}

export interface PerRepoScoredUnit {
  author: string
  repoName: string
  date: string
  score: number
  commits: number
  isPr: boolean
  insertions: number
  deletions: number
  commitDetails?: PerRepoCommitDetail[]
  considered: AuthorConsideredItems
}

interface AuthorBucket {
  scoredUnits: { date: string; score: number }[]
  commits: number
  prs: number
  insertions: number
  deletions: number
  considered: AuthorConsideredItems
  seenCommitKeys: Set<string>
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
      considered: { commits: [], prs: [] },
      seenCommitKeys: new Set<string>(),
    }

    if (!u.isPr && u.commitDetails && u.commitDetails.length > 0) {
      const uniqueDetails = u.commitDetails.filter((detail) => {
        const key = commitKey(detail)
        if (b.seenCommitKeys.has(key)) return false
        b.seenCommitKeys.add(key)
        return true
      })
      b.scoredUnits.push({
        date: u.date,
        score: scaledScore(u.score, u.commitDetails, uniqueDetails),
      })
      b.commits += uniqueDetails.length
      b.insertions += uniqueDetails.reduce((sum, d) => sum + d.insertions, 0)
      b.deletions += uniqueDetails.reduce((sum, d) => sum + d.deletions, 0)
      b.considered.commits.push(
        ...uniqueDetails.map(({ repo, branch, sha, message }) => ({
          repo,
          ...(branch ? { branch } : {}),
          sha,
          message,
        })),
      )
      buckets.set(u.author, b)
      continue
    }

    if (u.isPr) {
      b.scoredUnits.push({ date: u.date, score: u.score })
      b.prs += 1
      b.considered.prs.push(...u.considered.prs)
      buckets.set(u.author, b)
      continue
    }

    b.scoredUnits.push({ date: u.date, score: u.score })
    b.commits += u.commits
    b.insertions += u.insertions
    b.deletions += u.deletions
    b.considered.commits.push(...u.considered.commits)
    b.considered.prs.push(...u.considered.prs)
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
      considered: b.considered,
    }))
    .sort((a, b) => b.score - a.score)
}

function commitKey(detail: PerRepoCommitDetail): string {
  return `${detail.repo}::${detail.sha}`
}

function absNetLoc(detail: PerRepoCommitDetail): number {
  return Math.abs(detail.insertions - detail.deletions)
}

function scaledScore(
  score: number,
  details: PerRepoCommitDetail[],
  uniqueDetails: PerRepoCommitDetail[],
): number {
  if (details.length === 0) return score
  const totalWeight = details.reduce((sum, d) => sum + absNetLoc(d), 0)
  if (totalWeight > 0) {
    const uniqueWeight = uniqueDetails.reduce((sum, d) => sum + absNetLoc(d), 0)
    return score * (uniqueWeight / totalWeight)
  }
  return score * (uniqueDetails.length / details.length)
}
