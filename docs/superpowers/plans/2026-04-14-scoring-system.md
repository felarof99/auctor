# Scoring System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the auctor scoring system with work unit extraction, AI-powered classification via Claude Agent SDK, and the blended scoring formula.

**Architecture:** CLI extracts work units from git history, sends them to a server for AI classification, receives classifications back, computes scores locally using a blended formula (50% deterministic + 50% AI impact), and renders a ranked leaderboard. Server runs on Fly.io with Claude Agent SDK for classification.

**Tech Stack:** Bun, TypeScript, Zod, Hono (server), Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), SQLite (classification cache)

---

## File Structure

### New files

```
packages/
  shared/
    package.json
    tsconfig.json
    src/
      classification.ts       # Zod schemas: Classification, WorkUnit types
      scoring-weights.ts       # Type/difficulty weight constants
      api-types.ts             # Request/response types for /api/classify

apps/
  cli/
    src/
      git/
        work-units.ts          # Extract PR units + branch-day units
        work-units.test.ts
        diff.ts                # Get full diff for a set of commits
        diff.test.ts
      api-client.ts            # POST to server /api/classify
      api-client.test.ts

  server/
    package.json
    tsconfig.json
    Dockerfile
    fly.toml
    src/
      index.ts                 # Hono app, starts server
      routes/
        classify.ts            # POST /api/classify handler
        classify.test.ts
      classifier/
        agent.ts               # Claude Agent SDK query() wrapper
        agent.test.ts
        prompt.ts              # Build classification prompt from work unit
        prompt.test.ts
        cache.ts               # SQLite classification cache
        cache.test.ts
      repo/
        manager.ts             # Clone/pull repos by URL
        manager.test.ts
```

### Modified files

```
apps/cli/src/types.ts          # Add WorkUnit, update AuthorStats
apps/cli/src/scoring.ts        # Replace placeholder with spec formula
apps/cli/src/scoring.test.ts   # Update tests for new formula
apps/cli/src/commands/analyze.ts  # Wire work unit extraction + server call
apps/cli/src/output.ts         # Add JSON output to .auctor/results/
apps/cli/src/output.test.ts    # Update tests
apps/cli/package.json          # Add @auctor/shared dependency
```

---

### Task 1: Create shared types package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/classification.ts`
- Create: `packages/shared/src/scoring-weights.ts`
- Create: `packages/shared/src/api-types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@auctor/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./classification": {
      "types": "./src/classification.ts",
      "default": "./src/classification.ts"
    },
    "./scoring-weights": {
      "types": "./src/scoring-weights.ts",
      "default": "./src/scoring-weights.ts"
    },
    "./api-types": {
      "types": "./src/api-types.ts",
      "default": "./src/api-types.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create classification.ts with Zod schemas**

```typescript
import { z } from 'zod'

export const WorkUnitTypeEnum = z.enum(['pr', 'branch-day'])
export type WorkUnitType = z.infer<typeof WorkUnitTypeEnum>

export const ClassificationTypeEnum = z.enum([
  'feature',
  'bugfix',
  'refactor',
  'chore',
  'test',
  'docs',
])
export type ClassificationType = z.infer<typeof ClassificationTypeEnum>

export const DifficultyEnum = z.enum([
  'trivial',
  'easy',
  'medium',
  'hard',
  'complex',
])
export type Difficulty = z.infer<typeof DifficultyEnum>

export const ClassificationSchema = z.object({
  type: ClassificationTypeEnum,
  difficulty: DifficultyEnum,
  impact_score: z.number().min(0).max(10),
  reasoning: z.string(),
})
export type Classification = z.infer<typeof ClassificationSchema>

export interface WorkUnit {
  id: string
  kind: WorkUnitType
  author: string
  branch: string
  date: string
  commit_shas: string[]
  commit_messages: string[]
  diff: string
  insertions: number
  deletions: number
  net: number
}
```

- [ ] **Step 4: Create scoring-weights.ts**

```typescript
import type { ClassificationType, Difficulty } from './classification'

export const TYPE_WEIGHTS: Record<ClassificationType, number> = {
  feature: 1.0,
  bugfix: 0.8,
  refactor: 0.7,
  docs: 0.6,
  test: 0.5,
  chore: 0.3,
}

export const DIFFICULTY_WEIGHTS: Record<Difficulty, number> = {
  trivial: 0.2,
  easy: 0.5,
  medium: 1.0,
  hard: 1.5,
  complex: 2.0,
}

export const LOC_CAP = 10000
```

- [ ] **Step 5: Create api-types.ts**

```typescript
import type { Classification, WorkUnit } from './classification'

