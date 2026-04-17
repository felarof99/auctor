import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Commit } from '../types'
import { getUniqueAuthors, resolveCommitsToGithubAuthors } from './authors'

const tempDirs: string[] = []
const originalFetch = globalThis.fetch
const originalGithubToken = process.env.GITHUB_TOKEN

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'auctor-authors-test-'))
  tempDirs.push(dir)
  return dir
}

async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    throw new Error(`${cmd.join(' ')} failed: ${stderr}`)
  }
  return stdout.trim()
}

async function commitAs(
  repoPath: string,
  fileName: string,
  name: string,
  email: string,
): Promise<string> {
  await Bun.write(join(repoPath, fileName), fileName)
  await run(['git', 'add', fileName], repoPath)
  await run(
    [
      'git',
      '-c',
      `user.name=${name}`,
      '-c',
      `user.email=${email}`,
      'commit',
      '-m',
      `add ${fileName}`,
    ],
    repoPath,
  )
  return run(['git', 'rev-parse', 'HEAD'], repoPath)
}

function parsedCommit(
  sha: string,
  author: string,
  authorEmail: string,
): Commit {
  return {
    sha,
    author,
    authorEmail,
    date: new Date('2026-04-17T12:00:00Z'),
    subject: 'test commit',
    insertions: 1,
    deletions: 0,
    isMerge: false,
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalGithubToken === undefined) {
    delete process.env.GITHUB_TOKEN
  } else {
    process.env.GITHUB_TOKEN = originalGithubToken
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('getUniqueAuthors', () => {
  test('resolves normal git author emails to GitHub usernames through commit metadata', async () => {
    const repoPath = mkTmp()
    await run(['git', 'init', '-b', 'main'], repoPath)
    await run(
      ['git', 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git'],
      repoPath,
    )
    const sha = await commitAs(
      repoPath,
      'one.txt',
      'Nithin Sonti',
      'nithin.sonti@gmail.com',
    )

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ author: { login: 'felarof99' } }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const authors = await getUniqueAuthors(repoPath, new Date('2000-01-01'))

    expect(calls).toEqual([
      `https://api.github.com/repos/acme/widgets/commits/${sha}`,
    ])
    expect(authors).toEqual([{ username: 'felarof99', name: 'felarof99' }])
  })

  test('does not fall back to names or email prefixes when GitHub cannot resolve a login', async () => {
    const repoPath = mkTmp()
    await run(['git', 'init', '-b', 'main'], repoPath)
    await run(
      ['git', 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git'],
      repoPath,
    )
    await commitAs(repoPath, 'one.txt', 'Neel Gupta', 'neel@example.com')

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ author: null }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const authors = await getUniqueAuthors(repoPath, new Date('2000-01-01'))

    expect(authors).toEqual([])
  })

  test('sends the configured GitHub token when resolving commit authors', async () => {
    const repoPath = mkTmp()
    await run(['git', 'init', '-b', 'main'], repoPath)
    await run(
      ['git', 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git'],
      repoPath,
    )
    await commitAs(repoPath, 'one.txt', 'Private User', 'private@example.com')
    process.env.GITHUB_TOKEN = 'test-token'

    const state: { authorization: string | null } = { authorization: null }
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const headers = new Headers(init?.headers)
      state.authorization = headers.get('authorization')
      return new Response(JSON.stringify({ author: { login: 'private-user' } }))
    }) as unknown as typeof fetch

    const authors = await getUniqueAuthors(repoPath, new Date('2000-01-01'))

    expect(state.authorization).toBe('Bearer test-token')
    expect(authors.map((a) => a.username)).toEqual(['private-user'])
  })

  test('skips unresolved normal emails when the GitHub request fails', async () => {
    const repoPath = mkTmp()
    await run(['git', 'init', '-b', 'main'], repoPath)
    await run(
      ['git', 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git'],
      repoPath,
    )
    await commitAs(repoPath, 'one.txt', 'Network User', 'network@example.com')

    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const authors = await getUniqueAuthors(repoPath, new Date('2000-01-01'))

    expect(authors).toEqual([])
  })

  test('resolves analyzed commits to GitHub usernames without aliases', async () => {
    const repoPath = mkTmp()
    await run(['git', 'init', '-b', 'main'], repoPath)
    await run(
      ['git', 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git'],
      repoPath,
    )
    const commit = parsedCommit(
      'abc123',
      'Nithin Sonti',
      'nithin.sonti@gmail.com',
    )

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ author: { login: 'felarof99' } }))
    }) as unknown as typeof fetch

    const commits = await resolveCommitsToGithubAuthors(repoPath, [commit])

    expect(commits).toEqual([{ ...commit, author: 'felarof99' }])
  })

  test('drops analyzed commits that cannot resolve to a GitHub username', async () => {
    const repoPath = mkTmp()
    await run(['git', 'init', '-b', 'main'], repoPath)
    await run(
      ['git', 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git'],
      repoPath,
    )
    const commit = parsedCommit('abc123', 'Unknown User', 'unknown@example.com')

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ author: null }))
    }) as unknown as typeof fetch

    const commits = await resolveCommitsToGithubAuthors(repoPath, [commit])

    expect(commits).toEqual([])
  })
})
