export interface AuthorInfo {
  username: string
  name: string
}

function extractGithubUsername(email: string): string | null {
  const noreplyMatch = email.match(/^\d+\+(.+)@users\.noreply\.github\.com$/i)
  if (noreplyMatch) return noreplyMatch[1]
  const simpleNoreply = email.match(/^(.+)@users\.noreply\.github\.com$/i)
  if (simpleNoreply) return simpleNoreply[1]
  return null
}

function parseGithubRemoteUrl(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim().replace(/[?#].*$/, '')
  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+)$/)
  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/(.+)$/)
  const sshUrlMatch = normalized.match(
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/,
  )
  const match = sshMatch ?? httpsMatch ?? sshUrlMatch
  if (!match) return null

  const owner = match[1]
  const repo = match[2].replace(/\.git$/, '')
  if (!owner || !repo) return null
  return `${owner}/${repo}`
}

async function getGithubRepoSlug(repoPath: string): Promise<string | null> {
  const proc = Bun.spawn(['git', 'remote', 'get-url', 'origin'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) return null
  return parseGithubRemoteUrl(output)
}

async function readGithubCliToken(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['gh', 'auth', 'token'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) return null
    const token = output.trim()
    return token || null
  } catch {
    return null
  }
}

let githubCliToken: Promise<string | null> | null = null

async function getGithubToken(): Promise<string | null> {
  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (envToken) return envToken
  githubCliToken ??= readGithubCliToken()
  return githubCliToken
}

async function getGithubCommitAuthorLogin(
  repoSlug: string,
  sha: string,
): Promise<string | null> {
  const token = await getGithubToken()
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'auctor-cli',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(
    `https://api.github.com/repos/${repoSlug}/commits/${sha}`,
    { headers },
  ).catch(() => null)
  if (!response) return null
  if (!response.ok) return null
  const body = (await response.json()) as {
    author?: { login?: unknown } | null
  }
  return typeof body.author?.login === 'string' && body.author.login
    ? body.author.login
    : null
}

export async function getUniqueAuthors(
  repoPath: string,
  since: Date,
): Promise<AuthorInfo[]> {
  const githubRepoSlug = await getGithubRepoSlug(repoPath)
  const proc = Bun.spawn(
    [
      'git',
      'log',
      '--all',
      '--format=%H%x1f%an%x1f%ae',
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

  const seen = new Map<string, AuthorInfo>()
  const candidates = new Map<string, string[]>()

  for (const line of output.trim().split('\n').filter(Boolean)) {
    const [sha, name, email] = line.split('\x1f')
    const username = extractGithubUsername(email ?? '')
    if (username) {
      seen.set(username, { username, name: username })
      continue
    }
    if (!githubRepoSlug || !sha || !email) continue
    const key = `${name}\x1f${email}`
    const shas = candidates.get(key)
    if (shas) {
      shas.push(sha)
    } else {
      candidates.set(key, [sha])
    }
  }

  if (!githubRepoSlug) {
    return [...seen.values()].sort((a, b) =>
      a.username.localeCompare(b.username),
    )
  }

  for (const shas of candidates.values()) {
    for (const sha of shas) {
      const username = await getGithubCommitAuthorLogin(githubRepoSlug, sha)
      if (!username) continue
      seen.set(username, { username, name: username })
      break
    }
  }

  return [...seen.values()].sort((a, b) => a.username.localeCompare(b.username))
}
