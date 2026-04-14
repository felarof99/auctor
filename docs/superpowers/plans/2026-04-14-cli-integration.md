# CLI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the CLI to the classification server and ConvexDB — Convex becomes the classification cache and permanent store.

**Architecture:** The CLI calls Convex mutations/queries via the ConvexClient from `@auctor/database`. A new `convex-client.ts` wraps the 5 Convex operations. `configure` upserts repos+authors. `analyze` checks Convex cache before classifying, then uploads work_units and analysis_runs.

**Tech Stack:** ConvexDB (convex npm package), existing `@auctor/database` client, existing Convex functions in `convex/`

---

## File Structure

### New files

```
apps/cli/src/convex-client.ts           # Convex wrapper: ensureRepo, ensureAuthors, findExistingWorkUnit, insertWorkUnit, insertAnalysisRun
apps/cli/src/convex-client.test.ts      # Unit tests for payload builders
```

### Modified files

```
apps/cli/src/types.ts                   # Add convex_url to Config
apps/cli/src/commands/configure.ts      # Add Convex upsert after local write
apps/cli/src/commands/analyze.ts        # Add Convex cache check, upload work_units, upload analysis_run
apps/cli/package.json                   # Add @auctor/database dependency
```

---

### Task 1: Add convex_url to Config and add database dependency

**Files:**
- Modify: `apps/cli/src/types.ts`
- Modify: `apps/cli/package.json`

- [ ] **Step 1: Add convex_url to Config interface**

In `apps/cli/src/types.ts`, add `convex_url` to the Config interface:

```typescript
export interface Config {
  authors: string[]
  server_url?: string
  repo_url?: string
  convex_url?: string
}
```

- [ ] **Step 2: Add @auctor/database to CLI package.json**

Add to `dependencies` in `apps/cli/package.json`:
```json
"@auctor/database": "workspace:*"
```

- [ ] **Step 3: Run bun install**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun install`
Expected: Dependencies resolved, no errors.

- [ ] **Step 4: Run typecheck and tests**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun run typecheck && bun test`
Expected: All pass (existing tests unaffected since convex_url is optional).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/types.ts apps/cli/package.json bun.lock
git commit -m "feat: add convex_url to CLI config and database dependency"
```

---

### Task 2: Create convex-client.ts wrapper

**Files:**
- Create: `apps/cli/src/convex-client.ts`
- Create: `apps/cli/src/convex-client.test.ts`

- [ ] **Step 1: Write test for buildWorkUnitPayload helper**

Create `apps/cli/src/convex-client.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { buildWorkUnitPayload } from './convex-client'

