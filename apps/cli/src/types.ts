export interface Commit {
  sha: string
  author: string
  authorEmail?: string
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

export interface BundleRepo {
  name: string
  path: string
  repo_url?: string
}

export interface BundleConfig {
  name: string
  server_url?: string
  convex_url?: string
  repos: BundleRepo[]
  engineers: string[]
  aliases?: Record<string, string[]>
}
