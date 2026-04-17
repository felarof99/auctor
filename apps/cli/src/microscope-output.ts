export interface MicroscopeCommit {
  repo: string
  sha: string
  subject: string
  insertions: number
  deletions: number
  date: Date
}

export interface MicroscopeDay {
  date: string
  commits: MicroscopeCommit[]
  totals: { commits: number; insertions: number; deletions: number }
}

export interface MicroscopeRenderOpts {
  username: string
  bundleName: string
  window: string
  days: MicroscopeDay[]
}

export function groupByDay(commits: MicroscopeCommit[]): MicroscopeDay[] {
  const buckets = new Map<string, MicroscopeCommit[]>()
  for (const c of commits) {
    const key = c.date.toISOString().slice(0, 10)
    const list = buckets.get(key) ?? []
    list.push(c)
    buckets.set(key, list)
  }
  const days: MicroscopeDay[] = []
  for (const [date, list] of buckets) {
    list.sort((a, b) => b.date.getTime() - a.date.getTime())
    const totals = list.reduce(
      (acc, c) => ({
        commits: acc.commits + 1,
        insertions: acc.insertions + c.insertions,
        deletions: acc.deletions + c.deletions,
      }),
      { commits: 0, insertions: 0, deletions: 0 },
    )
    days.push({ date, commits: list, totals })
  }
  days.sort((a, b) => (a.date < b.date ? 1 : -1))
  return days
}

export function renderMicroscope(opts: MicroscopeRenderOpts): string {
  const lines: string[] = []
  lines.push(
    `microscope: ${opts.username} — ${opts.bundleName} (${opts.window})`,
  )
  lines.push('')
  if (opts.days.length === 0) {
    lines.push('(no commits in window)')
    return lines.join('\n')
  }
  for (const day of opts.days) {
    const weekday = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(
      'en-US',
      { weekday: 'short', timeZone: 'UTC' },
    )
    const t = day.totals
    const plural = t.commits === 1 ? '' : 's'
    lines.push(
      `=== ${day.date} (${weekday}) — ${t.commits} commit${plural}, +${t.insertions}/-${t.deletions} ===`,
    )
    for (const c of day.commits) {
      lines.push(
        `  [${c.repo}] ${c.sha.slice(0, 7)} ${c.subject} (+${c.insertions}/-${c.deletions})`,
      )
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

export interface MicroscopeReport {
  bundle: string
  username: string
  window: string
  generated_at: string
  days: Array<{
    date: string
    commits: Array<{
      repo: string
      sha: string
      subject: string
      insertions: number
      deletions: number
      date: string
    }>
    totals: { commits: number; insertions: number; deletions: number }
  }>
}

export function buildMicroscopeReport(
  opts: MicroscopeRenderOpts,
): MicroscopeReport {
  return {
    bundle: opts.bundleName,
    username: opts.username,
    window: opts.window,
    generated_at: new Date().toISOString(),
    days: opts.days.map((d) => ({
      date: d.date,
      commits: d.commits.map((c) => ({
        repo: c.repo,
        sha: c.sha,
        subject: c.subject,
        insertions: c.insertions,
        deletions: c.deletions,
        date: c.date.toISOString(),
      })),
      totals: d.totals,
    })),
  }
}
