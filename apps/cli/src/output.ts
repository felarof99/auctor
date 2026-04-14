import Table from 'cli-table3'
import type { AuthorStats } from './types'

const SPARK_CHARS = '▁▂▃▄▅▆▇█'

function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  if (max === 0) return SPARK_CHARS[0].repeat(values.length)
  return values
    .map((v) => {
      const idx = Math.round((v / max) * (SPARK_CHARS.length - 1))
      return SPARK_CHARS[idx]
    })
    .join('')
}

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

export function renderSparklines(stats: AuthorStats[]): string {
  if (stats.length === 0 || stats[0].daily_scores.length === 0) return ''

  const dates = stats[0].daily_scores.map((d) => d.date)
  const header = `\nDaily Score Trend (${dates[0]} → ${dates[dates.length - 1]})\n`

  const maxNameLen = Math.max(...stats.map((s) => s.author.length))

  const lines = stats.map((s) => {
    const scores = s.daily_scores.map((d) => d.score)
    const spark = sparkline(scores)
    const name = s.author.padEnd(maxNameLen)
    return `  ${name}  ${spark}  avg: ${s.score.toFixed(2)}`
  })

  return header + lines.join('\n')
}
