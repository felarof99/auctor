import { fileURLToPath } from 'node:url'

export type ClassifierBackendName = 'bedrock' | 'local-agent'
export type LocalExecutorType = 'claude' | 'codex'

export interface LocalExecutorConfig {
  type: LocalExecutorType
  command: string
  model?: string
  effort?: string
  maxTurns?: number
  skipPermissions?: boolean
  bypassApprovals?: boolean
}

export interface ClassifierConfig {
  backend: ClassifierBackendName
  local: {
    executors: LocalExecutorConfig[]
    maxParallel: number
    timeoutMs: number
    repairAttempts: number
    skillPath: string
    extraSkillPaths: string[]
  }
}

const DEFAULT_CLASSIFIER_SKILL_PATH = fileURLToPath(
  new URL('../../skills/auctor-classifier', import.meta.url),
)

function readBackend(value: string | undefined): ClassifierBackendName {
  const backend = value ?? 'bedrock'
  if (backend === 'bedrock' || backend === 'local-agent') return backend
  throw new Error(`Unsupported classifier backend: ${backend}`)
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return /^(1|true|yes|on)$/i.test(value)
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function readExecutors(
  env: Record<string, string | undefined>,
): LocalExecutorConfig[] {
  const raw = splitCsv(env.LOCAL_CLASSIFIER_EXECUTORS || 'claude')
  return raw.map((type): LocalExecutorConfig => {
    if (type === 'claude') {
      return {
        type,
        command: env.LOCAL_CLASSIFIER_CLAUDE_COMMAND || 'claude',
        ...(env.LOCAL_CLASSIFIER_CLAUDE_MODEL
          ? { model: env.LOCAL_CLASSIFIER_CLAUDE_MODEL }
          : {}),
        ...(env.LOCAL_CLASSIFIER_CLAUDE_EFFORT
          ? { effort: env.LOCAL_CLASSIFIER_CLAUDE_EFFORT }
          : {}),
        maxTurns: readPositiveInt(env.LOCAL_CLASSIFIER_CLAUDE_MAX_TURNS, 2),
        skipPermissions: readBool(
          env.LOCAL_CLASSIFIER_CLAUDE_SKIP_PERMISSIONS,
          true,
        ),
      }
    }
    if (type === 'codex') {
      return {
        type,
        command: env.LOCAL_CLASSIFIER_CODEX_COMMAND || 'codex',
        ...(env.LOCAL_CLASSIFIER_CODEX_MODEL
          ? { model: env.LOCAL_CLASSIFIER_CODEX_MODEL }
          : {}),
        ...(env.LOCAL_CLASSIFIER_CODEX_REASONING_EFFORT
          ? { effort: env.LOCAL_CLASSIFIER_CODEX_REASONING_EFFORT }
          : {}),
        bypassApprovals: readBool(
          env.LOCAL_CLASSIFIER_CODEX_BYPASS_APPROVALS,
          true,
        ),
      }
    }
    throw new Error(`Unsupported local classifier executor: ${type}`)
  })
}

export function loadClassifierConfig(
  env: Record<string, string | undefined> = process.env,
): ClassifierConfig {
  const backend = readBackend(env.CLASSIFIER_BACKEND)
  return {
    backend,
    local: {
      executors: readExecutors(env),
      maxParallel: clamp(readInt(env.LOCAL_CLASSIFIER_MAX_PARALLEL, 4), 1, 10),
      timeoutMs:
        readPositiveInt(env.LOCAL_CLASSIFIER_TIMEOUT_SECONDS, 240) * 1000,
      repairAttempts: readPositiveInt(env.LOCAL_CLASSIFIER_REPAIR_ATTEMPTS, 1),
      skillPath:
        env.LOCAL_CLASSIFIER_SKILL_PATH || DEFAULT_CLASSIFIER_SKILL_PATH,
      extraSkillPaths: splitCsv(env.LOCAL_CLASSIFIER_EXTRA_SKILL_PATHS),
    },
  }
}
