import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkUnit } from '@auctor/shared/classification'
import { createLocalExecutor, runLocalProcess } from './executor'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = realpathSync(
    mkdtempSync(join(tmpdir(), 'auctor-local-executor-test-')),
  )
  tempDirs.push(dir)
  return dir
}

function writeExecutable(dir: string, name: string, source: string): string {
  const scriptPath = join(dir, name)
  writeFileSync(scriptPath, `#!/usr/bin/env bun\n${source}`)
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

function sampleWorkUnit(): WorkUnit {
  return {
    id: 'unit-1',
    kind: 'branch-day',
    author: 'dev@example.com',
    branch: 'feature/local-executor',
    date: '2026-04-18',
    commit_shas: ['abc123'],
    commit_messages: ['Add local executor'],
    diff: 'diff --git a/executor.ts b/executor.ts\n+export const ok = true',
    insertions: 1,
    deletions: 0,
    net: 1,
  }
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('runLocalProcess', () => {
  test('runs in cwd, passes safe and explicit env, writes stdin, and returns stdout/stderr', async () => {
    const dir = makeTempDir()
    const originalSecret = process.env.AUCTOR_TEST_PARENT_SECRET
    const originalUnsafe = process.env.AUCTOR_TEST_UNSAFE_OVERRIDE
    process.env.AUCTOR_TEST_PARENT_SECRET = 'parent-secret'
    process.env.AUCTOR_TEST_UNSAFE_OVERRIDE = 'parent-unsafe'
    const script = writeExecutable(
      dir,
      'inspect-process.ts',
      `
const prompt = await Bun.stdin.text()
console.error(process.env.EXTRA_FLAG ?? '')
console.log(JSON.stringify({
  cwd: process.cwd(),
  args: Bun.argv.slice(2),
  prompt,
  inheritedPath: typeof process.env.PATH === 'string' && process.env.PATH.length > 0,
  inheritedParentSecret: process.env.AUCTOR_TEST_PARENT_SECRET ?? null,
  explicitUnsafeOverride: process.env.AUCTOR_TEST_UNSAFE_OVERRIDE ?? null,
}))
`,
    )

    try {
      const result = await runLocalProcess({
        command: script,
        args: ['one', 'two'],
        cwd: dir,
        env: {
          AUCTOR_TEST_UNSAFE_OVERRIDE: 'explicit-unsafe',
          EXTRA_FLAG: 'merged',
        },
        prompt: 'hello from stdin',
        timeoutMs: 5000,
      })

      expect(result.stderr.trim()).toBe('merged')
      expect(JSON.parse(result.stdout)).toEqual({
        cwd: dir,
        args: ['one', 'two'],
        prompt: 'hello from stdin',
        inheritedPath: true,
        inheritedParentSecret: null,
        explicitUnsafeOverride: 'explicit-unsafe',
      })
    } finally {
      if (originalSecret === undefined) {
        delete process.env.AUCTOR_TEST_PARENT_SECRET
      } else {
        process.env.AUCTOR_TEST_PARENT_SECRET = originalSecret
      }
      if (originalUnsafe === undefined) {
        delete process.env.AUCTOR_TEST_UNSAFE_OVERRIDE
      } else {
        process.env.AUCTOR_TEST_UNSAFE_OVERRIDE = originalUnsafe
      }
    }
  })

  test('throws command, code, and first non-empty stderr line on non-zero exit', async () => {
    const dir = makeTempDir()
    const script = writeExecutable(
      dir,
      'fail-process.ts',
      `
console.error('')
console.error('first useful stderr line')
console.error('second stderr line')
process.exit(7)
`,
    )

    await expect(
      runLocalProcess({
        command: script,
        args: [],
        cwd: dir,
        prompt: '',
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(`${script} failed with code 7: first useful stderr line`)
  })

  test('kills the process when timeout elapses', async () => {
    const dir = makeTempDir()
    const script = writeExecutable(
      dir,
      'slow-process.ts',
      `
await new Promise((resolve) => setTimeout(resolve, 10_000))
console.log('late output')
`,
    )

    await expect(
      runLocalProcess({
        command: script,
        args: [],
        cwd: dir,
        prompt: '',
        timeoutMs: 30,
      }),
    ).rejects.toThrow(`${script} timed out after 30ms`)
  })

  test('rejects at the timeout deadline when the child ignores SIGTERM', async () => {
    const dir = makeTempDir()
    const script = writeExecutable(
      dir,
      'ignore-sigterm-process.ts',
      `
process.on('SIGTERM', () => {
  console.error('ignored SIGTERM')
})
await new Promise((resolve) => setTimeout(resolve, 1200))
console.log('late output')
`,
    )
    const startedAt = performance.now()

    await expect(
      runLocalProcess({
        command: script,
        args: [],
        cwd: dir,
        prompt: '',
        timeoutMs: 300,
      }),
    ).rejects.toThrow(`${script} timed out after 300ms`)

    expect(performance.now() - startedAt).toBeLessThan(700)
  })
})

describe('createLocalExecutor', () => {
  test('creates a Claude executor that prompts, runs in repo cwd, parses output, and validates JSON', async () => {
    const repoPath = makeTempDir()
    const skillBundleDir = join(makeTempDir(), 'claude-skills')
    const script = writeExecutable(
      makeTempDir(),
      'fake-claude.ts',
      `
const prompt = await Bun.stdin.text()
const args = Bun.argv.slice(2)
if (process.cwd() !== ${JSON.stringify(repoPath)}) {
  console.error('wrong cwd')
  process.exit(2)
}
if (!prompt.includes('Use the auctor-classifier skill') || !prompt.includes('unit-1')) {
  console.error('missing prompt content')
  process.exit(3)
}
if (JSON.stringify(args) !== JSON.stringify(${JSON.stringify([
        '--print',
        '-',
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        '2',
        '--dangerously-skip-permissions',
        '--add-dir',
        skillBundleDir,
        '--model',
        'claude-test-model',
        '--effort',
        'high',
      ])})) {
  console.error('wrong claude args')
  process.exit(4)
}
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-1' }))
console.log(JSON.stringify({
  type: 'result',
  session_id: 'session-1',
  result: JSON.stringify({
    type: 'feature',
    difficulty: 'medium',
    impact_score: 6,
    reasoning: 'classified by fake claude',
  }),
}))
`,
    )
    const executor = createLocalExecutor({
      config: {
        type: 'claude',
        command: script,
        model: 'claude-test-model',
        effort: 'high',
        maxTurns: 2,
        skipPermissions: true,
      },
      timeoutMs: 5000,
      claudeSkillBundleDir: skillBundleDir,
      codexHomeDir: join(makeTempDir(), 'unused-codex-home'),
    })

    const classification = await executor.classify({
      repoPath,
      workUnit: sampleWorkUnit(),
    })

    expect(executor.type).toBe('claude')
    expect(classification).toEqual({
      type: 'feature',
      difficulty: 'medium',
      impact_score: 6,
      reasoning: 'classified by fake claude',
    })
  })

  test('creates a Codex executor that sets CODEX_HOME, prompts, parses output, and validates JSON', async () => {
    const repoPath = makeTempDir()
    const codexHomeDir = join(makeTempDir(), 'codex-home')
    const script = writeExecutable(
      makeTempDir(),
      'fake-codex.ts',
      `
const prompt = await Bun.stdin.text()
const args = Bun.argv.slice(2)
if (process.cwd() !== ${JSON.stringify(repoPath)}) {
  console.error('wrong cwd')
  process.exit(2)
}
if (process.env.CODEX_HOME !== ${JSON.stringify(codexHomeDir)}) {
  console.error('wrong CODEX_HOME')
  process.exit(3)
}
if (!prompt.includes('Use the auctor-classifier skill') || !prompt.includes('unit-1')) {
  console.error('missing prompt content')
  process.exit(4)
}
if (JSON.stringify(args) !== JSON.stringify(${JSON.stringify([
        'exec',
        '--json',
        '--dangerously-bypass-approvals-and-sandbox',
        '--model',
        'codex-test-model',
        '-c',
        'model_reasoning_effort="medium"',
        '-',
      ])})) {
  console.error('wrong codex args')
  process.exit(5)
}
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }))
console.log(JSON.stringify({
  type: 'item.completed',
  item: {
    type: 'agent_message',
    text: JSON.stringify({
      type: 'bugfix',
      difficulty: 'easy',
      impact_score: 4,
      reasoning: 'classified by fake codex',
    }),
  },
}))
`,
    )
    const executor = createLocalExecutor({
      config: {
        type: 'codex',
        command: script,
        model: 'codex-test-model',
        effort: 'medium',
        bypassApprovals: true,
      },
      timeoutMs: 5000,
      claudeSkillBundleDir: join(makeTempDir(), 'unused-claude-skills'),
      codexHomeDir,
    })

    const classification = await executor.classify({
      repoPath,
      workUnit: sampleWorkUnit(),
    })

    expect(executor.type).toBe('codex')
    expect(classification).toEqual({
      type: 'bugfix',
      difficulty: 'easy',
      impact_score: 4,
      reasoning: 'classified by fake codex',
    })
  })
})
