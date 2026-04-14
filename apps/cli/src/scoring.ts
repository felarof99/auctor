import type { AuthorStats } from './types'

export function calculateScore(stats: Omit<AuthorStats, 'score'>): number {
  const commitWeight = 0.3
  const prWeight = 0.2
  const locWeight = 0.5

  const commitScore = Math.min(stats.commits / 20, 1)
  const prScore = Math.min(stats.prs / 5, 1)
  const locScore = Math.min(Math.max(stats.net, 0) / 2000, 1)

  const raw =
    commitScore * commitWeight + prScore * prWeight + locScore * locWeight

  return Math.round(raw * 100) / 100
}
