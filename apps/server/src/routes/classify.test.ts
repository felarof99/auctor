import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { classifyRoute } from './classify'

const app = new Hono()
app.route('/api', classifyRoute)
const tempDirs: string[] = []

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} failed: ${err}`)
  }
}

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'auctor-classify-route-test-'))
  tempDirs.push(dir)
  return dir
}

async function mkGitRepo(): Promise<string> {
  const dir = mkTmp()
  await run(['git', 'init', '-b', 'main'], dir)
  return dir
}

function postClassify(body: unknown) {
  return app.request('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('POST /api/classify', () => {
  test('returns 400 when repo_path is missing', async () => {
    const res = await postClassify({ work_units: [] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('repo_path')
  })

  test('returns 400 when work_units is missing', async () => {
    const repoPath = await mkGitRepo()
    const res = await postClassify({ repo_path: repoPath })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('work_units')
  })

  test('returns 400 when repo_path is not a git repo', async () => {
    const repoPath = mkTmp()
    const res = await postClassify({
      repo_path: repoPath,
      work_units: [],
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('git repo')
  })

  test('returns 200 with empty classifications for empty work_units', async () => {
    const repoPath = await mkGitRepo()
    const res = await postClassify({ repo_path: repoPath, work_units: [] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.classifications).toEqual([])
  })
})
