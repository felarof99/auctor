export interface Config {
  authors: string[]
  server_url?: string
  repo_url?: string
}

export interface Commit {
  sha: string
  author: string
  date: Date
  subject: string
  insertions: number
  deletions: number
  isMerge: boolean
}

export interface DailyScore {
  date: string
  score: number
}

export interface AuthorStats {
  author: string
  commits: number
  prs: number
  insertions: number
  deletions: number
  net: number
  score: number
  daily_scores: DailyScore[]
}
