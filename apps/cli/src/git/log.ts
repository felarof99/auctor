import type { Commit } from '../types'

export interface BranchRef {
  ref: string
  name: string
}

export function parseGitLog(output: string, branch?: string): Commit[] {
  const blocks = output.split('COMMIT_START').filter((b) => b.trim())
  return blocks.map((block) => {
    const lines = block
      .trim()
      .split('\n')
      .filter((l) => l !== '')
    const sha = lines[0]
    const author = lines[1]
    const hasEmail = Number.isNaN(Date.parse(lines[2]))
    const authorEmail = hasEmail ? lines[2] : undefined
    const date = new Date(hasEmail ? lines[3] : lines[2])
    const subject = hasEmail ? lines[4] : lines[3]
    const statStart = hasEmail ? 5 : 4

    let insertions = 0
    let deletions = 0

    for (let i = statStart; i < lines.length; i++) {
      const line = lines[i]
      const insertMatch = line.match(/(\d+) insertion/)
      const deleteMatch = line.match(/(\d+) deletion/)
      if (insertMatch) insertions = parseInt(insertMatch[1], 10)
      if (deleteMatch) deletions = parseInt(deleteMatch[1], 10)
    }

    return {
      sha,
      author,
      ...(authorEmail ? { authorEmail } : {}),
      ...(branch ? { branch } : {}),
      date,
      subject,
      insertions,
      deletions,
      isMerge: false,
    }
  })
}

export function normalizeBranchName(ref: string): string {
  if (ref.startsWith('refs/heads/')) {
    return ref.slice('refs/heads/'.length)
  }

  if (ref.startsWith('refs/remotes/')) {
    const remoteAndBranch = ref.slice('refs/remotes/'.length)
    const slash = remoteAndBranch.indexOf('/')
    if (slash === -1) return remoteAndBranch
    const remote = remoteAndBranch.slice(0, slash)
    const branch = remoteAndBranch.slice(slash + 1)
    return remote === 'origin' ? branch : `${remote}/${branch}`
  }

  if (ref.startsWith('origin/')) {
    return ref.slice('origin/'.length)
  }

  return ref
}

function isRemoteHead(ref: string): boolean {
  return /^refs\/remotes\/[^/]+\/HEAD$/.test(ref)
}

function isRemoteRef(ref: string): boolean {
  return ref.startsWith('refs/remotes/')
}

export async function listBranchRefs(repoPath: string): Promise<BranchRef[]> {
  const proc = Bun.spawn(
    [
      'git',
      'for-each-ref',
      '--format=%(refname)',
      'refs/remotes',
      'refs/heads',
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git branch listing failed: ${stderr}`)
  }

  const refs = output.trim().split('\n').filter(Boolean)
  refs.sort((a, b) => {
    const remoteRank = Number(!isRemoteRef(a)) - Number(!isRemoteRef(b))
    return remoteRank || a.localeCompare(b)
  })

  const byName = new Map<string, BranchRef>()
  for (const ref of refs) {
    if (isRemoteHead(ref)) continue
    const name = normalizeBranchName(ref)
    if (!byName.has(name)) {
      byName.set(name, { ref, name })
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function branchHasCommitsSince(
  repoPath: string,
  branch: BranchRef,
  since: Date,
): Promise<boolean> {
  const proc = Bun.spawn(
    [
      'git',
      'rev-list',
      '--max-count=1',
      `--since=${since.toISOString()}`,
      branch.ref,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git branch activity check failed: ${stderr}`)
  }
  return output.trim().length > 0
}

export async function getActiveBranches(
  repoPath: string,
  since: Date,
): Promise<BranchRef[]> {
  const branches = await listBranchRefs(repoPath)
  const active: BranchRef[] = []
  for (const branch of branches) {
    if (await branchHasCommitsSince(repoPath, branch, since)) {
      active.push(branch)
    }
  }
  return active
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
      '--format=COMMIT_START%n%H%n%an%n%ae%n%aI%n%s',
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

export async function getGitLogForBranch(
  repoPath: string,
  branch: BranchRef,
  since: Date,
): Promise<string> {
  const proc = Bun.spawn(
    [
      'git',
      'log',
      branch.ref,
      '--shortstat',
      '--format=COMMIT_START%n%H%n%an%n%ae%n%aI%n%s',
      `--since=${since.toISOString()}`,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git log failed for ${branch.name}: ${stderr}`)
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

export async function getMergeCommitsForBranch(
  repoPath: string,
  branch: BranchRef,
  since: Date,
): Promise<Set<string>> {
  const proc = Bun.spawn(
    [
      'git',
      'log',
      branch.ref,
      '--first-parent',
      '--merges',
      '--format=%H',
      `--since=${since.toISOString()}`,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git merge log failed for ${branch.name}: ${stderr}`)
  }
  return new Set(output.trim().split('\n').filter(Boolean))
}
