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
  codexHomeDir: string
}

export async function runLocalProcess(
  input: RunLocalProcessInput,
): Promise<RunLocalProcessResult> {
  const proc = Bun.spawn([input.command, ...input.args], {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
    },
    stdin: new Blob([input.prompt]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, input.timeoutMs)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (timedOut) {
      throw new Error(
        `${formatCommand(input.command, input.args)} timed out after ${input.timeoutMs}ms`,
      )
    }

    if (exitCode !== 0) {
      throw new Error(
        `${formatCommand(input.command, input.args)} failed with code ${exitCode}: ${firstNonEmptyLine(stderr)}`,
      )
    }

    return { stdout, stderr }
  } finally {
    clearTimeout(timeout)
  }
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
          codexHomeDir: input.codexHomeDir,
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
  codexHomeDir: string
}): Promise<Classification> {
  const prompt = buildLocalAgentClassificationPrompt(input.workUnit)
  const args = buildCodexArgs({
    model: input.config.model,
    effort: input.config.effort,
    bypassApprovals: input.config.bypassApprovals,
  })
  const { stdout } = await runLocalProcess({
    command: input.config.command,
    args,
    cwd: input.repoPath,
    env: {
      CODEX_HOME: input.codexHomeDir,
    },
    prompt,
    timeoutMs: input.timeoutMs,
  })

  return parseClassificationJson(parseCodexJsonl(stdout).finalText)
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
