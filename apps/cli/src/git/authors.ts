export interface AuthorInfo {
  username: string
  name: string
}

function extractGithubUsername(email: string): string | null {
  const noreplyMatch = email.match(/^\d+\+(.+)@users\.noreply\.github\.com$/)
  if (noreplyMatch) return noreplyMatch[1]
  const simpleNoreply = email.match(/^(.+)@users\.noreply\.github\.com$/)
  if (simpleNoreply) return simpleNoreply[1]
  return null
}

export async function getUniqueAuthors(
  repoPath: string,
  since: Date,
): Promise<AuthorInfo[]> {
  const proc = Bun.spawn(
    [
      'git',
      'log',
      '--all',
      '--format=%an|%ae',
      `--since=${since.toISOString()}`,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  await proc.exited

  const seen = new Map<string, AuthorInfo>()
  for (const line of output.trim().split('\n').filter(Boolean)) {
    const [name, email] = line.split('|')
    const username =
      extractGithubUsername(email ?? '') ?? email?.split('@')[0] ?? name
    if (!seen.has(username)) {
      seen.set(username, { username, name })
    }
  }

  return [...seen.values()].sort((a, b) => a.username.localeCompare(b.username))
}
