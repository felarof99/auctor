# Local Agent Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-agent classifier backend that classifies Auctor work units by running local Claude Code and Codex executor processes with an injected `auctor-classifier` skill and strict local `repo_path` context.

**Architecture:** Keep classification behind the existing server route, but change the classify payload to require `repo_path`. Add a backend abstraction with Bedrock and local-agent implementations. Local-agent mode builds a skill bundle, runs a bounded pool of child-process executors directly in `repo_path`, validates JSON with `ClassificationSchema`, caches by work-unit content plus skill hash, and throws on any local-agent failure.

**Tech Stack:** Bun, TypeScript, Hono, Zod, Bun SQLite, local `claude` CLI, local `codex` CLI, existing `@auctor/shared` workspace package.

---

## File Structure

- Modify `packages/shared/src/api-types.ts`: change `ClassifyRequest` to `{ repo_path, work_units }`.
- Modify `apps/cli/src/api-client.ts`: build and POST the new payload.
- Modify `apps/cli/src/api-client.test.ts`: cover `repo_path`.
- Modify `apps/cli/src/commands/analyze.ts`: call classifier when `bundle.server_url` is set and use returned classifications.
- Modify `apps/cli/src/commands/analyze.test.ts`: add small exported-helper tests for classification response mapping.
- Modify `apps/server/src/routes/classify.ts`: validate `repo_path`, select backend, use cache keys, return strict errors.
- Modify `apps/server/src/routes/classify.test.ts`: reject missing/invalid `repo_path`, exercise cache-before-executor behavior.
- Modify `apps/server/src/classifier/agent.ts`: move Bedrock logic behind `BedrockClassifierBackend`.
- Modify `apps/server/src/classifier/cache.ts`: add content/config cache keys while keeping compatibility helpers if useful.
- Modify `apps/server/src/classifier/cache.test.ts`: test cache key reads/writes.
- Modify `apps/server/src/classifier/prompt.ts`: add local-agent prompt builder that invokes the skill.
- Modify `apps/server/src/classifier/prompt.test.ts`: verify local prompt invokes the skill and includes schema data.
- Create `apps/server/src/classifier/backend.ts`: backend interface, backend result helpers.
- Create `apps/server/src/classifier/config.ts`: environment parsing and validation.
- Create `apps/server/src/classifier/config.test.ts`: config defaults, clamp, validation.
- Create `apps/server/src/classifier/local/claude.ts`: Claude command builder and stream parser.
- Create `apps/server/src/classifier/local/claude.test.ts`: parser and args tests.
- Create `apps/server/src/classifier/local/codex.ts`: Codex command builder and JSONL parser.
- Create `apps/server/src/classifier/local/codex.test.ts`: parser and args tests.
- Create `apps/server/src/classifier/local/json.ts`: tolerant JSON extraction and schema validation.
- Create `apps/server/src/classifier/local/json.test.ts`: raw JSON, fenced JSON, embedded object, schema failures.
- Create `apps/server/src/classifier/local/skills.ts`: skill validation, bundle hashing, Claude bundle materialization, Codex home materialization.
- Create `apps/server/src/classifier/local/skills.test.ts`: hash changes, bundle layout, invalid skill errors.
- Create `apps/server/src/classifier/local/orchestrator.ts`: bounded pool and strict local-agent execution.
- Create `apps/server/src/classifier/local/orchestrator.test.ts`: max concurrency, round-robin executor assignment, strict failure behavior.
- Create `apps/server/skills/auctor-classifier/SKILL.md`: reusable classifier skill with read-only instructions.

---

### Task 1: Shared API And CLI Payload Contract

**Files:**
- Modify: `packages/shared/src/api-types.ts`
- Modify: `apps/cli/src/api-client.ts`
- Modify: `apps/cli/src/api-client.test.ts`

- [ ] **Step 1: Write the failing API client test**

Replace `apps/cli/src/api-client.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test'
import type { WorkUnit } from '@auctor/shared/classification'
import { buildClassifyPayload } from './api-client'

function makeUnit(): WorkUnit {
  return {
    id: 'abc',
    kind: 'branch-day',
    author: 'Alice',
    branch: 'main',
    date: '2026-04-10',
    commit_shas: ['sha1'],
    commit_messages: ['feat: something'],
    diff: '+line',
    insertions: 10,
    deletions: 0,
    net: 10,
  }
}

describe('buildClassifyPayload', () => {
  test('builds a repo_path-only request body', () => {
    const payload = buildClassifyPayload('/Users/me/repo', [makeUnit()])

    expect(payload.repo_path).toBe('/Users/me/repo')
    expect('repo_url' in payload).toBe(false)
    expect(payload.work_units).toHaveLength(1)
    expect(payload.work_units[0].id).toBe('abc')
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test apps/cli/src/api-client.test.ts
```

Expected: FAIL because `buildClassifyPayload` still accepts `repoUrl` and emits `repo_url`.

- [ ] **Step 3: Update shared API types**

Replace `packages/shared/src/api-types.ts` with:

```ts
import type { Classification, WorkUnit } from './classification'

export interface ClassifyRequest {
  repo_path: string
  work_units: WorkUnit[]
}

export interface ClassifiedWorkUnit {
  id: string
  classification: Classification
}

export interface ClassifyResponse {
  classifications: ClassifiedWorkUnit[]
}
```

- [ ] **Step 4: Update the CLI API client**

Replace `apps/cli/src/api-client.ts` with:

```ts
import type {
  ClassifyRequest,
  ClassifyResponse,
} from '@auctor/shared/api-types'
import type { WorkUnit } from '@auctor/shared/classification'

const DEFAULT_SERVER_URL = 'http://localhost:3001'

export function buildClassifyPayload(
  repoPath: string,
  workUnits: WorkUnit[],
): ClassifyRequest {
  return { repo_path: repoPath, work_units: workUnits }
}

export async function classifyWorkUnits(
  serverUrl: string | undefined,
  repoPath: string,
  workUnits: WorkUnit[],
): Promise<ClassifyResponse> {
  const base = serverUrl || DEFAULT_SERVER_URL
  const payload = buildClassifyPayload(repoPath, workUnits)

  const response = await fetch(`${base}/api/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Classification failed (${response.status}): ${text}`)
  }

  return response.json() as Promise<ClassifyResponse>
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test apps/cli/src/api-client.test.ts
```

