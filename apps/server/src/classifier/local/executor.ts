import { rmSync } from 'node:fs'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import type { LocalExecutorConfig } from '../config'
import { buildLocalAgentClassificationPrompt } from '../prompt'
import { buildClaudeArgs, parseClaudeStreamJson } from './claude'
import { buildCodexArgs, parseCodexJsonl } from './codex'
import { parseClassificationJson } from './json'
import type { LocalExecutorRuntime } from './orchestrator'

export interface RunLocalProcessInput {
  command: string
  args: string[]
  cwd: string
  prompt: string
  timeoutMs: number
  env?: Record<string, string | undefined>
}

export interface RunLocalProcessResult {
  stdout: string
  stderr: string
}

export interface CreateLocalExecutorInput {
  config: LocalExecutorConfig
  timeoutMs: number
  claudeSkillBundleDir: string
  createCodexHome: () => Promise<string>
}

const SAFE_PARENT_ENV_NAMES = new Set([
  'HOME',
  'LANG',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
])

export async function runLocalProcess(
  input: RunLocalProcessInput,
): Promise<RunLocalProcessResult> {
  const command = formatCommand(input.command, input.args)
  const proc = Bun.spawn([input.command, ...input.args], {
    cwd: input.cwd,
    env: buildLocalProcessEnv(input.env),
    stdin: new Blob([input.prompt]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const completion = readProcessCompletion(proc, command)
  completion.catch(() => {
    // A timeout rejects without waiting for process streams. Keep observing
    // late process completion so stream/exited failures do not go unhandled.
  })

  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      killProcess(proc)
      reject(new Error(`${command} timed out after ${input.timeoutMs}ms`))
    }, input.timeoutMs)
  })

  try {
    return await Promise.race([completion, deadline])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function readProcessCompletion(
  proc: Bun.Subprocess<Blob, 'pipe', 'pipe'>,
  command: string,
): Promise<RunLocalProcessResult> {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(
      `${command} failed with code ${exitCode}: ${firstNonEmptyLine(stderr)}`,
    )
  }

  return { stdout, stderr }
}

function killProcess(proc: Bun.Subprocess<Blob, 'pipe', 'pipe'>): void {
  try {
    proc.kill('SIGKILL')
  } catch {
    try {
      proc.kill()
    } catch {}
  }
}

function buildLocalProcessEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && isSafeParentEnvName(key)) {
      env[key] = value
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }

  return env
}

function isSafeParentEnvName(key: string): boolean {
  return SAFE_PARENT_ENV_NAMES.has(key) || key.startsWith('LC_')
}

export function createLocalExecutor(
  input: CreateLocalExecutorInput,
): LocalExecutorRuntime {
  const { config } = input

  if (config.type === 'claude') {
    return {
      type: 'claude',
      async classify({ repoPath, workUnit }) {
        return classifyWithClaude({
          repoPath,
          workUnit,
          config,
          timeoutMs: input.timeoutMs,
          skillBundleDir: input.claudeSkillBundleDir,
        })
      },
    }
  }

  if (config.type === 'codex') {
    return {
      type: 'codex',
      async classify({ repoPath, workUnit }) {
        return classifyWithCodex({
          repoPath,
          workUnit,
          config,
          timeoutMs: input.timeoutMs,
          createCodexHome: input.createCodexHome,
        })
      },
    }
  }

  throw new Error(`Unsupported local executor type: ${config.type}`)
}

async function classifyWithClaude(input: {
  repoPath: string
  workUnit: WorkUnit
  config: LocalExecutorConfig
  timeoutMs: number
  skillBundleDir: string
}): Promise<Classification> {
  const prompt = buildLocalAgentClassificationPrompt(input.workUnit)
  const args = buildClaudeArgs({
    model: input.config.model,
    effort: input.config.effort,
    maxTurns: input.config.maxTurns,
    skipPermissions: input.config.skipPermissions,
    skillBundleDir: input.skillBundleDir,
  })
  const { stdout } = await runLocalProcess({
    command: input.config.command,
    args,
    cwd: input.repoPath,
    prompt,
    timeoutMs: input.timeoutMs,
  })

  return parseClassificationJson(parseClaudeStreamJson(stdout).finalText)
}

async function classifyWithCodex(input: {
  repoPath: string
  workUnit: WorkUnit
  config: LocalExecutorConfig
  timeoutMs: number
  createCodexHome: () => Promise<string>
}): Promise<Classification> {
  const prompt = buildLocalAgentClassificationPrompt(input.workUnit)
  const args = buildCodexArgs({
    model: input.config.model,
    effort: input.config.effort,
    bypassApprovals: input.config.bypassApprovals,
  })
  let codexHomeDir: string | undefined

  try {
    codexHomeDir = await input.createCodexHome()
    const { stdout } = await runLocalProcess({
      command: input.config.command,
      args,
      cwd: input.repoPath,
      env: {
        CODEX_HOME: codexHomeDir,
      },
      prompt,
      timeoutMs: input.timeoutMs,
    })

    return parseClassificationJson(parseCodexJsonl(stdout).finalText)
  } finally {
    if (codexHomeDir) {
      rmSync(codexHomeDir, { recursive: true, force: true })
    }
  }
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ')
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? 'no stderr output'
  )
}
