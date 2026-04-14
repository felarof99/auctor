const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

async function runGitDiff(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', 'diff', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = await new Response(proc.stdout).text()
  await proc.exited
  return output
}

export async function getDiffForCommits(
  repoPath: string,
  shas: string[],
): Promise<string> {
  if (shas.length === 0) return ''

  if (shas.length === 1) {
    const sha = shas[0]
    const proc = Bun.spawn(['git', 'diff', `${sha}~1`, sha, '--', '.'], {
      cwd: repoPath,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode === 0) return output

    // First commit has no parent — diff against empty tree
    return runGitDiff([EMPTY_TREE, sha, '--', '.'], repoPath)
  }

  // Multiple shas: sort chronologically using commit timestamps, diff earliest~1 to latest
  const proc = Bun.spawn(['git', 'log', '--format=%H %ct', ...shas], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const sortOutput = await new Response(proc.stdout).text()
  await proc.exited

  // git log returns newest-first; parse and sort oldest-first by timestamp
  // Use prefix matching since shas may be abbreviated
  const entries = sortOutput
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, ts] = line.split(' ')
      return { hash, ts: parseInt(ts, 10) }
    })
    .filter((e) =>
      shas.some((s) => e.hash.startsWith(s) || s.startsWith(e.hash)),
    )
    .sort((a, b) => a.ts - b.ts)

  if (entries.length === 0) return ''

  const earliest = entries[0].hash
  const latest = entries[entries.length - 1].hash

  // If earliest is the initial commit, it won't have a parent
  const proc2 = Bun.spawn(['git', 'diff', `${earliest}~1`, latest, '--', '.'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const diffOutput = await new Response(proc2.stdout).text()
  const exitCode = await proc2.exited
  if (exitCode === 0) return diffOutput

  return runGitDiff([EMPTY_TREE, latest, '--', '.'], repoPath)
}