Expected: PASS.

Commit:

```bash
git add packages/shared/src/api-types.ts apps/cli/src/api-client.ts apps/cli/src/api-client.test.ts
git commit -m "feat(classifier): require repo path classify payload"
```

---

### Task 2: Server Config And Backend Interface

**Files:**
- Create: `apps/server/src/classifier/backend.ts`
- Create: `apps/server/src/classifier/config.ts`
- Create: `apps/server/src/classifier/config.test.ts`

- [ ] **Step 1: Write config tests**

Create `apps/server/src/classifier/config.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { loadClassifierConfig } from './config'

describe('loadClassifierConfig', () => {
  test('defaults to bedrock backend', () => {
    const config = loadClassifierConfig({})
    expect(config.backend).toBe('bedrock')
  })

  test('clamps local parallelism to 1 through 10', () => {
    expect(
      loadClassifierConfig({
        CLASSIFIER_BACKEND: 'local-agent',
        LOCAL_CLASSIFIER_MAX_PARALLEL: '0',
      }).local.maxParallel,
    ).toBe(1)
    expect(
      loadClassifierConfig({
        CLASSIFIER_BACKEND: 'local-agent',
        LOCAL_CLASSIFIER_MAX_PARALLEL: '99',
      }).local.maxParallel,
    ).toBe(10)
  })

  test('parses enabled executors and skill paths', () => {
    const config = loadClassifierConfig({
      CLASSIFIER_BACKEND: 'local-agent',
      LOCAL_CLASSIFIER_EXECUTORS: 'claude,codex',
      LOCAL_CLASSIFIER_SKILL_PATH: './skills/auctor-classifier',
      LOCAL_CLASSIFIER_EXTRA_SKILL_PATHS: './skills/one, ./skills/two',
    })

    expect(config.backend).toBe('local-agent')
    expect(config.local.executors.map((e) => e.type)).toEqual([
      'claude',
      'codex',
    ])
    expect(config.local.skillPath).toBe('./skills/auctor-classifier')
    expect(config.local.extraSkillPaths).toEqual(['./skills/one', './skills/two'])
  })

  test('throws for unknown backend or executor', () => {
    expect(() =>
      loadClassifierConfig({ CLASSIFIER_BACKEND: 'other' }),
    ).toThrow('Unsupported classifier backend')
    expect(() =>
      loadClassifierConfig({
        CLASSIFIER_BACKEND: 'local-agent',
        LOCAL_CLASSIFIER_EXECUTORS: 'bad',
      }),
    ).toThrow('Unsupported local classifier executor')
  })
})
```

- [ ] **Step 2: Run config tests and confirm red**

Run:

```bash
bun test apps/server/src/classifier/config.test.ts
```

Expected: FAIL because `config.ts` does not exist.

- [ ] **Step 3: Add backend interface**

Create `apps/server/src/classifier/backend.ts`:

```ts
import type { Classification, WorkUnit } from '@auctor/shared/classification'

export interface ClassifierBackend {
  classifyMany(input: {
    repoPath: string
    workUnits: WorkUnit[]
  }): Promise<Map<string, Classification>>
}

export function mapClassificationsById(
  classifications: { id: string; classification: Classification }[],
): Map<string, Classification> {
  return new Map(classifications.map((item) => [item.id, item.classification]))
}
```

- [ ] **Step 4: Add config parser**

Create `apps/server/src/classifier/config.ts`:

```ts
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

function readBackend(value: string | undefined): ClassifierBackendName {
  const backend = value ?? 'bedrock'
  if (backend === 'bedrock' || backend === 'local-agent') return backend
  throw new Error(`Unsupported classifier backend: ${backend}`)
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

function readExecutors(env: Record<string, string | undefined>): LocalExecutorConfig[] {
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
      maxParallel: clamp(
        readPositiveInt(env.LOCAL_CLASSIFIER_MAX_PARALLEL, 4),
        1,
        10,
      ),
      timeoutMs: readPositiveInt(
        env.LOCAL_CLASSIFIER_TIMEOUT_SECONDS,
        240,
      ) * 1000,
      repairAttempts: readPositiveInt(
        env.LOCAL_CLASSIFIER_REPAIR_ATTEMPTS,
        1,
      ),
      skillPath:
        env.LOCAL_CLASSIFIER_SKILL_PATH ||
        './apps/server/skills/auctor-classifier',
      extraSkillPaths: splitCsv(env.LOCAL_CLASSIFIER_EXTRA_SKILL_PATHS),
    },
  }
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test apps/server/src/classifier/config.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/server/src/classifier/backend.ts apps/server/src/classifier/config.ts apps/server/src/classifier/config.test.ts
git commit -m "feat(classifier): add backend config"
```

---

### Task 3: Classifier Skill And Skill Bundles

**Files:**
- Create: `apps/server/skills/auctor-classifier/SKILL.md`
- Create: `apps/server/src/classifier/local/skills.ts`
- Create: `apps/server/src/classifier/local/skills.test.ts`

- [ ] **Step 1: Write skill bundle tests**

Create `apps/server/src/classifier/local/skills.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  materializeClaudeSkillBundle,
  materializeCodexSkillsHome,
  resolveSkillBundle,
} from './skills'

let tempDirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeSkill(name: string, content: string): string {
  const dir = join(tempDir('auctor-skill-'), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), content)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

describe('skill bundles', () => {
  test('hash changes when skill content changes', async () => {
    const first = makeSkill('auctor-classifier', '# Skill\none\n')
    const second = makeSkill('auctor-classifier', '# Skill\ntwo\n')

    const a = await resolveSkillBundle(first, [])
    const b = await resolveSkillBundle(second, [])

    expect(a.hash).not.toBe(b.hash)
  })

  test('materializes Claude skills under .claude/skills', async () => {
    const skill = makeSkill('auctor-classifier', '# Skill\n')
    const outDir = tempDir('auctor-claude-bundle-')
    const bundle = await resolveSkillBundle(skill, [])

    const materialized = await materializeClaudeSkillBundle(bundle, outDir)

    expect(
      existsSync(join(materialized, '.claude/skills/auctor-classifier/SKILL.md')),
    ).toBe(true)
  })

  test('materializes Codex skills under skills directory', async () => {
    const skill = makeSkill('auctor-classifier', '# Skill\n')
    const homeDir = tempDir('auctor-codex-home-')
    const bundle = await resolveSkillBundle(skill, [])

    const materialized = await materializeCodexSkillsHome(bundle, homeDir)

    expect(existsSync(join(materialized, 'skills/auctor-classifier/SKILL.md'))).toBe(true)
  })

  test('rejects directories without SKILL.md', async () => {
    const dir = tempDir('auctor-bad-skill-')
    await expect(resolveSkillBundle(dir, [])).rejects.toThrow('SKILL.md')
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test apps/server/src/classifier/local/skills.test.ts
```