export interface ClassifyRequest {
  repo_url: string
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

- [ ] **Step 6: Install dependencies and verify**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun install`
Expected: Dependencies installed, no errors.

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/packages/shared && bun run typecheck`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared types package with classification schemas and scoring weights"
```

---

### Task 2: Work unit extraction from git history

**Files:**
- Create: `apps/cli/src/git/diff.ts`
- Create: `apps/cli/src/git/diff.test.ts`
- Create: `apps/cli/src/git/work-units.ts`
- Create: `apps/cli/src/git/work-units.test.ts`
- Modify: `apps/cli/package.json` (add @auctor/shared)

- [ ] **Step 1: Add @auctor/shared to CLI package.json**

Add to `dependencies`:
```json
"@auctor/shared": "workspace:*"
```

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun install`

- [ ] **Step 2: Write failing test for diff extraction**

Create `apps/cli/src/git/diff.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { getDiffForCommits } from './diff'

describe('getDiffForCommits', () => {
  test('returns diff output for given commit SHAs', async () => {
    // Use this repo's own commits for testing
    const repoPath = process.cwd()
    const proc = Bun.spawn(
      ['git', 'log', '--all', '--format=%H', '-1'],
      { cwd: repoPath, stdout: 'pipe' },
    )
    const sha = (await new Response(proc.stdout).text()).trim()
    await proc.exited

    if (!sha) {
      console.log('Skipping: no commits in repo')
      return
    }

    const diff = await getDiffForCommits(repoPath, [sha])
    expect(typeof diff).toBe('string')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/git/diff.test.ts`
Expected: FAIL — `getDiffForCommits` not found.

- [ ] **Step 4: Implement diff.ts**

Create `apps/cli/src/git/diff.ts`:

```typescript
export async function getDiffForCommits(
  repoPath: string,
  shas: string[],
): Promise<string> {
  if (shas.length === 0) return ''

  if (shas.length === 1) {
    const proc = Bun.spawn(
      ['git', 'diff', `${shas[0]}~1`, shas[0], '--', '.'],
      { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
    )
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      // First commit in repo — diff against empty tree
      const fallback = Bun.spawn(
        ['git', 'diff', '4b825dc642cb6eb9a060e54bf899d4e999b8f8', shas[0]],
        { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
      )
      const fallbackOutput = await new Response(fallback.stdout).text()
      await fallback.exited
      return fallbackOutput
    }
    return output
  }

  // Multiple commits: diff from earliest parent to latest
  const sortProc = Bun.spawn(
    ['git', 'log', '--format=%H', '--reverse', '--stdin'],
    {
      cwd: repoPath,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: new Blob([shas.join('\n')]),
    },
  )
  const sorted = (await new Response(sortProc.stdout).text()).trim().split('\n')
  await sortProc.exited

  const earliest = sorted[0] || shas[0]
  const latest = sorted[sorted.length - 1] || shas[shas.length - 1]

  const proc = Bun.spawn(
    ['git', 'diff', `${earliest}~1`, latest, '--', '.'],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(proc.stdout).text()
  await proc.exited
  return output
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/git/diff.test.ts`
Expected: PASS

- [ ] **Step 6: Write failing test for work unit extraction**

Create `apps/cli/src/git/work-units.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import type { Commit } from '../types'
import { extractBranchDayUnits, extractPrUnits } from './work-units'

const makeCommit = (overrides: Partial<Commit> = {}): Commit => ({
  sha: 'abc123',
  author: 'Alice',
  date: new Date('2026-04-10T10:00:00Z'),
  subject: 'feat: something',
  insertions: 100,
  deletions: 20,
  isMerge: false,
  ...overrides,
})

describe('extractBranchDayUnits', () => {
  test('groups commits by author and date', () => {
    const commits = [
      makeCommit({ sha: 'a1', author: 'Alice', date: new Date('2026-04-10T10:00:00Z') }),
      makeCommit({ sha: 'a2', author: 'Alice', date: new Date('2026-04-10T14:00:00Z') }),
      makeCommit({ sha: 'b1', author: 'Bob', date: new Date('2026-04-10T10:00:00Z') }),
    ]

    const units = extractBranchDayUnits(commits, 'main')
    expect(units).toHaveLength(2)

    const aliceUnit = units.find((u) => u.author === 'Alice')
    expect(aliceUnit).toBeDefined()
    expect(aliceUnit!.commit_shas).toEqual(['a1', 'a2'])
    expect(aliceUnit!.insertions).toBe(200)
    expect(aliceUnit!.deletions).toBe(40)
    expect(aliceUnit!.net).toBe(160)
  })

  test('splits different days into separate units', () => {
    const commits = [
      makeCommit({ sha: 'a1', date: new Date('2026-04-10T10:00:00Z') }),
      makeCommit({ sha: 'a2', date: new Date('2026-04-11T10:00:00Z') }),
    ]

    const units = extractBranchDayUnits(commits, 'main')
    expect(units).toHaveLength(2)
  })
})

describe('extractPrUnits', () => {
  test('creates a unit for merge commits grouped by author', () => {
    const commits = [
      makeCommit({ sha: 'm1', isMerge: true, subject: 'Merge PR #1' }),
      makeCommit({ sha: 'c1', isMerge: false }),
    ]

    const units = extractPrUnits(commits)
    expect(units).toHaveLength(1)
    expect(units[0].kind).toBe('pr')
    expect(units[0].commit_shas).toContain('m1')
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/git/work-units.test.ts`
Expected: FAIL — `extractBranchDayUnits` not found.

- [ ] **Step 8: Implement work-units.ts**

Create `apps/cli/src/git/work-units.ts`:

```typescript
import { createHash } from 'node:crypto'
import type { WorkUnit } from '@auctor/shared/classification'
import type { Commit } from '../types'

function dateKey(date: Date): string {
  return date.toISOString().split('T')[0]
}

function workUnitId(shas: string[]): string {
  const sorted = [...shas].sort()
  return createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 16)
}

export function extractBranchDayUnits(
  commits: Commit[],
  branch: string,
): Omit<WorkUnit, 'diff'>[] {
  const groups = new Map<string, Commit[]>()

  for (const commit of commits) {
    const key = `${commit.author}::${dateKey(commit.date)}`
    const existing = groups.get(key) ?? []
    existing.push(commit)
    groups.set(key, existing)
  }

  return [...groups.entries()].map(([, groupCommits]) => {
    const insertions = groupCommits.reduce((s, c) => s + c.insertions, 0)
    const deletions = groupCommits.reduce((s, c) => s + c.deletions, 0)
    const shas = groupCommits.map((c) => c.sha)

    return {
      id: workUnitId(shas),
      kind: 'branch-day' as const,
      author: groupCommits[0].author,
      branch,
      date: dateKey(groupCommits[0].date),
      commit_shas: shas,
      commit_messages: groupCommits.map((c) => c.subject),
      diff: '',
      insertions,
      deletions,
      net: insertions - deletions,
    }
  })
}

export function extractPrUnits(
  commits: Commit[],
): Omit<WorkUnit, 'diff'>[] {
  const mergeCommits = commits.filter((c) => c.isMerge)

  return mergeCommits.map((merge) => ({
    id: workUnitId([merge.sha]),
    kind: 'pr' as const,
    author: merge.author,
    branch: 'main',
    date: dateKey(merge.date),
    commit_shas: [merge.sha],
    commit_messages: [merge.subject],
    diff: '',
    insertions: merge.insertions,
    deletions: merge.deletions,
    net: merge.insertions - merge.deletions,
  }))
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/git/work-units.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/cli/src/git/diff.ts apps/cli/src/git/diff.test.ts apps/cli/src/git/work-units.ts apps/cli/src/git/work-units.test.ts apps/cli/package.json
git commit -m "feat: add work unit extraction (PR + branch-day) and diff retrieval"
```

---

### Task 3: Replace scoring formula with spec formula

**Files:**
- Modify: `apps/cli/src/scoring.ts`
- Modify: `apps/cli/src/scoring.test.ts`

- [ ] **Step 1: Write failing tests for the new scoring formula**

Replace `apps/cli/src/scoring.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { calculateLocFactor, calculateUnitScore, calculateAuthorScore } from './scoring'

describe('calculateLocFactor', () => {
  test('returns 0 for 0 net LOC', () => {
    expect(calculateLocFactor(0)).toBe(0)
  })

  test('returns ~0.50 for 100 net LOC', () => {
    const result = calculateLocFactor(100)
    expect(result).toBeGreaterThan(0.48)
    expect(result).toBeLessThan(0.52)
  })

  test('returns ~0.75 for 1000 net LOC', () => {
    const result = calculateLocFactor(1000)
    expect(result).toBeGreaterThan(0.73)
    expect(result).toBeLessThan(0.77)
  })

  test('caps at 1.0 for 10000+ net LOC', () => {
    expect(calculateLocFactor(10000)).toBeCloseTo(1.0, 1)
    expect(calculateLocFactor(50000)).toBe(1.0)
  })

  test('handles negative net LOC by using absolute value', () => {
    const result = calculateLocFactor(-100)
    expect(result).toBeGreaterThan(0.48)
  })
})

describe('calculateUnitScore', () => {
  test('worked example: hard feature, 400 LOC, impact 8', () => {
    const score = calculateUnitScore({
      net_loc: 400,
      difficulty: 'hard',
      type: 'feature',
      impact_score: 8,
    })
    // loc_factor = log2(401)/log2(10001) ≈ 0.65
    // formula_score = 0.65 * 1.5 = 0.975
    // normalized_ai = 0.8
    // unit_score = (0.5 * 0.975 + 0.5 * 0.8) * 1.0 ≈ 0.8875
    expect(score).toBeGreaterThan(0.85)
    expect(score).toBeLessThan(0.92)
  })

  test('chore with trivial difficulty scores low', () => {
    const score = calculateUnitScore({
      net_loc: 10,
      difficulty: 'trivial',
      type: 'chore',
      impact_score: 1,
    })
    expect(score).toBeLessThan(0.1)
  })

  test('complex feature with high impact scores high', () => {
    const score = calculateUnitScore({
      net_loc: 5000,
      difficulty: 'complex',
      type: 'feature',
      impact_score: 10,
    })
    expect(score).toBeGreaterThan(1.2)
  })
})

describe('calculateAuthorScore', () => {
  test('averages unit scores over days in window', () => {
    const unitScores = [0.5, 0.8, 1.2]
    const score = calculateAuthorScore(unitScores, 7)
    // sum = 2.5, days = 7, score = 2.5/7 ≈ 0.357
    expect(score).toBeCloseTo(2.5 / 7, 2)
  })

  test('returns 0 for empty unit scores', () => {
    expect(calculateAuthorScore([], 7)).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/scoring.test.ts`
Expected: FAIL — `calculateLocFactor`, `calculateUnitScore`, `calculateAuthorScore` not found.

- [ ] **Step 3: Implement the new scoring module**

Replace `apps/cli/src/scoring.ts`:

```typescript
import type { ClassificationType, Difficulty } from '@auctor/shared/classification'
import {
  DIFFICULTY_WEIGHTS,
  LOC_CAP,
  TYPE_WEIGHTS,
} from '@auctor/shared/scoring-weights'

export function calculateLocFactor(netLoc: number): number {
  const absLoc = Math.abs(netLoc)
  if (absLoc === 0) return 0
  return Math.min(1.0, Math.log2(1 + absLoc) / Math.log2(1 + LOC_CAP))
}

export function calculateUnitScore(input: {
  net_loc: number
  difficulty: Difficulty
  type: ClassificationType
  impact_score: number
}): number {
  const locFactor = calculateLocFactor(input.net_loc)
  const formulaScore = locFactor * DIFFICULTY_WEIGHTS[input.difficulty]
  const normalizedAi = input.impact_score / 10

  return (0.5 * formulaScore + 0.5 * normalizedAi) * TYPE_WEIGHTS[input.type]
}

export function calculateAuthorScore(
  unitScores: number[],
  daysInWindow: number,
): number {
  if (unitScores.length === 0) return 0
  const sum = unitScores.reduce((a, b) => a + b, 0)
  return sum / daysInWindow
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/scoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/scoring.ts apps/cli/src/scoring.test.ts
git commit -m "feat: replace placeholder scoring with spec formula (LOC factor + AI blend + type weights)"
```

---

### Task 4: Create server scaffold with Hono

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@auctor/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "@auctor/shared": "workspace:*",
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "zod": "^3.24.0",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create server entry point**

Create `apps/server/src/index.ts`:

```typescript
import { Hono } from 'hono'
import { classifyRoute } from './routes/classify'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/api', classifyRoute)

const port = parseInt(process.env.PORT || '3001', 10)
console.log(`Auctor server listening on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
```

- [ ] **Step 4: Create stub classify route**

Create `apps/server/src/routes/classify.ts`:

```typescript
import { Hono } from 'hono'

export const classifyRoute = new Hono()

classifyRoute.post('/classify', async (c) => {
  return c.json({ classifications: [] })
})
```

- [ ] **Step 5: Install dependencies and verify**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun install`

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun run typecheck`
Expected: No type errors.

- [ ] **Step 6: Start server and verify health endpoint**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun run start &`

Run: `curl http://localhost:3001/health`
Expected: `{"status":"ok"}`

Kill the server after verification.

- [ ] **Step 7: Commit**

```bash
git add apps/server/
git commit -m "feat: scaffold server with Hono, health endpoint, and stub classify route"
```

---

### Task 5: Implement classification cache (SQLite)

**Files:**
- Create: `apps/server/src/classifier/cache.ts`
- Create: `apps/server/src/classifier/cache.test.ts`

- [ ] **Step 1: Write failing test for cache**

Create `apps/server/src/classifier/cache.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, unlinkSync } from 'node:fs'
import { ClassificationCache } from './cache'

const TEST_DB = '/tmp/auctor-cache-test.sqlite'

afterEach(() => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
})

describe('ClassificationCache', () => {
  test('get returns null for missing key', () => {
    const cache = new ClassificationCache(TEST_DB)
    expect(cache.get('nonexistent')).toBeNull()
    cache.close()
  })

  test('set then get returns the classification', () => {
    const cache = new ClassificationCache(TEST_DB)
    const classification = {
      type: 'feature' as const,
      difficulty: 'hard' as const,
      impact_score: 8,
      reasoning: 'Complex auth feature',
    }
    cache.set('abc123', classification)
    const result = cache.get('abc123')
    expect(result).toEqual(classification)
    cache.close()
  })

  test('set overwrites existing entry', () => {
    const cache = new ClassificationCache(TEST_DB)
    cache.set('abc123', {
      type: 'bugfix' as const,
      difficulty: 'easy' as const,
      impact_score: 3,
      reasoning: 'Typo fix',
    })
    cache.set('abc123', {
      type: 'feature' as const,
      difficulty: 'hard' as const,
      impact_score: 8,
      reasoning: 'Updated',
    })
    const result = cache.get('abc123')
    expect(result!.type).toBe('feature')
    cache.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/classifier/cache.test.ts`
Expected: FAIL — `ClassificationCache` not found.

- [ ] **Step 3: Implement cache.ts**

Create `apps/server/src/classifier/cache.ts`:

```typescript
import Database from 'better-sqlite3'
import { ClassificationSchema } from '@auctor/shared/classification'
import type { Classification } from '@auctor/shared/classification'

export class ClassificationCache {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS classifications (
        work_unit_id TEXT PRIMARY KEY,
        classification_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  }

  get(workUnitId: string): Classification | null {
    const row = this.db
      .prepare('SELECT classification_json FROM classifications WHERE work_unit_id = ?')
      .get(workUnitId) as { classification_json: string } | undefined

    if (!row) return null

    const parsed = ClassificationSchema.safeParse(JSON.parse(row.classification_json))
    return parsed.success ? parsed.data : null
  }

  set(workUnitId: string, classification: Classification): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO classifications (work_unit_id, classification_json) VALUES (?, ?)',
      )
      .run(workUnitId, JSON.stringify(classification))
  }

  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/classifier/cache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/classifier/cache.ts apps/server/src/classifier/cache.test.ts
git commit -m "feat: add SQLite classification cache keyed by work unit ID"
```

---

### Task 6: Implement repo manager (clone/pull)

**Files:**
- Create: `apps/server/src/repo/manager.ts`
- Create: `apps/server/src/repo/manager.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/server/src/repo/manager.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { RepoManager } from './manager'

const TEST_REPOS_DIR = '/tmp/auctor-test-repos'

afterEach(() => {
  if (existsSync(TEST_REPOS_DIR)) rmSync(TEST_REPOS_DIR, { recursive: true })
})

describe('RepoManager', () => {
  test('repoDir returns a deterministic path for a URL', () => {
    const mgr = new RepoManager(TEST_REPOS_DIR)
    const dir = mgr.repoDir('https://github.com/user/repo')
    expect(dir).toContain(TEST_REPOS_DIR)
    expect(dir).toContain('github.com-user-repo')
  })

  test('repoDir is consistent for same URL', () => {
    const mgr = new RepoManager(TEST_REPOS_DIR)
    const a = mgr.repoDir('https://github.com/user/repo')
    const b = mgr.repoDir('https://github.com/user/repo')
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/repo/manager.test.ts`
Expected: FAIL — `RepoManager` not found.

- [ ] **Step 3: Implement manager.ts**

Create `apps/server/src/repo/manager.ts`:

```typescript
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export class RepoManager {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true })
    }
  }

  repoDir(repoUrl: string): string {
    const sanitized = repoUrl
      .replace(/^https?:\/\//, '')
      .replace(/\.git$/, '')
      .replace(/[/\\:]/g, '-')
    return join(this.baseDir, sanitized)
  }

  async ensureRepo(repoUrl: string): Promise<string> {
    const dir = this.repoDir(repoUrl)

    if (existsSync(join(dir, '.git'))) {
      const proc = Bun.spawn(['git', 'pull', '--ff-only'], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      await proc.exited
      return dir
    }

    const proc = Bun.spawn(['git', 'clone', repoUrl, dir], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`git clone failed: ${stderr}`)
    }
    return dir
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/repo/manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/repo/manager.ts apps/server/src/repo/manager.test.ts
git commit -m "feat: add repo manager for cloning and pulling repos by URL"
```

---

### Task 7: Implement classification prompt builder

**Files:**
- Create: `apps/server/src/classifier/prompt.ts`
- Create: `apps/server/src/classifier/prompt.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/server/src/classifier/prompt.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import type { WorkUnit } from '@auctor/shared/classification'
import { buildClassificationPrompt } from './prompt'

const mockUnit: WorkUnit = {
  id: 'abc123',
  kind: 'branch-day',
  author: 'Alice',
  branch: 'main',
  date: '2026-04-10',
  commit_shas: ['sha1', 'sha2'],
  commit_messages: ['feat: add auth', 'fix: token expiry'],
  diff: 'diff --git a/auth.ts b/auth.ts\n+export function login() {}',
  insertions: 45,
  deletions: 12,
  net: 33,
}

describe('buildClassificationPrompt', () => {
  test('includes diff in the prompt', () => {
    const prompt = buildClassificationPrompt(mockUnit)
    expect(prompt).toContain('diff --git')
  })

  test('includes commit messages', () => {
    const prompt = buildClassificationPrompt(mockUnit)
    expect(prompt).toContain('feat: add auth')
    expect(prompt).toContain('fix: token expiry')
  })

  test('includes metadata', () => {
    const prompt = buildClassificationPrompt(mockUnit)
    expect(prompt).toContain('Alice')
    expect(prompt).toContain('2026-04-10')
    expect(prompt).toContain('45')
  })

  test('includes classification instructions', () => {
    const prompt = buildClassificationPrompt(mockUnit)
    expect(prompt).toContain('feature')
    expect(prompt).toContain('bugfix')
    expect(prompt).toContain('trivial')
    expect(prompt).toContain('complex')
    expect(prompt).toContain('impact_score')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/classifier/prompt.test.ts`
Expected: FAIL — `buildClassificationPrompt` not found.

- [ ] **Step 3: Implement prompt.ts**

Create `apps/server/src/classifier/prompt.ts`:

```typescript
import type { WorkUnit } from '@auctor/shared/classification'

export function buildClassificationPrompt(unit: WorkUnit): string {
  return `Classify this code change. You have access to the full repository via Read, Grep, and Bash tools. Use them to understand context if the diff alone is ambiguous.

## Work Unit Metadata
- Author: ${unit.author}
- Branch: ${unit.branch}
- Date: ${unit.date}
- Lines added: ${unit.insertions}
- Lines removed: ${unit.deletions}
- Net change: ${unit.net}
- Unit type: ${unit.kind}

## Commit Messages
${unit.commit_messages.map((m) => `- ${m}`).join('\n')}

## Diff
\`\`\`diff
${unit.diff}
\`\`\`

## Classification Instructions

Classify this work unit with:

1. **type** — one of: feature, bugfix, refactor, chore, test, docs
   - feature: new functionality or capability
   - bugfix: fixing broken behavior
   - refactor: restructuring without behavior change
   - chore: dependency updates, CI config, tooling
   - test: adding or improving tests
   - docs: documentation, design docs, READMEs

2. **difficulty** — one of: trivial, easy, medium, hard, complex
   - trivial: typo fixes, single-line changes, config tweaks
   - easy: straightforward changes, well-understood patterns
   - medium: requires understanding of the system, multiple files
   - hard: complex logic, cross-cutting concerns, careful design
   - complex: architectural changes, new systems, deep domain knowledge

3. **impact_score** — 0 to 10, your judgment of overall impact
   - Consider: does this touch critical paths (auth, payments, data)?
   - Consider: does this improve developer experience significantly?
   - Consider: how many users/systems does this affect?

4. **reasoning** — brief explanation of your classification

Use the repo tools to check what the changed files do, find usages of modified functions, and understand the broader context.`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/classifier/prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/classifier/prompt.ts apps/server/src/classifier/prompt.test.ts
git commit -m "feat: add classification prompt builder for Agent SDK"
```

---

### Task 8: Implement Agent SDK classifier

**Files:**
- Create: `apps/server/src/classifier/agent.ts`
- Create: `apps/server/src/classifier/agent.test.ts`

- [ ] **Step 1: Write failing test (unit test with mock)**

Create `apps/server/src/classifier/agent.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { buildClassificationPrompt } from './prompt'
import type { WorkUnit } from '@auctor/shared/classification'

describe('classifyWorkUnit', () => {
  test('prompt is well-formed for Agent SDK', () => {
    const unit: WorkUnit = {
      id: 'test-id',
      kind: 'branch-day',
      author: 'Alice',
      branch: 'main',
      date: '2026-04-10',
      commit_shas: ['abc'],
      commit_messages: ['feat: add login'],
      diff: '+function login() {}',
      insertions: 10,
      deletions: 0,
      net: 10,
    }

    const prompt = buildClassificationPrompt(unit)
    expect(prompt).toContain('Classify this code change')
    expect(prompt.length).toBeGreaterThan(100)
  })
})
```

- [ ] **Step 2: Run test to verify it passes** (tests the prompt, not the SDK call)

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/classifier/agent.test.ts`
Expected: PASS

- [ ] **Step 3: Implement agent.ts**

Create `apps/server/src/classifier/agent.ts`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  ClassificationSchema,
  type Classification,
  type WorkUnit,
} from '@auctor/shared/classification'
import { buildClassificationPrompt } from './prompt'