describe('buildWorkUnitPayload', () => {
  test('builds flat payload from work unit + classification + scores', () => {
    const payload = buildWorkUnitPayload({
      repoId: 'repo123' as any,
      authorId: 'author456' as any,
      unit: {
        id: 'unit-1',
        kind: 'branch-day',
        author: 'Alice',
        branch: 'main',
        date: '2026-04-10',
        commit_shas: ['abc', 'def'],
        commit_messages: ['feat: x', 'fix: y'],
        diff: '+line',
        insertions: 100,
        deletions: 20,
        net: 80,
      },
      classification: {
        type: 'feature',
        difficulty: 'hard',
        impact_score: 8,
        reasoning: 'Complex auth feature',
      },
      locFactor: 0.65,
      formulaScore: 0.975,
      aiScore: 0.8,
      typeWeight: 1.0,
      difficultyWeight: 1.5,
      unitScore: 0.8875,
    })

    expect(payload.repoId).toBe('repo123')
    expect(payload.authorId).toBe('author456')
    expect(payload.unitType).toBe('branch_day')
    expect(payload.branch).toBe('main')
    expect(payload.date).toBe('2026-04-10')
    expect(payload.commitShas).toEqual(['abc', 'def'])
    expect(payload.locAdded).toBe(100)
    expect(payload.locRemoved).toBe(20)
    expect(payload.locNet).toBe(80)
    expect(payload.classificationType).toBe('feature')
    expect(payload.difficultyLevel).toBe('hard')
    expect(payload.impactScore).toBe(8)
    expect(payload.reasoning).toBe('Complex auth feature')
    expect(payload.locFactor).toBe(0.65)
    expect(payload.formulaScore).toBe(0.975)
    expect(payload.aiScore).toBe(0.8)
    expect(payload.typeWeight).toBe(1.0)
    expect(payload.difficultyWeight).toBe(1.5)
    expect(payload.unitScore).toBe(0.8875)
  })

  test('converts pr kind to pr unitType', () => {
    const payload = buildWorkUnitPayload({
      repoId: 'r' as any,
      authorId: 'a' as any,
      unit: {
        id: 'u', kind: 'pr', author: 'A', branch: 'main', date: '2026-04-10',
        commit_shas: ['x'], commit_messages: ['msg'], diff: '',
        insertions: 0, deletions: 0, net: 0,
      },
      classification: { type: 'bugfix', difficulty: 'easy', impact_score: 3, reasoning: 'fix' },
      locFactor: 0, formulaScore: 0, aiScore: 0.3, typeWeight: 0.8, difficultyWeight: 0.5, unitScore: 0.12,
    })

    expect(payload.unitType).toBe('pr')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/convex-client.test.ts`
Expected: FAIL — `buildWorkUnitPayload` not found.

- [ ] **Step 3: Implement convex-client.ts**

Create `apps/cli/src/convex-client.ts`:

```typescript
import type { ConvexClient } from 'convex/browser'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import type { Id } from '../../../convex/_generated/dataModel'
import { api } from '../../../convex/_generated/api'

export function createConvexClient(url: string): ConvexClient {
  const { ConvexClient: Client } = require('convex/browser')
  return new Client(url)
}

export async function ensureRepo(
  client: ConvexClient,
  repoName: string,
): Promise<Id<'repos'>> {
  return await client.mutation(api.repos.getOrCreate, { name: repoName })
}

export async function ensureAuthors(
  client: ConvexClient,
  repoId: Id<'repos'>,
  authors: string[],
): Promise<Map<string, Id<'authors'>>> {
  const map = new Map<string, Id<'authors'>>()
  for (const username of authors) {
    const authorId = await client.mutation(api.authors.upsert, {
      repoId,
      username,
      whitelisted: true,
    })
    map.set(username, authorId)
  }
  return map
}

export async function findExistingWorkUnit(
  client: ConvexClient,
  repoId: Id<'repos'>,
  authorId: Id<'authors'>,
  date: string,
  unitType: 'pr' | 'branch_day',
  branch: string,
): Promise<boolean> {
  return await client.query(api.work_units.exists, {
    repoId,
    authorId,
    date,
    unitType,
    branch,
  })
}

export interface WorkUnitPayloadInput {
  repoId: Id<'repos'>
  authorId: Id<'authors'>
  unit: WorkUnit
  classification: Classification
  locFactor: number
  formulaScore: number
  aiScore: number
  typeWeight: number
  difficultyWeight: number
  unitScore: number
}

export function buildWorkUnitPayload(input: WorkUnitPayloadInput) {
  return {
    repoId: input.repoId,
    authorId: input.authorId,
    unitType: (input.unit.kind === 'branch-day' ? 'branch_day' : 'pr') as 'pr' | 'branch_day',
    branch: input.unit.branch,
    date: input.unit.date,
    commitShas: input.unit.commit_shas,
    locAdded: input.unit.insertions,
    locRemoved: input.unit.deletions,
    locNet: input.unit.net,
    classificationType: input.classification.type,
    difficultyLevel: input.classification.difficulty,
    impactScore: input.classification.impact_score,
    reasoning: input.classification.reasoning,
    locFactor: input.locFactor,
    formulaScore: input.formulaScore,
    aiScore: input.aiScore,
    typeWeight: input.typeWeight,
    difficultyWeight: input.difficultyWeight,
    unitScore: input.unitScore,
  }
}

export async function insertWorkUnit(
  client: ConvexClient,
  payload: ReturnType<typeof buildWorkUnitPayload>,
): Promise<void> {
  await client.mutation(api.work_units.insert, payload)
}

export async function insertAnalysisRun(
  client: ConvexClient,
  data: {
    repoId: Id<'repos'>
    timeWindow: string
    analyzedAt: string
    daysInWindow: number
    authorScores: Array<{
      authorId: Id<'authors'>
      username: string
      commits: number
      locAdded: number
      locRemoved: number
      locNet: number
      score: number
    }>
  },
): Promise<void> {
  await client.mutation(api.analysis_runs.insert, data)
}
```

Note: The `import type { Id }` and `import { api }` from convex/_generated may need path adjustment depending on how the monorepo resolves. The implementer should verify the import path works — it may need to be `../../../convex/_generated/api` or configured via tsconfig paths.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test src/convex-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/convex-client.ts apps/cli/src/convex-client.test.ts
git commit -m "feat: add Convex client wrapper for CLI"
```

---

### Task 3: Wire Convex into configure command

**Files:**
- Modify: `apps/cli/src/commands/configure.ts`

- [ ] **Step 1: Update configure to upsert to Convex after local write**

Replace `apps/cli/src/commands/configure.ts`:

```typescript
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import * as clack from '@clack/prompts'
import { createConvexClient, ensureAuthors, ensureRepo } from '../convex-client'
import { getUniqueAuthors } from '../git/authors'
import { parseTimeWindow } from '../git/log'
import type { Config } from '../types'

export async function configure(
  timeWindow: string,
  path: string,
): Promise<void> {
  const repoPath = resolve(path)
  const gitDir = join(repoPath, '.git')

  if (!existsSync(gitDir)) {
    console.error(`Not a git repository: ${repoPath}`)
    process.exit(1)
  }

  const since = parseTimeWindow(timeWindow)
  const authors = await getUniqueAuthors(repoPath, since)

  if (authors.length === 0) {
    console.error(`No authors found in the last ${timeWindow}`)
    process.exit(1)
  }

  const configPath = join(repoPath, '.auctor.json')
  let existingConfig: Partial<Config> = {}
  if (existsSync(configPath)) {
    existingConfig = JSON.parse(await Bun.file(configPath).text())
  }

  clack.intro('auctor configure')

  const selected = await clack.multiselect({
    message: 'Select authors to track:',
    options: authors.map((a) => ({
      value: a,
      label: a,
    })),
    initialValues: (existingConfig.authors ?? []).filter((a) =>
      authors.includes(a),
    ),
  })

  if (clack.isCancel(selected)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }

  const config: Config = {
    ...existingConfig,
    authors: selected as string[],
  }
  await Bun.write(configPath, JSON.stringify(config, null, 2))

  // Sync to Convex if configured
  if (config.convex_url) {
    try {
      const client = createConvexClient(config.convex_url)
      const repoName = config.repo_url ?? basename(repoPath)
      const repoId = await ensureRepo(client, repoName)
      await ensureAuthors(client, repoId, config.authors)
      clack.log.success('Synced to Convex')
      await client.close()
    } catch (err) {
      clack.log.warn(
        `Failed to sync to Convex: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  clack.outro(`Saved ${config.authors.length} authors to .auctor.json`)
}
```

Key changes from existing:
- Preserves existing config fields (server_url, repo_url, convex_url) when rewriting
- After local write, upserts repo + authors to Convex if convex_url is set
- Graceful degradation: logs warning if Convex fails, doesn't crash

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/configure.ts
git commit -m "feat: sync configure to Convex (upsert repo + authors)"
```

---

### Task 4: Wire Convex cache + upload into analyze command

**Files:**
- Modify: `apps/cli/src/commands/analyze.ts`

- [ ] **Step 1: Add Convex imports and cache check to analyze**

Add these imports at the top of `apps/cli/src/commands/analyze.ts`:

```typescript
import {
  DIFFICULTY_WEIGHTS,
  TYPE_WEIGHTS,
} from '@auctor/shared/scoring-weights'
import {
  buildWorkUnitPayload,
  createConvexClient,
  ensureAuthors,
  ensureRepo,
  findExistingWorkUnit,
  insertAnalysisRun,
  insertWorkUnit,
} from '../convex-client'
```

- [ ] **Step 2: Add Convex initialization after config load**

After `const config: Config = ...` and before the git log calls, add:

```typescript
  // Initialize Convex if configured
  let convexClient: Awaited<ReturnType<typeof createConvexClient>> | null = null
  let repoId: any = null
  let authorIdMap = new Map<string, any>()

  if (config.convex_url) {
    try {
      convexClient = createConvexClient(config.convex_url)
      const repoName = config.repo_url ?? basename(repoPath)
      repoId = await ensureRepo(convexClient, repoName)
      authorIdMap = await ensureAuthors(convexClient, repoId, config.authors)
    } catch (err) {
      console.warn(`Warning: Convex connection failed, running in local-only mode: ${err instanceof Error ? err.message : String(err)}`)
      convexClient = null
    }
  }
```

- [ ] **Step 3: Add Convex cache check before classification**

Replace the classification section. Before classifying, check Convex for existing work units. After the `// Classify work units` comment, replace the entire classification block with:

```typescript
  // Classify work units (check Convex cache first)
  const classificationMap = new Map<
    string,
    { type: string; difficulty: string; impact_score: number; reasoning: string }
  >()
  const uncachedUnits: WorkUnit[] = []

  if (convexClient && repoId) {
    for (const unit of hydratedUnits) {
      const authorId = authorIdMap.get(unit.author)
      if (!authorId) {
        uncachedUnits.push(unit)
        continue
      }
      const exists = await findExistingWorkUnit(
        convexClient,
        repoId,
        authorId,
        unit.date,
        unit.kind === 'branch-day' ? 'branch_day' : 'pr',
        unit.branch,
      )
      if (!exists) {
        uncachedUnits.push(unit)
      }
    }
    if (uncachedUnits.length < hydratedUnits.length) {
      console.log(`Skipping ${hydratedUnits.length - uncachedUnits.length} already-classified units (Convex cache)`)
    }
  } else {
    uncachedUnits.push(...hydratedUnits)
  }

  // Classify uncached units via server
  if (uncachedUnits.length > 0) {
    if (config.server_url) {
      const repoUrl = config.repo_url ?? repoPath
      const response = await classifyWorkUnits(
        config.server_url,
        repoUrl,
        uncachedUnits,
      )
      for (const item of response.classifications) {
        classificationMap.set(item.id, {
          ...item.classification,
          reasoning: item.classification.reasoning ?? '',
        })
      }
    } else {
      console.warn(
        'Warning: No server_url configured. Using default classification (feature/medium/5).',
      )
      for (const unit of uncachedUnits) {
        classificationMap.set(unit.id, {
          type: 'feature',
          difficulty: 'medium',
          impact_score: 5,
          reasoning: 'Default classification (no server configured)',
        })
      }
    }
  }
```

- [ ] **Step 4: Add Convex upload after scoring**

After the scoring loop (after `authorUnitsMap.set(unit.author, existing)`), add upload logic for newly classified units:

```typescript
    // Upload newly classified work unit to Convex
    if (convexClient && repoId && classificationMap.has(unit.id)) {
      const authorId = authorIdMap.get(unit.author)
      if (authorId) {
        try {
          const payload = buildWorkUnitPayload({
            repoId,
            authorId,
            unit,
            classification: classification as any,
            locFactor: calculateLocFactor(unit.net),
            formulaScore: calculateLocFactor(unit.net) * DIFFICULTY_WEIGHTS[classification.difficulty as keyof typeof DIFFICULTY_WEIGHTS],
            aiScore: classification.impact_score / 10,
            typeWeight: TYPE_WEIGHTS[classification.type as keyof typeof TYPE_WEIGHTS],
            difficultyWeight: DIFFICULTY_WEIGHTS[classification.difficulty as keyof typeof DIFFICULTY_WEIGHTS],
            unitScore,
          })
          await insertWorkUnit(convexClient, payload)
        } catch (err) {
          console.warn(`Warning: Failed to upload work unit to Convex: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
```

- [ ] **Step 5: Add analysis_run upload after leaderboard**

After the leaderboard is built (after `.sort(...)`) and before `console.log(renderLeaderboard(...))`, add:

```typescript
  // Upload analysis run to Convex
  if (convexClient && repoId) {
    try {
      await insertAnalysisRun(convexClient, {
        repoId,
        timeWindow,
        analyzedAt: new Date().toISOString(),
        daysInWindow,
        authorScores: leaderboard.map((s) => ({
          authorId: authorIdMap.get(s.author)!,
          username: s.author,
          commits: s.commits,
          locAdded: s.insertions,
          locRemoved: s.deletions,
          locNet: s.net,
          score: Number(s.score.toFixed(4)),
        })),
      })
      console.log('Analysis run uploaded to Convex')
    } catch (err) {
      console.warn(`Warning: Failed to upload analysis run to Convex: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
```

- [ ] **Step 6: Close Convex client at the end**

At the very end of the function (after the jsonPath block), add:

```typescript
  if (convexClient) {
    await convexClient.close()
  }
```

- [ ] **Step 7: Run typecheck**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun run typecheck`
Expected: No errors.

- [ ] **Step 8: Run all tests**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test`
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/commands/analyze.ts
git commit -m "feat: wire analyze to Convex (cache check + work unit upload + analysis run upload)"
```

---

### Task 5: Final integration verification

- [ ] **Step 1: Run lint**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bunx biome check`
Expected: No errors (only schema version infos).

- [ ] **Step 2: Run full typecheck**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck`
Expected: No errors across all packages.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/cli && bun test`
Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/server && bun test`
Expected: All pass.

- [ ] **Step 4: Smoke test without Convex (local-only mode)**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run apps/cli/src/index.ts analyze -7d --path .`
Expected: Works as before — default classification, no Convex errors (convex_url not in config).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes from final verification"
```