Expected: FAIL because `skills.ts` does not exist.

- [ ] **Step 3: Add the classifier skill**

Create `apps/server/skills/auctor-classifier/SKILL.md`:

```markdown
---
name: auctor-classifier
description: Classify Auctor work units using local repository context. Read-only: never modify files or git state.
---

# Auctor Classifier

Classify one Auctor work unit. A work unit is either a pull request unit or branch-day unit. Use the supplied metadata, commit messages, diff, and local repository context to choose a classification.

## Read-Only Rules

- Never edit, create, delete, move, format, stage, commit, reset, clean, checkout, merge, rebase, install dependencies, or otherwise mutate files or git state.
- Read-only commands are allowed: `git show`, `git diff`, `git log`, `git status --short`, `rg`, `sed`, `ls`, and file reads.
- If more context is needed, inspect the local repo read-only. If the diff and metadata are enough, answer directly.

## Output

Return only a JSON object with this exact shape:

```json
{
  "type": "feature",
  "difficulty": "medium",
  "impact_score": 5,
  "reasoning": "Brief reason"
}
```

Allowed `type` values:

- `feature`: new functionality or capability
- `bugfix`: correction of incorrect behavior
- `refactor`: restructuring without intended behavior change
- `chore`: maintenance, tooling, configuration, dependency updates
- `test`: adding or changing tests as the primary work
- `docs`: documentation-only or documentation-primary work

Allowed `difficulty` values:

- `trivial`: one-line changes, typo fixes, simple renames
- `easy`: small, well-scoped changes requiring minimal context
- `medium`: moderate changes touching multiple files or requiring local design judgment
- `hard`: significant work requiring deep system understanding
- `complex`: large cross-cutting work with architectural implications

Set `impact_score` from 0 to 10, where 0 means no meaningful product or codebase impact and 10 means transformative impact.

Keep `reasoning` concise and specific to the work unit.
```

- [ ] **Step 4: Add skill bundle implementation**

Create `apps/server/src/classifier/local/skills.ts`:

```ts
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export interface SkillEntry {
  name: string
  sourceDir: string
  files: { relativePath: string; content: string }[]
}

export interface SkillBundle {
  hash: string
  skills: SkillEntry[]
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function walkFiles(dir: string, base = dir): { relativePath: string; content: string }[] {
  const out: { relativePath: string; content: string }[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      out.push(...walkFiles(path, base))
      continue
    }
    if (stat.isFile()) {
      const relativePath = path.slice(base.length + 1)
      out.push({ relativePath, content: readFileSync(path, 'utf8') })
    }
  }
  return out
}

async function readSkill(dir: string): Promise<SkillEntry> {
  const sourceDir = resolve(dir)
  const skillMd = join(sourceDir, 'SKILL.md')
  if (!existsSync(skillMd)) {
    throw new Error(`Skill directory missing SKILL.md: ${sourceDir}`)
  }
  return {
    name: basename(sourceDir),
    sourceDir,
    files: walkFiles(sourceDir),
  }
}

export async function resolveSkillBundle(
  classifierSkillPath: string,
  extraSkillPaths: string[],
): Promise<SkillBundle> {
  const skills = await Promise.all(
    [classifierSkillPath, ...extraSkillPaths].map((path) => readSkill(path)),
  )
  const hashInput = JSON.stringify(
    skills.map((skill) => ({
      name: skill.name,
      files: skill.files,
    })),
  )
  return { hash: hashText(hashInput), skills }
}

function copySkill(skill: SkillEntry, targetDir: string): void {
  for (const file of skill.files) {
    const target = join(targetDir, skill.name, file.relativePath)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(skill.sourceDir, file.relativePath), target)
  }
}

export async function materializeClaudeSkillBundle(
  bundle: SkillBundle,
  rootDir: string,
): Promise<string> {
  const bundleDir = join(resolve(rootDir), bundle.hash)
  const skillsDir = join(bundleDir, '.claude', 'skills')
  mkdirSync(skillsDir, { recursive: true })
  for (const skill of bundle.skills) copySkill(skill, skillsDir)
  return bundleDir
}

export async function materializeCodexSkillsHome(
  bundle: SkillBundle,
  homeDir: string,
): Promise<string> {
  const resolvedHome = resolve(homeDir)
  const skillsDir = join(resolvedHome, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  for (const skill of bundle.skills) copySkill(skill, skillsDir)
  return resolvedHome
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test apps/server/src/classifier/local/skills.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/server/skills/auctor-classifier/SKILL.md apps/server/src/classifier/local/skills.ts apps/server/src/classifier/local/skills.test.ts
git commit -m "feat(classifier): add classifier skill bundle"
```

---

### Task 4: Executor Parsers And Command Builders

**Files:**
- Create: `apps/server/src/classifier/local/claude.ts`
- Create: `apps/server/src/classifier/local/claude.test.ts`
- Create: `apps/server/src/classifier/local/codex.ts`
- Create: `apps/server/src/classifier/local/codex.test.ts`

- [ ] **Step 1: Write Claude parser and args tests**