const classificationJsonSchema = zodToJsonSchema(ClassificationSchema, {
  $refStrategy: 'root',
})

export async function classifyWorkUnit(
  unit: WorkUnit,
  repoDir: string,
): Promise<Classification> {
  const prompt = buildClassificationPrompt(unit)

  for await (const message of query({
    prompt,
    options: {
      allowedTools: ['Read', 'Grep', 'Bash'],
      cwd: repoDir,
      model: 'haiku',
      maxTurns: 3,
      outputFormat: {
        type: 'json_schema',
        schema: classificationJsonSchema,
      },
    },
  })) {
    if (
      message.type === 'result' &&
      message.structured_output
    ) {
      const parsed = ClassificationSchema.safeParse(message.structured_output)
      if (parsed.success) {
        return parsed.data
      }
      throw new Error(
        `Classification output failed validation: ${JSON.stringify(message.structured_output)}`,
      )
    }
  }

  throw new Error('Agent SDK query completed without a result')
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/classifier/agent.ts apps/server/src/classifier/agent.test.ts
git commit -m "feat: add Agent SDK classifier with Zod structured output"
```

Note: Add `zod-to-json-schema` to server dependencies:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun add zod-to-json-schema
```

---

### Task 9: Wire up classify route

**Files:**
- Modify: `apps/server/src/routes/classify.ts`
- Create: `apps/server/src/routes/classify.test.ts`

- [ ] **Step 1: Write failing test for the route**

Create `apps/server/src/routes/classify.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { classifyRoute } from './classify'

describe('POST /classify', () => {
  test('returns 400 for missing repo_url', async () => {
    const app = new Hono()
    app.route('/api', classifyRoute)

    const res = await app.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_units: [] }),
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 for missing work_units', async () => {
    const app = new Hono()
    app.route('/api', classifyRoute)

    const res = await app.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/user/repo' }),
    })
    expect(res.status).toBe(400)
  })

  test('returns 200 with empty classifications for empty work_units', async () => {
    const app = new Hono()
    app.route('/api', classifyRoute)

    const res = await app.request('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/user/repo',
        work_units: [],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.classifications).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/routes/classify.test.ts`
Expected: FAIL (current stub returns 200 for everything, no validation).

- [ ] **Step 3: Implement the full classify route**

Replace `apps/server/src/routes/classify.ts`:

```typescript
import { Hono } from 'hono'
import type {
  ClassifyRequest,
  ClassifyResponse,
  ClassifiedWorkUnit,
} from '@auctor/shared/api-types'
import { classifyWorkUnit } from '../classifier/agent'
import { ClassificationCache } from '../classifier/cache'
import { RepoManager } from '../repo/manager'

const REPOS_DIR = process.env.REPOS_DIR || '/tmp/auctor-repos'
const CACHE_DB = process.env.CACHE_DB || '/tmp/auctor-cache.sqlite'

const repoManager = new RepoManager(REPOS_DIR)
const cache = new ClassificationCache(CACHE_DB)

export const classifyRoute = new Hono()

classifyRoute.post('/classify', async (c) => {
  const body = await c.req.json<Partial<ClassifyRequest>>()

  if (!body.repo_url || typeof body.repo_url !== 'string') {
    return c.json({ error: 'repo_url is required' }, 400)
  }
  if (!Array.isArray(body.work_units)) {
    return c.json({ error: 'work_units array is required' }, 400)
  }
  if (body.work_units.length === 0) {
    return c.json({ classifications: [] } satisfies ClassifyResponse, 200)
  }

  const repoDir = await repoManager.ensureRepo(body.repo_url)

  const classifications: ClassifiedWorkUnit[] = []

  for (const unit of body.work_units) {
    const cached = cache.get(unit.id)
    if (cached) {
      classifications.push({ id: unit.id, classification: cached })
      continue
    }

    const classification = await classifyWorkUnit(unit, repoDir)
    cache.set(unit.id, classification)
    classifications.push({ id: unit.id, classification })
  }

  return c.json({ classifications } satisfies ClassifyResponse, 200)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test src/routes/classify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/classify.ts apps/server/src/routes/classify.test.ts
git commit -m "feat: implement /api/classify route with caching and repo management"
```

---

### Task 10: Add API client to CLI

**Files:**
- Create: `apps/cli/src/api-client.ts`
- Create: `apps/cli/src/api-client.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/cli/src/api-client.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { buildClassifyPayload } from './api-client'
import type { WorkUnit } from '@auctor/shared/classification'

describe('buildClassifyPayload', () => {
  test('builds a valid request body', () => {
    const units: WorkUnit[] = [
      {
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
      },
    ]

    const payload = buildClassifyPayload('https://github.com/user/repo', units)
    expect(payload.repo_url).toBe('https://github.com/user/repo')
    expect(payload.work_units).toHaveLength(1)
    expect(payload.work_units[0].id).toBe('abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/api-client.test.ts`
Expected: FAIL — `buildClassifyPayload` not found.

- [ ] **Step 3: Implement api-client.ts**

Create `apps/cli/src/api-client.ts`:

```typescript
import type { WorkUnit } from '@auctor/shared/classification'
import type {
  ClassifyRequest,
  ClassifyResponse,
} from '@auctor/shared/api-types'

const DEFAULT_SERVER_URL = 'http://localhost:3001'

export function buildClassifyPayload(
  repoUrl: string,
  workUnits: WorkUnit[],
): ClassifyRequest {
  return { repo_url: repoUrl, work_units: workUnits }
}

export async function classifyWorkUnits(
  serverUrl: string | undefined,
  repoUrl: string,
  workUnits: WorkUnit[],
): Promise<ClassifyResponse> {
  const base = serverUrl || DEFAULT_SERVER_URL
  const payload = buildClassifyPayload(repoUrl, workUnits)

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/api-client.ts apps/cli/src/api-client.test.ts
git commit -m "feat: add API client for server classification endpoint"
```

---

### Task 11: Wire CLI analyze command with work units + server + scoring

**Files:**
- Modify: `apps/cli/src/commands/analyze.ts`
- Modify: `apps/cli/src/types.ts`
- Modify: `apps/cli/src/output.ts`

- [ ] **Step 1: Update types.ts with extended config**

Replace `apps/cli/src/types.ts`:

```typescript
export interface Config {
  authors: string[]
  server_url?: string
  repo_url?: string
}

export interface Commit {
  sha: string
  author: string
  date: Date
  subject: string
  insertions: number
  deletions: number
  isMerge: boolean
}

export interface AuthorStats {
  author: string
  commits: number
  prs: number
  insertions: number
  deletions: number
  net: number
  score: number
}
```

- [ ] **Step 2: Update analyze.ts to use work units + classification**

Replace `apps/cli/src/commands/analyze.ts`:

```typescript
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { WorkUnit } from '@auctor/shared/classification'
import { classifyWorkUnits } from '../api-client'
import { getDiffForCommits } from '../git/diff'
import {
  getGitLog,
  getMergeCommits,
  parseGitLog,
  parseTimeWindow,
} from '../git/log'
import { extractBranchDayUnits, extractPrUnits } from '../git/work-units'
import { renderLeaderboard } from '../output'
import { calculateAuthorScore, calculateUnitScore } from '../scoring'
import type { AuthorStats, Config } from '../types'

export async function analyze(timeWindow: string, path: string): Promise<void> {
  const repoPath = resolve(path)
  const gitDir = join(repoPath, '.git')

  if (!existsSync(gitDir)) {
    console.error(`Not a git repository: ${repoPath}`)
    process.exit(1)
  }

  const configPath = join(repoPath, '.auctor.json')
  if (!existsSync(configPath)) {
    console.error('No config found. Run `auctor configure` first.')
    process.exit(1)
  }

  const config: Config = JSON.parse(await Bun.file(configPath).text())
  const since = parseTimeWindow(timeWindow)
  const daysMatch = timeWindow.match(/^-?(\d+)d$/)
  const daysInWindow = daysMatch ? parseInt(daysMatch[1], 10) : 7

  const [logOutput, mergeShas] = await Promise.all([
    getGitLog(repoPath, since),
    getMergeCommits(repoPath, since),
  ])

  let commits = parseGitLog(logOutput)
  for (const commit of commits) {
    commit.isMerge = mergeShas.has(commit.sha)
  }

  const authorSet = new Set(config.authors)
  commits = commits.filter((c) => authorSet.has(c.author))

  if (commits.length === 0) {
    console.log('No commits found for whitelisted authors in this time window.')
    return
  }

  // Extract work units
  const branchDayUnits = extractBranchDayUnits(commits, 'main')
  const prUnits = extractPrUnits(commits)
  const allUnits = [...branchDayUnits, ...prUnits]

  // Hydrate diffs
  const hydratedUnits: WorkUnit[] = await Promise.all(
    allUnits.map(async (unit) => {
      const diff = await getDiffForCommits(repoPath, unit.commit_shas)
      return { ...unit, diff }
    }),
  )

  // Classify via server
  const repoUrl = config.repo_url || `file://${repoPath}`
  let classificationMap = new Map<string, { type: string; difficulty: string; impact_score: number }>()

  if (config.server_url) {
    const response = await classifyWorkUnits(
      config.server_url,
      repoUrl,
      hydratedUnits,
    )
    for (const c of response.classifications) {
      classificationMap.set(c.id, c.classification)
    }
  } else {
    // Fallback: no server, use defaults
    console.log('No server_url in config. Using default classification (medium feature).')
    for (const unit of hydratedUnits) {
      classificationMap.set(unit.id, {
        type: 'feature',
        difficulty: 'medium',
        impact_score: 5,
      })
    }
  }

  // Score per author
  const authorUnits = new Map<string, number[]>()
  const authorRawStats = new Map<string, Omit<AuthorStats, 'score'>>()

  for (const unit of hydratedUnits) {
    const classification = classificationMap.get(unit.id)
    if (!classification) continue

    const unitScore = calculateUnitScore({
      net_loc: unit.net,
      difficulty: classification.difficulty as any,
      type: classification.type as any,
      impact_score: classification.impact_score,
    })

    const existing = authorUnits.get(unit.author) ?? []
    existing.push(unitScore)
    authorUnits.set(unit.author, existing)

    const stats = authorRawStats.get(unit.author) ?? {
      author: unit.author,
      commits: 0,
      prs: 0,
      insertions: 0,
      deletions: 0,
      net: 0,
    }
    stats.insertions += unit.insertions
    stats.deletions += unit.deletions
    stats.net += unit.net
    authorRawStats.set(unit.author, stats)
  }

  // Count raw commits/PRs from original commit list
  for (const commit of commits) {
    const stats = authorRawStats.get(commit.author)
    if (!stats) continue
    stats.commits++
    if (commit.isMerge) stats.prs++
  }

  // Build leaderboard
  const leaderboard: AuthorStats[] = [...authorRawStats.entries()]
    .map(([author, stats]) => {
      const unitScores = authorUnits.get(author) ?? []
      const score = calculateAuthorScore(unitScores, daysInWindow)
      return { ...stats, score: Math.round(score * 100) / 100 }
    })
    .sort((a, b) => b.score - a.score)

  console.log(renderLeaderboard(leaderboard))

  // Write JSON result
  const resultsDir = join(repoPath, '.auctor', 'results')
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })

  const repoName = repoPath.split('/').pop() || 'unknown'
  const result = {
    repo: repoName,
    window: timeWindow,
    analyzed_at: new Date().toISOString(),
    authors: leaderboard.map((s) => ({
      name: s.author,
      score: s.score,
      commits: s.commits,
      loc_added: s.insertions,
      loc_removed: s.deletions,
      loc_net: s.net,
    })),
  }

  const resultPath = join(resultsDir, `${repoName}.json`)
  await Bun.write(resultPath, JSON.stringify(result, null, 2))
  console.log(`\nResults saved to ${resultPath}`)
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun run typecheck`
Expected: No type errors.

- [ ] **Step 4: Run all CLI tests**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/analyze.ts apps/cli/src/types.ts
git commit -m "feat: wire analyze command with work unit extraction, server classification, and scoring formula"
```

