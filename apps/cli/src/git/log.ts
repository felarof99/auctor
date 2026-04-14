import type { Commit } from '../types'

export function parseGitLog(output: string): Commit[] {
  const blocks = output.split('COMMIT_START').filter((b) => b.trim())
  return blocks.map((block) => {
    const lines = block
      .trim()
      .split('\n')
      .filter((l) => l !== '')
    const sha = lines[0]
    const author = lines[1]
    const date = new Date(lines[2])
    const subject = lines[3]

    let insertions = 0
    let deletions = 0

    for (let i = 4; i < lines.length; i++) {
      const line = lines[i]
      const insertMatch = line.match(/(\d+) insertion/)
      const deleteMatch = line.match(/(\d+) deletion/)
      if (insertMatch) insertions = parseInt(insertMatch[1], 10)
      if (deleteMatch) deletions = parseInt(deleteMatch[1], 10)
    }

    return { sha, author, date, subject, insertions, deletions, isMerge: false }
  })
}

export function parseTimeWindow(window: string): Date {
  const match = window.match(/^-?(\d+)d$/)
  if (!match) {
    throw new Error(
      `Invalid time window: ${window}. Expected format: -7d, -30d, 0d`,
    )
  }
  const days = parseInt(match[1], 10)
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(0, 0, 0, 0)
  return date
}

export async function getGitLog(
  repoPath: string,
  since: Date,
): Promise<string> {
  const proc = Bun.spawn(
    [
      'git',
      'log',
      '--all',
      '--shortstat',
      '--format=COMMIT_START%n%H%n%an%n%aI%n%s',
      `--since=${since.toISOString()}`,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git log failed: ${stderr}`)
  }
  return output
}

export async function getMergeCommits(
  repoPath: string,
  since: Date,
): Promise<Set<string>> {
  const proc = Bun.spawn(
    [
      'git',
      'log',
      '--all',
      '--merges',
      '--format=%H',
      `--since=${since.toISOString()}`,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  await proc.exited
  return new Set(output.trim().split('\n').filter(Boolean))
}