Create `apps/server/src/classifier/local/claude.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildClaudeArgs, parseClaudeStreamJson } from './claude'

describe('Claude local executor helpers', () => {
  test('builds claude print args with skill bundle', () => {
    const args = buildClaudeArgs({
      model: 'claude-sonnet-4-5-20250929',
      effort: 'medium',
      maxTurns: 2,
      skipPermissions: true,
      skillBundleDir: '/tmp/skills',
    })

    expect(args).toContain('--print')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).toContain('--add-dir')
    expect(args).toContain('/tmp/skills')
  })

  test('parses final result text and session id', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      JSON.stringify({ type: 'result', result: '{"type":"docs"}' }),
    ].join('\n')

    const parsed = parseClaudeStreamJson(stdout)

    expect(parsed.sessionId).toBe('s1')
    expect(parsed.finalText).toBe('{"type":"docs"}')
  })
})
```

- [ ] **Step 2: Write Codex parser and args tests**

Create `apps/server/src/classifier/local/codex.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildCodexArgs, parseCodexJsonl } from './codex'

describe('Codex local executor helpers', () => {
  test('builds codex exec args', () => {
    const args = buildCodexArgs({
      model: 'gpt-5.4',
      effort: 'medium',
      bypassApprovals: true,
    })

    expect(args).toContain('exec')
    expect(args).toContain('--json')
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args).toContain('--model')
    expect(args).toContain('gpt-5.4')
    expect(args.at(-1)).toBe('-')
  })

  test('parses final agent message and thread id', () => {
    const stdout = [
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"type":"feature"}' },
      }),
    ].join('\n')

    const parsed = parseCodexJsonl(stdout)

    expect(parsed.threadId).toBe('t1')
    expect(parsed.finalText).toBe('{"type":"feature"}')
  })
})
```

- [ ] **Step 3: Run tests and confirm red**

Run:

```bash
bun test apps/server/src/classifier/local/claude.test.ts apps/server/src/classifier/local/codex.test.ts
```

Expected: FAIL because implementation files do not exist.

- [ ] **Step 4: Add Claude helper**

Create `apps/server/src/classifier/local/claude.ts`:

```ts
export interface ClaudeArgsInput {
  model?: string
  effort?: string
  maxTurns?: number
  skipPermissions?: boolean
  skillBundleDir: string
}

export interface ParsedClaudeOutput {
  sessionId: string | null
  finalText: string
}

function parseJson(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const args = ['--print', '-', '--output-format', 'stream-json', '--verbose']
  if (input.maxTurns && input.maxTurns > 0) {
    args.push('--max-turns', String(input.maxTurns))
  }
  if (input.skipPermissions !== false) {
    args.push('--dangerously-skip-permissions')
  }
  args.push('--add-dir', input.skillBundleDir)
  if (input.model) args.push('--model', input.model)
  if (input.effort) args.push('--effort', input.effort)
  return args
}

export function parseClaudeStreamJson(stdout: string): ParsedClaudeOutput {
  let sessionId: string | null = null
  let finalText = ''

  for (const rawLine of stdout.split(/\r?\n/)) {
    const event = parseJson(rawLine.trim())
    if (!event) continue
    if (event.type === 'system' && event.subtype === 'init') {
      sessionId = typeof event.session_id === 'string' ? event.session_id : sessionId
    }
    if (event.type === 'result' && typeof event.result === 'string') {
      finalText = event.result
      sessionId = typeof event.session_id === 'string' ? event.session_id : sessionId
    }
  }

  return { sessionId, finalText: finalText.trim() }
}
```

- [ ] **Step 5: Add Codex helper**

Create `apps/server/src/classifier/local/codex.ts`:

```ts
export interface CodexArgsInput {
  model?: string
  effort?: string
  bypassApprovals?: boolean
}

export interface ParsedCodexOutput {
  threadId: string | null
  finalText: string
}

function parseJson(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function buildCodexArgs(input: CodexArgsInput): string[] {
  const args = ['exec', '--json']
  if (input.bypassApprovals !== false) {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  }
  if (input.model) args.push('--model', input.model)
  if (input.effort) {
    args.push('-c', `model_reasoning_effort=${JSON.stringify(input.effort)}`)
  }
  args.push('-')
  return args
}

export function parseCodexJsonl(stdout: string): ParsedCodexOutput {
  let threadId: string | null = null
  let finalText = ''

  for (const rawLine of stdout.split(/\r?\n/)) {
    const event = parseJson(rawLine.trim())
    if (!event) continue
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id
    }
    if (event.type === 'item.completed') {
      const item = asObject(event.item)
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        finalText = item.text
      }
    }
  }

  return { threadId, finalText: finalText.trim() }
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test apps/server/src/classifier/local/claude.test.ts apps/server/src/classifier/local/codex.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/server/src/classifier/local/claude.ts apps/server/src/classifier/local/claude.test.ts apps/server/src/classifier/local/codex.ts apps/server/src/classifier/local/codex.test.ts
git commit -m "feat(classifier): add local executor parsers"
```

---

### Task 5: JSON Extraction And Cache Keys

**Files:**
- Create: `apps/server/src/classifier/local/json.ts`
- Create: `apps/server/src/classifier/local/json.test.ts`
- Modify: `apps/server/src/classifier/cache.ts`
- Modify: `apps/server/src/classifier/cache.test.ts`

- [ ] **Step 1: Write JSON parser tests**

