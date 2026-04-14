import Table from 'cli-table3'
import type { AuthorStats } from './types'

export function renderLeaderboard(stats: AuthorStats[]): string {
  const table = new Table({
    head: ['Rank', 'Author', 'Commits', 'PRs', '+LOC', '-LOC', 'Net', 'Score'],
    colAligns: [
      'right',
      'left',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
    ],
  })

  for (let i = 0; i < stats.length; i++) {
    const s = stats[i]
    table.push([
      i + 1,
      s.author,
      s.commits,
      s.prs,
      s.insertions.toLocaleString(),
      s.deletions.toLocaleString(),
      s.net.toLocaleString(),
      s.score.toFixed(2),
    ])
  }

  return table.toString()
}
