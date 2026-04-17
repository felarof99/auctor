import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

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
})
