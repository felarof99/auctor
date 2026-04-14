export interface RepoAuthorStats {
  author: string
  commits: number
  prs: number
  insertions: number
  deletions: number
  net: number
  score: number
}

export interface RepoReport {
  repo: string
  generated_at: string
  window_days: number
  authors: RepoAuthorStats[]
}
