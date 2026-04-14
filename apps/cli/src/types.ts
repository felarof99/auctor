export interface Config {
  authors: string[]
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

export interface AuthorStats {
  author: string
  commits: number
  prs: number
  insertions: number
  deletions: number
  net: number
  score: number
}
