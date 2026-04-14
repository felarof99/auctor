export async function getUniqueAuthors(
  repoPath: string,
  since: Date,
): Promise<string[]> {
  const proc = Bun.spawn(
    ['git', 'log', '--all', '--format=%an', `--since=${since.toISOString()}`],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  await proc.exited
  const authors = [...new Set(output.trim().split('\n').filter(Boolean))]
  return authors.sort()
}