---

### Task 12: Add Dockerfile and fly.toml for server

**Files:**
- Create: `apps/server/Dockerfile`
- Create: `apps/server/fly.toml`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM oven/bun:1.3.6-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

RUN bun install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/

EXPOSE 3001

CMD ["bun", "run", "apps/server/src/index.ts"]
```

- [ ] **Step 2: Create fly.toml**

```toml
app = "auctor-server"
primary_region = "sjc"

[build]

[env]
  PORT = "3001"
  REPOS_DIR = "/data/repos"
  CACHE_DB = "/data/cache.sqlite"

[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[mounts]
  source = "auctor_data"
  destination = "/data"
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/Dockerfile apps/server/fly.toml
git commit -m "feat: add Dockerfile and fly.toml for server deployment"
```

---

### Task 13: Final integration test

- [ ] **Step 1: Run full lint check**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run lint`
Expected: No lint errors (fix any that appear).

- [ ] **Step 2: Run full typecheck**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck`
Expected: No type errors across all packages.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test`
Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test`
Expected: All tests pass.

- [ ] **Step 4: Manual smoke test (CLI without server)**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run apps/cli/src/index.ts analyze -7d --path .`
Expected: Shows leaderboard with default classifications (no server), or "Run `auctor configure` first" message.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: lint and type fixes from integration testing"
```