Create `apps/server/src/classifier/local/json.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { parseClassificationJson } from './json'

const valid = {
  type: 'feature',
  difficulty: 'medium',
  impact_score: 6,
  reasoning: 'Adds local classifier orchestration',
}

describe('parseClassificationJson', () => {
  test('parses raw JSON', () => {
    expect(parseClassificationJson(JSON.stringify(valid))).toEqual(valid)
  })

  test('parses fenced JSON', () => {
    const text = `Here is the result:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``
    expect(parseClassificationJson(text)).toEqual(valid)
  })

  test('parses embedded balanced object', () => {
    const text = `Result: ${JSON.stringify(valid)} done`
    expect(parseClassificationJson(text)).toEqual(valid)
  })

  test('throws for schema failure', () => {
    expect(() => parseClassificationJson('{"type":"other"}')).toThrow(
      'Classification validation failed',
    )
  })
})
```

- [ ] **Step 2: Update cache tests for content keys**

Replace `apps/server/src/classifier/cache.test.ts` with:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { unlinkSync } from 'node:fs'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import {
  ClassificationCache,
  buildClassificationCacheKey,
} from './cache'

const DB_PATH = '/tmp/auctor-cache-test.sqlite'

function cleanup() {
  try {
    unlinkSync(DB_PATH)
  } catch {
    // file may not exist
  }
}

function makeUnit(diff = '+line'): WorkUnit {
  return {
    id: 'wu-1',
    kind: 'branch-day',
    author: 'alice',
    branch: 'main',
    date: '2026-04-18',
    commit_shas: ['abc'],
    commit_messages: ['feat: test'],
    diff,
    insertions: 1,
    deletions: 0,
    net: 1,
  }
}

describe('ClassificationCache', () => {
  let cache: ClassificationCache

  afterEach(() => {
    cache?.close()
    cleanup()
  })

  const sampleClassification: Classification = {
    type: 'feature',
    difficulty: 'medium',
    impact_score: 7,
    reasoning: 'Adds new user authentication flow',
  }

  test('buildClassificationCacheKey changes when diff changes', () => {
    const a = buildClassificationCacheKey({
      unit: makeUnit('+one'),
      backend: 'local-agent',
      executor: 'claude',
      model: 'sonnet',
      effort: 'medium',
      promptVersion: 1,
      skillBundleHash: 'hash',
    })
    const b = buildClassificationCacheKey({
      unit: makeUnit('+two'),
      backend: 'local-agent',
      executor: 'claude',
      model: 'sonnet',
      effort: 'medium',
      promptVersion: 1,
      skillBundleHash: 'hash',
    })

    expect(a).not.toBe(b)
  })

  test('set then get returns classification for cache key', () => {
    cache = new ClassificationCache(DB_PATH)
    const key = buildClassificationCacheKey({
      unit: makeUnit(),
      backend: 'local-agent',
      executor: 'claude',
      model: 'sonnet',
      effort: 'medium',
      promptVersion: 1,
      skillBundleHash: 'hash',
    })

    cache.setByKey(key, 'wu-1', 'local-agent', 'claude', sampleClassification)
    const result = cache.getByKey(key)

    expect(result).toEqual(sampleClassification)
  })
})
```

- [ ] **Step 3: Run tests and confirm red**

Run:

```bash
bun test apps/server/src/classifier/local/json.test.ts apps/server/src/classifier/cache.test.ts
```

Expected: FAIL because `json.ts`, `setByKey`, `getByKey`, and cache key helpers do not exist.

- [ ] **Step 4: Add JSON parser**

Create `apps/server/src/classifier/local/json.ts`:

```ts
import {
  type Classification,
  ClassificationSchema,
} from '@auctor/shared/classification'

function tryParse(text: string): unknown {
  return JSON.parse(text)
}

function fencedJson(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return match?.[1]?.trim() ?? null
}

function embeddedObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') depth += 1
    if (ch === '}') depth -= 1
    if (depth === 0) return text.slice(start, i + 1)
  }
  return null
}

export function parseClassificationJson(text: string): Classification {
  const candidates = [
    text.trim(),
    fencedJson(text),
    embeddedObject(text),
  ].filter((candidate): candidate is string => Boolean(candidate))

  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      const parsedJson = tryParse(candidate)
      const parsed = ClassificationSchema.safeParse(parsedJson)
      if (parsed.success) return parsed.data
      lastError = parsed.error
    } catch (err) {
      lastError = err
    }
  }

  throw new Error(
    `Classification validation failed: ${
      lastError instanceof Error ? lastError.message : 'invalid JSON'
    }`,
  )
}
```

- [ ] **Step 5: Update cache implementation**

Replace `apps/server/src/classifier/cache.ts` with:

```ts
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  type Classification,
  ClassificationSchema,
  type WorkUnit,
} from '@auctor/shared/classification'

export interface ClassificationCacheKeyInput {
  unit: WorkUnit
  backend: string
  executor?: string | null
  model?: string | null
  effort?: string | null
  promptVersion: number
  skillBundleHash?: string | null
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function buildClassificationCacheKey(
  input: ClassificationCacheKeyInput,
): string {
  return sha256(
    JSON.stringify({
      unitId: input.unit.id,
      commitShas: input.unit.commit_shas,
      diffHash: sha256(input.unit.diff),
      backend: input.backend,
      executor: input.executor ?? null,
      model: input.model ?? null,
      effort: input.effort ?? null,
      promptVersion: input.promptVersion,
      skillBundleHash: input.skillBundleHash ?? null,
    }),
  )
}

export class ClassificationCache {
  private db: Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS classifications (
        cache_key TEXT PRIMARY KEY,
        work_unit_id TEXT NOT NULL,
        backend TEXT NOT NULL DEFAULT 'legacy',
        executor TEXT,
        classification_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `)
  }

  getByKey(cacheKey: string): Classification | null {
    const row = this.db
      .prepare(
        'SELECT classification_json FROM classifications WHERE cache_key = ?',
      )
      .get(cacheKey) as { classification_json: string } | undefined

    if (!row) return null
    const parsed = ClassificationSchema.safeParse(
      JSON.parse(row.classification_json),
    )
    return parsed.success ? parsed.data : null
  }

  setByKey(
    cacheKey: string,
    workUnitId: string,
    backend: string,
    executor: string | null,
    classification: Classification,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO classifications
        (cache_key, work_unit_id, backend, executor, classification_json)
        VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        cacheKey,
        workUnitId,
        backend,
        executor,
        JSON.stringify(classification),
      )
  }

  get(workUnitId: string): Classification | null {
    return this.getByKey(workUnitId)
  }

  set(workUnitId: string, classification: Classification): void {
    this.setByKey(workUnitId, workUnitId, 'legacy', null, classification)
  }

  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test apps/server/src/classifier/local/json.test.ts apps/server/src/classifier/cache.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/server/src/classifier/local/json.ts apps/server/src/classifier/local/json.test.ts apps/server/src/classifier/cache.ts apps/server/src/classifier/cache.test.ts
