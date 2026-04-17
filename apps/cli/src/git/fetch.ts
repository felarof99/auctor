export async function fetchAllBranches(repoPath: string): Promise<void> {
  const proc = Bun.spawn(['git', 'fetch', '--all', '--prune', '--quiet'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git fetch failed (exit ${exitCode}): ${stderr.trim()}`)
  }
}
