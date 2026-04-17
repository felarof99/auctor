export interface DailyScore {
  date: string
  score: number
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
}

export interface RepoReport {
  bundle: string
  repo: string
  window: string
  window_days: number
  generated_at: string
  authors: RepoAuthorStats[]
}