git commit -m "feat(classifier): add strict JSON parsing and cache keys"
```

---

### Task 6: Local Orchestrator With Strict Failures

**Files:**
- Create: `apps/server/src/classifier/local/orchestrator.ts`
- Create: `apps/server/src/classifier/local/orchestrator.test.ts`

- [ ] **Step 1: Write orchestrator tests**

Create `apps/server/src/classifier/local/orchestrator.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import { classifyWithLocalExecutors } from './orchestrator'

function unit(id: string): WorkUnit {
  return {
    id,
    kind: 'branch-day',
    author: 'alice',
    branch: 'main',
    date: '2026-04-18',
    commit_shas: [id],
    commit_messages: [`feat: ${id}`],
    diff: '+line',
    insertions: 1,
    deletions: 0,
    net: 1,
  }
}

const classification: Classification = {
  type: 'feature',
  difficulty: 'medium',
  impact_score: 5,
  reasoning: 'test',
}

describe('classifyWithLocalExecutors', () => {
  test('never exceeds maxParallel', async () => {
    let active = 0
    let maxSeen = 0
    const out = await classifyWithLocalExecutors({
      repoPath: '/tmp/repo',
      workUnits: [unit('a'), unit('b'), unit('c'), unit('d')],
      maxParallel: 2,
      executors: [
        {
          type: 'claude',
          classify: async () => {
            active += 1
            maxSeen = Math.max(maxSeen, active)
            await new Promise((resolve) => setTimeout(resolve, 10))
            active -= 1
            return classification
          },
        },
      ],
    })

    expect(maxSeen).toBeLessThanOrEqual(2)
    expect(out.size).toBe(4)
  })

  test('round-robins executors', async () => {
    const seen: string[] = []
    await classifyWithLocalExecutors({
      repoPath: '/tmp/repo',
      workUnits: [unit('a'), unit('b'), unit('c')],
      maxParallel: 1,
      executors: [
        {
          type: 'claude',
          classify: async () => {
            seen.push('claude')
            return classification
          },
        },
        {
          type: 'codex',
          classify: async () => {
            seen.push('codex')
            return classification
          },
        },
      ],
    })

    expect(seen).toEqual(['claude', 'codex', 'claude'])
  })

  test('throws on first executor failure', async () => {
    await expect(
      classifyWithLocalExecutors({
        repoPath: '/tmp/repo',
        workUnits: [unit('a')],
        maxParallel: 1,
        executors: [
          {
            type: 'claude',
            classify: async () => {
              throw new Error('boom')
            },
          },
        ],
      }),
    ).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
bun test apps/server/src/classifier/local/orchestrator.test.ts
```

Expected: FAIL because `orchestrator.ts` does not exist.

- [ ] **Step 3: Add orchestrator implementation**

Create `apps/server/src/classifier/local/orchestrator.ts`:

```ts
import type { Classification, WorkUnit } from '@auctor/shared/classification'

export interface LocalExecutorRuntime {
  type: 'claude' | 'codex'
  classify(input: {
    repoPath: string
    unit: WorkUnit
  }): Promise<Classification>
}

export async function classifyWithLocalExecutors(input: {
  repoPath: string
  workUnits: WorkUnit[]
  maxParallel: number
  executors: LocalExecutorRuntime[]
}): Promise<Map<string, Classification>> {
  if (input.executors.length === 0) {
    throw new Error('No local classifier executors configured')
  }

  const results = new Map<string, Classification>()
  let nextIndex = 0
  let executorIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < input.workUnits.length) {
      const unitIndex = nextIndex
      nextIndex += 1
      const unit = input.workUnits[unitIndex]
      if (!unit) continue
      const executor = input.executors[executorIndex % input.executors.length]
      executorIndex += 1
      if (!executor) throw new Error('No local classifier executor available')
      const classification = await executor.classify({
        repoPath: input.repoPath,
        unit,
      })
      results.set(unit.id, classification)
    }
  }

  const workerCount = Math.min(
    Math.max(1, input.maxParallel),
    input.workUnits.length,
  )
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test apps/server/src/classifier/local/orchestrator.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/server/src/classifier/local/orchestrator.ts apps/server/src/classifier/local/orchestrator.test.ts
git commit -m "feat(classifier): add local executor orchestrator"
```

---

### Task 7: Prompt Builders And Bedrock Backend Wrapper

**Files:**
- Modify: `apps/server/src/classifier/prompt.ts`
- Modify: `apps/server/src/classifier/prompt.test.ts`
- Modify: `apps/server/src/classifier/agent.ts`
- Modify: `apps/server/src/classifier/agent.test.ts`

- [ ] **Step 1: Add local prompt test**

Append this test to `apps/server/src/classifier/prompt.test.ts`:

```ts
test('builds local agent prompt that invokes the classifier skill', () => {
  const prompt = buildLocalAgentClassificationPrompt(sampleUnit)

  expect(prompt).toContain('Use the auctor-classifier skill')
  expect(prompt).toContain('wu-123')
  expect(prompt).toContain('abc123')
  expect(prompt).toContain('```diff')
})
```

Also update the import:

```ts
import {
  buildClassificationPrompt,
  buildLocalAgentClassificationPrompt,
} from './prompt'
```

- [ ] **Step 2: Run prompt tests and confirm red**

Run:

```bash
bun test apps/server/src/classifier/prompt.test.ts
```

Expected: FAIL because `buildLocalAgentClassificationPrompt` is missing.

- [ ] **Step 3: Add local prompt builder**

Append this function to `apps/server/src/classifier/prompt.ts`:

```ts
export const LOCAL_CLASSIFIER_PROMPT_VERSION = 1

export function buildLocalAgentClassificationPrompt(unit: WorkUnit): string {
  return `Use the auctor-classifier skill to classify this Auctor work unit.
The current working directory is the local repo being analyzed.
Return only valid classification JSON.

${buildClassificationPrompt(unit)}`
}
```

- [ ] **Step 4: Wrap Bedrock backend**

In `apps/server/src/classifier/agent.ts`, keep `classifyWorkUnit` as the Bedrock implementation and add:

```ts
import type { ClassifierBackend } from './backend'

export class BedrockClassifierBackend implements ClassifierBackend {
  async classifyMany(input: {
    repoPath: string
    workUnits: WorkUnit[]
  }): Promise<Map<string, Classification>> {
    const out = new Map<string, Classification>()
    for (const unit of input.workUnits) {
      out.set(unit.id, await classifyWorkUnit(unit, input.repoPath))
    }
    return out
  }
}
```

Place the import near the existing imports. Do not remove `classifyWorkUnit`; route code and tests can still use it during transition.

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test apps/server/src/classifier/prompt.test.ts apps/server/src/classifier/agent.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/server/src/classifier/prompt.ts apps/server/src/classifier/prompt.test.ts apps/server/src/classifier/agent.ts apps/server/src/classifier/agent.test.ts
git commit -m "feat(classifier): add local prompt and bedrock backend"
```

---

### Task 8: Local Process Executors

**Files:**
- Modify: `apps/server/src/classifier/local/claude.ts`
- Modify: `apps/server/src/classifier/local/codex.ts`
- Create: `apps/server/src/classifier/local/executor.ts`

- [ ] **Step 1: Add shared process runner and executor factories**

Create `apps/server/src/classifier/local/executor.ts`:

```ts
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import type { LocalExecutorConfig } from '../config'
import { buildLocalAgentClassificationPrompt } from '../prompt'
import { buildClaudeArgs, parseClaudeStreamJson } from './claude'
import { buildCodexArgs, parseCodexJsonl } from './codex'
import { parseClassificationJson } from './json'

interface RunProcessInput {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  stdin: string
  timeoutMs: number
}

async function runProcess(input: RunProcessInput): Promise<{
  stdout: string
  stderr: string
  exitCode: number
}> {
  const proc = Bun.spawn([input.command, ...input.args], {
    cwd: input.cwd,
    env: { ...process.env, ...input.env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  proc.stdin.write(input.stdin)
  proc.stdin.end()

  const timeout = setTimeout(() => proc.kill(), input.timeoutMs)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timeout)

  if (exitCode !== 0) {
    const firstStderr = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    throw new Error(
      `${input.command} exited with code ${exitCode}${firstStderr ? `: ${firstStderr}` : ''}`,
    )
  }

  return { stdout, stderr, exitCode }
}

export function createLocalExecutor(input: {
  config: LocalExecutorConfig
  timeoutMs: number
  claudeSkillBundleDir: string
  codexHomeDir: string
}): {
  type: 'claude' | 'codex'
  classify(input: { repoPath: string; unit: WorkUnit }): Promise<Classification>
} {
  if (input.config.type === 'claude') {
    return {
      type: 'claude',
      classify: async ({ repoPath, unit }) => {
        const prompt = buildLocalAgentClassificationPrompt(unit)
        const args = buildClaudeArgs({
          model: input.config.model,
          effort: input.config.effort,
          maxTurns: input.config.maxTurns,
          skipPermissions: input.config.skipPermissions,
          skillBundleDir: input.claudeSkillBundleDir,
        })
        const proc = await runProcess({
          command: input.config.command,
          args,
          cwd: repoPath,
          stdin: prompt,
          timeoutMs: input.timeoutMs,
        })
        return parseClassificationJson(parseClaudeStreamJson(proc.stdout).finalText)
      },
    }
  }

  return {
    type: 'codex',
    classify: async ({ repoPath, unit }) => {
      const prompt = buildLocalAgentClassificationPrompt(unit)
      const args = buildCodexArgs({
        model: input.config.model,
        effort: input.config.effort,
        bypassApprovals: input.config.bypassApprovals,
      })
      const proc = await runProcess({
        command: input.config.command,
        args,
        cwd: repoPath,
        env: { CODEX_HOME: input.codexHomeDir },
        stdin: prompt,
        timeoutMs: input.timeoutMs,
      })
      return parseClassificationJson(parseCodexJsonl(proc.stdout).finalText)
    },
  }
}
```

- [ ] **Step 2: Run typecheck to catch executor integration mistakes**

Run:

```bash
bun run --filter '@auctor/server' typecheck
```

Expected: PASS. If it fails on Bun stream types, replace the `new Response(proc.stdout).text()` reads with the repo's preferred Bun stream read pattern and rerun.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/classifier/local/executor.ts apps/server/src/classifier/local/claude.ts apps/server/src/classifier/local/codex.ts
git commit -m "feat(classifier): add local process executors"
```

---

### Task 9: Route Wiring With Strict Repo Path Validation

**Files:**
- Modify: `apps/server/src/routes/classify.ts`
- Modify: `apps/server/src/routes/classify.test.ts`

- [ ] **Step 1: Update route tests for repo_path**

Replace `apps/server/src/routes/classify.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { classifyRoute } from './classify'

const app = new Hono()
app.route('/api', classifyRoute)

function postClassify(body: unknown) {
  return app.request('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/classify', () => {
  test('returns 400 when repo_path is missing', async () => {
    const res = await postClassify({ work_units: [] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('repo_path')
  })

  test('returns 400 when work_units is missing', async () => {
    const res = await postClassify({ repo_path: '/tmp/repo' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('work_units')
  })

  test('returns 400 when repo_path is not a git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auctor-not-git-'))
    try {
      const res = await postClassify({ repo_path: dir, work_units: [] })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('git repo')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
bun test apps/server/src/routes/classify.test.ts
```

Expected: FAIL because the route still expects `repo_url`.

- [ ] **Step 3: Update route implementation**

In `apps/server/src/routes/classify.ts`:

- Remove `RepoManager` usage for local-agent requests.
- Validate `body.repo_path`.
- Add helper:

```ts
async function validateRepoPath(repoPath: string): Promise<string> {
  const proc = Bun.spawn(['git', '-C', repoPath, 'rev-parse', '--show-toplevel'])
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  if (proc.exitCode !== 0) {
    throw new Error(`repo_path is not a git repo: ${repoPath}`)
  }
  return stdout.trim() || repoPath
}
```

- Build the backend from `loadClassifierConfig()`.
- Keep the existing empty `work_units` response after repo validation if you want invalid repo paths caught even for empty requests.
- For local-agent errors, return `c.json({ error: message }, 500)` and let CLI exit nonzero.

Use this route flow:

```ts
if (!body.repo_path || typeof body.repo_path !== 'string') {
  return c.json({ error: 'repo_path is required' }, 400)
}
if (!Array.isArray(body.work_units)) {
  return c.json({ error: 'work_units is required' }, 400)
}

let repoPath: string
try {
  repoPath = await validateRepoPath(body.repo_path)
} catch (err) {
  return c.json(
    { error: err instanceof Error ? err.message : 'repo_path is invalid' },
    400,
  )
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test apps/server/src/routes/classify.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/server/src/routes/classify.ts apps/server/src/routes/classify.test.ts
git commit -m "feat(classifier): require local repo path"
```

---

### Task 10: CLI Analyze Classification Wiring

**Files:**
- Modify: `apps/cli/src/commands/analyze.ts`
- Modify: `apps/cli/src/commands/analyze.test.ts`

- [ ] **Step 1: Add helper tests for classification map application**

Append to `apps/cli/src/commands/analyze.test.ts`:

```ts
import type { ClassifiedWorkUnit } from '@auctor/shared/api-types'
import type { Classification } from '@auctor/shared/classification'
import { buildClassificationMap } from './analyze'

describe('buildClassificationMap', () => {
  test('uses returned classifier results by work unit id', () => {
    const classification: Classification = {
      type: 'bugfix',
      difficulty: 'hard',
      impact_score: 8,
      reasoning: 'Fixes branch-aware analysis',
    }
    const returned: ClassifiedWorkUnit[] = [
      { id: 'unit-1', classification },
    ]

    const map = buildClassificationMap(returned)

    expect(map.get('unit-1')).toEqual(classification)
  })
})
```

Update existing imports so there is one import from `./analyze`:

```ts
import { buildClassificationMap, buildConsideredItemsForUnit } from './analyze'
```

- [ ] **Step 2: Run test and confirm red**

Run:

```bash
bun test apps/cli/src/commands/analyze.test.ts
```

Expected: FAIL because `buildClassificationMap` does not exist.

- [ ] **Step 3: Add helper and classify call**

In `apps/cli/src/commands/analyze.ts`, import API types and client:

```ts
import type { ClassifiedWorkUnit } from '@auctor/shared/api-types'
import { classifyWorkUnits } from '../api-client'
```

Add exported helper near the bottom:

```ts
export function buildClassificationMap(
  classifications: ClassifiedWorkUnit[],
): Map<string, Classification> {
  return new Map(
    classifications.map((item) => [item.id, item.classification]),
  )
}
```

Replace the current default-only classification block:

```ts
  const classificationMap = new Map<string, Classification>()
  for (const unit of hydratedUnits) {
    classificationMap.set(unit.id, {
      type: 'feature',
      difficulty: 'medium',
      impact_score: 5,
      reasoning: 'default classification',
    })
  }
```

with:

```ts
  let classificationMap = new Map<string, Classification>()
  if (bundle.server_url) {
    const response = await classifyWorkUnits(
      bundle.server_url,
      repo.path,
      hydratedUnits,
    )
    classificationMap = buildClassificationMap(response.classifications)
  } else {
    for (const unit of hydratedUnits) {
      classificationMap.set(unit.id, {
        type: 'feature',
        difficulty: 'medium',
        impact_score: 5,
        reasoning: 'default classification',
      })
    }
  }
```

Keep the existing `if (!classification) continue` for now. Once route tests prove strict behavior, missing classifications should be converted to an explicit throw:

```ts
    if (!classification) {
      throw new Error(`Missing classification for work unit ${unit.id}`)
    }
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test apps/cli/src/commands/analyze.test.ts apps/cli/src/api-client.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/cli/src/commands/analyze.ts apps/cli/src/commands/analyze.test.ts
git commit -m "feat(cli): use classifier results during analyze"
```

---

### Task 11: Full Verification And Local Smoke

**Files:**
- No new files expected.
- Fix any type/test failures in the files touched by previous tasks.

- [ ] **Step 1: Run server classifier tests**

Run:

```bash
bun test apps/server/src/classifier
```

Expected: PASS.

- [ ] **Step 2: Run route and CLI tests**

Run:

```bash
bun test apps/server/src/routes/classify.test.ts apps/cli/src/api-client.test.ts apps/cli/src/commands/analyze.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run package tests**

Run:

```bash
bun test apps/server/src apps/cli/src packages/shared/src
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run lint**

Run:

```bash
bun run lint
```

Expected: PASS or only pre-existing warnings unrelated to local classifier changes. If new warnings appear in files touched by this plan, fix them.

- [ ] **Step 6: Manual local classifier smoke**

Start server:

```bash
CLASSIFIER_BACKEND=local-agent \
LOCAL_CLASSIFIER_EXECUTORS=claude,codex \
LOCAL_CLASSIFIER_MAX_PARALLEL=10 \
bun run --cwd apps/server dev
```

Run analyze in another shell:

```bash
bun apps/cli/src/index.ts analyze configs/browseros/browseros_config.yaml -3d --json /tmp/auctor-local-classifier.json
```

Expected:

- Server logs show local executor classifications.
- No more than 10 executor processes are active at once.
- CLI writes `/tmp/auctor-local-classifier.json`.
- Scores are based on non-default classification reasoning.
- `git status --short` in analyzed repos is unchanged before and after the run.

- [ ] **Step 7: Final commit**

If verification required fixes, commit them:

```bash
git add apps/server apps/cli packages/shared
git commit -m "fix(classifier): stabilize local classifier integration"
```

Skip this commit only if no files changed after the prior task commits.

---

## Self-Review

- Spec coverage: The plan covers `repo_path`-only payloads, strict repo validation, skill-based classification, Claude `--add-dir`, Codex `CODEX_HOME`, bounded parallelism, strict local-agent failures, cache invalidation by skill hash, CLI scoring integration, and verification.
- Placeholder scan: No placeholder markers are intentional in this plan.
- Type consistency: The plan consistently uses `repo_path` in API payloads, `repoPath` in TypeScript functions, `Classification` from `@auctor/shared/classification`, and `ClassifiedWorkUnit` from `@auctor/shared/api-types`.
