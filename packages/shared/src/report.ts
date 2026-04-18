export interface DailyScore {
  date: string
  score: number
}

export interface ConsideredCommit {
  repo: string
  branch?: string
  sha: string
  message: string
}

export interface ConsideredPullRequest {
  repo: string
  branch?: string
  sha: string
  pr_number?: number
  message: string
}

export interface AuthorConsideredItems {
  commits: ConsideredCommit[]
  prs: ConsideredPullRequest[]
}

export interface RepoAuthorStats {
  author: string
  commits: number
  prs: number
  insertions: number
  deletions: number
  net: number
  score: number
  daily_scores: DailyScore[]
  considered: AuthorConsideredItems
}

export interface RepoReport {
  bundle: string
  repo: string
  window: string
  window_days: number
  generated_at: string
  authors: RepoAuthorStats[]
}
