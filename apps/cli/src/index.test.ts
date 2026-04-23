import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

const tmpDirs: string[] = []

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'auctor-cli-test-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

async function runCli(args: string[]) {
  const proc = Bun.spawn(['bun', 'src/index.ts', ...args], {
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stderr = await new Response(proc.stderr).text()
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited

  return { exitCode, output: `${stdout}\n${stderr}` }
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

async function createRepoWithAliceCommit(): Promise<string> {
  const repoPath = mkTmp()
  await run(['git', 'init', '-b', 'main'], repoPath)
  await Bun.write(join(repoPath, 'one.txt'), 'one\n')
  await run(['git', 'add', 'one.txt'], repoPath)
  await run(
    [
      'git',
      '-c',
      'user.name=Alice',
      '-c',
      'user.email=123+alice@users.noreply.github.com',
      'commit',
      '-m',
      'add one.txt',
    ],
    repoPath,
  )
  return repoPath
}

describe('CLI argument parsing', () => {
  test('analyze accepts dashed day windows as positional arguments', async () => {
    const { exitCode, output } = await runCli([
      'analyze',
      '/tmp/missing-auctor-config.yaml',
      '-7d',
      '--no-fetch',
    ])

    expect(exitCode).toBe(1)
    expect(output).toContain('Bundle config not found')
    expect(output).not.toContain("unknown option '-7d'")
  })

  test('configure accepts dashed day windows as positional arguments', async () => {
    const { exitCode, output } = await runCli([
      'configure',
      '/tmp/missing-auctor-config.yaml',
      '-7d',
      '/tmp/not-a-repo',
    ])

    expect(exitCode).toBe(1)
    expect(output).toContain('Not a git repository')
    expect(output).not.toContain("unknown option '-7d'")
  })

  test('configure can create a bundle without prompts', async () => {
    const dir = mkTmp()
    const repoPath = await createRepoWithAliceCommit()
    const configPath = join(dir, 'team_config.yaml')

    const { exitCode, output } = await runCli([
      'configure',
      configPath,
      '-3650d',
      repoPath,
      '--name',
      'team',
      '--engineers',
      'alice,bob',
    ])

    expect(exitCode).toBe(0)
    expect(output).toContain('Saved bundle team')
    const config = parse(await Bun.file(configPath).text()) as {
      name: string
      repos: Array<{ name: string; path: string }>
      engineers: string[]
    }
    expect(config.name).toBe('team')
    expect(config.repos).toEqual([
      { name: repoPath.split('/').at(-1) ?? '', path: repoPath },
    ])
    expect(config.engineers).toEqual(['alice', 'bob'])
  })

  test('configure can select all discovered engineers without prompts', async () => {
    const dir = mkTmp()
    const repoPath = await createRepoWithAliceCommit()
    const configPath = join(dir, 'browseros_config.yaml')

    const { exitCode } = await runCli([
      'configure',
      configPath,
      '-3650d',
      repoPath,
      '--all-engineers',
    ])

    expect(exitCode).toBe(0)
    const config = parse(await Bun.file(configPath).text()) as {
      name: string
      engineers: string[]
    }
    expect(config.name).toBe('browseros')
    expect(config.engineers).toEqual(['alice'])
  })

  test('configure rejects conflicting engineer selection flags', async () => {
    const repoPath = await createRepoWithAliceCommit()
    const configPath = join(mkTmp(), 'team.yaml')

    const { exitCode, output } = await runCli([
      'configure',
      configPath,
      '-3650d',
      repoPath,
      '--engineers',
      'alice',
      '--all-engineers',
    ])

    expect(exitCode).toBe(1)
    expect(output).toContain('Use either --engineers or --all-engineers')
  })

  test('microscope can run for an explicit engineer and JSON path', async () => {
    const dir = mkTmp()
    const repoPath = await createRepoWithAliceCommit()
    const configPath = join(dir, 'team.yaml')
    const reportPath = join(dir, 'alice-report.json')
    await Bun.write(
      configPath,
      [
        'name: team',
        'repos:',
        `  - name: ${repoPath.split('/').at(-1)}`,
        `    path: ${repoPath}`,
        'engineers:',
        '  - alice',
        '',
      ].join('\n'),
    )

    const { exitCode, output } = await runCli([
      'microscope',
      configPath,
      '-3650d',
      '--engineer',
      'alice',
      '--json',
      reportPath,
    ])

    expect(exitCode).toBe(0)
    expect(output).toContain('microscope: alice')
    expect(output).toContain(`Report written to ${reportPath}`)
    const report = (await Bun.file(reportPath).json()) as {
      username: string
      days: Array<{ commits: Array<{ repo: string; subject: string }> }>
    }
    expect(report.username).toBe('alice')
    expect(report.days[0].commits[0].subject).toBe('add one.txt')
  })

  test('microscope rejects unknown explicit engineers', async () => {
    const dir = mkTmp()
    const repoPath = await createRepoWithAliceCommit()
    const configPath = join(dir, 'team.yaml')
    await Bun.write(
      configPath,
      [
        'name: team',
        'repos:',
        `  - name: ${repoPath.split('/').at(-1)}`,
        `    path: ${repoPath}`,
        'engineers:',
        '  - alice',
        '',
      ].join('\n'),
    )

    const { exitCode, output } = await runCli([
      'microscope',
      configPath,
      '-3650d',
      '--engineer',
      'bob',
    ])

    expect(exitCode).toBe(1)
    expect(output).toContain('Engineer not found in bundle: bob')
  })
})
