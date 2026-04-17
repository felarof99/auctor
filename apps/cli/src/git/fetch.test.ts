import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchAllBranches } from './fetch'

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} failed: ${err}`)
  }
}

describe('fetchAllBranches', () => {
  let bareRepo: string
  let clientRepo: string
  let tempRoot: string

  beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'auctor-fetch-test-'))
    bareRepo = join(tempRoot, 'origin.git')
    clientRepo = join(tempRoot, 'client')

    // Create bare origin repo
    await run(['git', 'init', '--bare', '-b', 'main', bareRepo], tempRoot)

    // Create a seed repo, commit, push to origin
    const seed = join(tempRoot, 'seed')
    await run(['git', 'init', '-b', 'main', seed], tempRoot)
    await run(['git', 'config', 'user.email', 'test@test'], seed)
    await run(['git', 'config', 'user.name', 'Test'], seed)
    await Bun.write(join(seed, 'README.md'), 'hello')
    await run(['git', 'add', '.'], seed)
    await run(['git', 'commit', '-m', 'init'], seed)
    await run(['git', 'remote', 'add', 'origin', bareRepo], seed)
    await run(['git', 'push', 'origin', 'main'], seed)

    // Create client repo by cloning origin
    await run(['git', 'clone', bareRepo, clientRepo], tempRoot)
  })

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test('succeeds against a repo with a reachable remote', async () => {
    await expect(fetchAllBranches(clientRepo)).resolves.toBeUndefined()
  })

  test('throws when the directory is not a git repo', async () => {
    const notARepo = join(tempRoot, 'not-a-repo')
    await Bun.write(join(notARepo, 'placeholder'), '')
    await expect(fetchAllBranches(notARepo)).rejects.toThrow()
  })

  test('throws when the path does not exist', async () => {
    await expect(fetchAllBranches('/nonexistent/path/xyz')).rejects.toThrow()
  })
})
