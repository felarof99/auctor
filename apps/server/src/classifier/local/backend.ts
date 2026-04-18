import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import type { ClassifierBackend } from '../backend'
import type { ClassifierConfig } from '../config'
import { LOCAL_CLASSIFIER_PROMPT_VERSION } from '../prompt'
import { type CreateLocalExecutorInput, createLocalExecutor } from './executor'
import {
  classifyWithLocalExecutors,
  type LocalExecutorRuntime,
} from './orchestrator'
import {
  materializeClaudeSkillBundle,
  materializeCodexSkillsHome,
  resolveSkillBundle,
  type SkillBundle,
} from './skills'

export interface LocalAgentCacheContext {
  backend: 'local-agent'
  executor: string | null
  model: string | null
  effort: string | null
  promptVersion: string
  skillBundleHash: string | null
}

export interface LocalAgentClassifierBackendOptions {
  cacheRoot?: string
  resolveSkillBundle?: typeof resolveSkillBundle
  materializeClaudeSkillBundle?: typeof materializeClaudeSkillBundle
  materializeCodexSkillsHome?: typeof materializeCodexSkillsHome
  createLocalExecutor?: (
    input: CreateLocalExecutorInput,
  ) => LocalExecutorRuntime
  classifyWithLocalExecutors?: typeof classifyWithLocalExecutors
}

interface LocalAgentClassifierBackendInput {
  executors: LocalExecutorRuntime[]
  maxParallel: number
  cacheContext: LocalAgentCacheContext
  classifyManyWithExecutors: typeof classifyWithLocalExecutors
}

export class LocalAgentClassifierBackend implements ClassifierBackend {
  readonly cacheContext: LocalAgentCacheContext
  private readonly executors: LocalExecutorRuntime[]
  private readonly maxParallel: number
  private readonly classifyManyWithExecutors: typeof classifyWithLocalExecutors

  constructor(input: LocalAgentClassifierBackendInput) {
    this.executors = input.executors
    this.maxParallel = input.maxParallel
    this.cacheContext = input.cacheContext
    this.classifyManyWithExecutors = input.classifyManyWithExecutors
  }

  async classifyMany(input: {
    repoPath: string
    workUnits: WorkUnit[]
  }): Promise<Map<string, Classification>> {
    return this.classifyManyWithExecutors({
      repoPath: input.repoPath,
      workUnits: input.workUnits,
      maxParallel: this.maxParallel,
      executors: this.executors,
    })
  }
}

export async function createLocalAgentClassifierBackend(
  config: ClassifierConfig['local'],
  options: LocalAgentClassifierBackendOptions = {},
): Promise<LocalAgentClassifierBackend> {
  const resolveBundle = options.resolveSkillBundle ?? resolveSkillBundle
  const materializeClaude =
    options.materializeClaudeSkillBundle ?? materializeClaudeSkillBundle
  const materializeCodex =
    options.materializeCodexSkillsHome ?? materializeCodexSkillsHome
  const createExecutor = options.createLocalExecutor ?? createLocalExecutor
  const classifyMany =
    options.classifyWithLocalExecutors ?? classifyWithLocalExecutors

  const bundle = await resolveBundle(config.skillPath, config.extraSkillPaths)
  const configSignature = buildLocalAgentConfigSignature(config)
  const cacheRoot =
    options.cacheRoot ??
    process.env.LOCAL_CLASSIFIER_CACHE_DIR ??
    join(tmpdir(), 'auctor-local-classifier')
  const claudeSkillBundleDir = await materializeClaude(
    bundle,
    join(cacheRoot, 'claude'),
  )
  const codexHomeDir = join(cacheRoot, 'codex', bundle.hash, configSignature)
  await materializeCodex(bundle, codexHomeDir)

  const executors = config.executors.map((executorConfig) =>
    createExecutor({
      config: executorConfig,
      timeoutMs: config.timeoutMs,
      claudeSkillBundleDir,
      codexHomeDir,
    }),
  )

  return new LocalAgentClassifierBackend({
    executors,
    maxParallel: config.maxParallel,
    cacheContext: buildLocalAgentCacheContext(bundle, configSignature),
    classifyManyWithExecutors: classifyMany,
  })
}

export function buildLocalAgentConfigSignature(
  config: ClassifierConfig['local'],
): string {
  return createHash('sha256')
    .update(
      stableJsonStringify({
        executors: config.executors.map((executor) => ({
          type: executor.type,
          command: executor.command,
          model: executor.model ?? null,
          effort: executor.effort ?? null,
          maxTurns: executor.maxTurns ?? null,
          skipPermissions: executor.skipPermissions ?? null,
          bypassApprovals: executor.bypassApprovals ?? null,
        })),
        maxParallel: config.maxParallel,
        timeoutMs: config.timeoutMs,
        repairAttempts: config.repairAttempts,
      }),
    )
    .digest('hex')
}

function buildLocalAgentCacheContext(
  bundle: SkillBundle,
  configSignature: string,
): LocalAgentCacheContext {
  return {
    backend: 'local-agent',
    executor: `executors:${configSignature}`,
    model: null,
    effort: null,
    promptVersion: LOCAL_CLASSIFIER_PROMPT_VERSION,
    skillBundleHash: bundle.hash,
  }
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(',')}}`
}
