import type {
  AuthorConsideredItems,
  DailyScore,
  RepoAuthorStats,
  RepoReport,
} from './report'

export interface BundleAuthorStats extends RepoAuthorStats {
  repos: string[]
}

export interface BundleAggregate {
  bundle: string
  window: string
  window_days: number
  generated_at: string
  authors: BundleAuthorStats[]
}

export function aggregateBundle(reports: RepoReport[]): BundleAggregate {
  if (reports.length === 0) {
    throw new Error('aggregateBundle: received empty reports array')
  }

  const bundle = reports[0].bundle
  const window = reports[0].window
  const windowDays = reports[0].window_days

  for (const r of reports) {
    if (r.bundle !== bundle) {
      throw new Error(
        `aggregateBundle: bundle mismatch (${bundle} vs ${r.bundle})`,
      )
    }
    if (r.window_days !== windowDays) {
      throw new Error(
        `aggregateBundle: window_days mismatch (${windowDays} vs ${r.window_days})`,
      )
    }
  }

  const generatedAt = reports
    .map((r) => r.generated_at)
    .sort()
    .at(-1) as string

  const byAuthor = new Map<string, BundleAuthorStats>()
  for (const report of reports) {
    for (const a of report.authors) {
      const existing = byAuthor.get(a.author)
      if (!existing) {
        byAuthor.set(a.author, {
          author: a.author,
          commits: a.commits,
          prs: a.prs,
          insertions: a.insertions,
          deletions: a.deletions,
          net: a.net,
          score: a.score,
          daily_scores: a.daily_scores.map((d) => ({ ...d })),
          considered: cloneConsidered(a.considered),
          repos: [report.repo],
        })
        continue
      }
      existing.commits += a.commits
      existing.prs += a.prs
      existing.insertions += a.insertions
      existing.deletions += a.deletions
      existing.net += a.net
      existing.score += a.score
      existing.daily_scores = mergeDailyScores(
        existing.daily_scores,
        a.daily_scores,
      )
      existing.considered.commits.push(...a.considered.commits)
      existing.considered.prs.push(...a.considered.prs)
      if (!existing.repos.includes(report.repo)) {
        existing.repos.push(report.repo)
      }
    }
  }

  const authors = [...byAuthor.values()].sort((a, b) => b.score - a.score)
  return {
    bundle,
    window,
    window_days: windowDays,
    generated_at: generatedAt,
    authors,
  }
}

function cloneConsidered(
  considered: AuthorConsideredItems,
): AuthorConsideredItems {
  return {
    commits: considered.commits.map((c) => ({ ...c })),
    prs: considered.prs.map((p) => ({ ...p })),
  }
}

function mergeDailyScores(a: DailyScore[], b: DailyScore[]): DailyScore[] {
  if (a.length !== b.length) {
    throw new Error(
      `mergeDailyScores: length mismatch (${a.length} vs ${b.length})`,
    )
  }
  return a.map((entry, i) => {
    if (entry.date !== b[i].date) {
      throw new Error(
        `mergeDailyScores: date mismatch at index ${i} (${entry.date} vs ${b[i].date})`,
      )
    }
    return {
      date: entry.date,
      score: Math.round((entry.score + b[i].score) * 100) / 100,
    }
  })
}
