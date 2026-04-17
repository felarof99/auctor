# Auctor Bundle Configs & Microscope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-repo `.auctor.json` with a committed bundle YAML that groups several repos and their engineers; update `configure` and `analyze` to operate on bundles; add `microscope` for per-engineer per-day commit breakdowns across a bundle.

**Architecture:** New `bundle.ts` module owns YAML load/save and set-union helpers. `configure` scans one repo and merges its authors into the bundle's shared engineer list. `analyze` loops every repo in the bundle, runs the existing classify/score pipeline per repo, and aggregates scored work units into one combined leaderboard (one `analysis_run` per bundle). `microscope` reuses `getGitLog`/`getDiffForCommits`, filters to one engineer via `fuzzysort` pick, groups commits by day, and prints them.

**Tech Stack:** Bun, TypeScript, `commander`, `@clack/prompts`, `yaml`, `fuzzysort`, Convex client. Test runner: `bun test`.

**Spec:** `docs/superpowers/specs/2026-04-17-auctor-bundle-configs-microscope-design.md`

---

## File Structure

**New files:**
- `apps/cli/src/bundle.ts` — YAML load/save + pure bundle mutation helpers.
- `apps/cli/src/bundle.test.ts` — unit tests for bundle helpers.
- `apps/cli/src/commands/microscope.ts` — command handler for `auctor microscope`.
- `apps/cli/src/microscope-output.ts` — pure `groupByDay` + `renderMicroscope` + JSON report builder.
- `apps/cli/src/microscope-output.test.ts` — unit tests.
- `configs/.gitkeep` — ensure `configs/` exists in git.

**Modified files:**
- `apps/cli/package.json` — add `yaml` and `fuzzysort` deps.
- `apps/cli/src/types.ts` — add `BundleConfig`, `BundleRepo`; remove old `Config` at the end.
- `apps/cli/src/commands/configure.ts` — full rewrite.
- `apps/cli/src/commands/analyze.ts` — full rewrite around per-repo loop + aggregate.
- `apps/cli/src/analyze-aggregate.ts` — NEW: pure `aggregateBundleResults` helper extracted for testability.
- `apps/cli/src/analyze-aggregate.test.ts` — unit tests for aggregation.
- `apps/cli/src/index.ts` — update `configure` / `analyze` signatures, register `microscope`.
- `.gitignore` — ignore `configs/.results/`.

---

## Task 1: Add dependencies

**Files:**
- Modify: `apps/cli/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add deps**

Run:
```bash
cd apps/cli && bun add yaml fuzzysort
```

Expected: `apps/cli/package.json` gains `"yaml"` and `"fuzzysort"` entries under `dependencies`; `bun.lock` at repo root updates.

- [ ] **Step 2: Verify installs resolve**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck
```

Expected: exit 0 (no new type errors; deps are merely added, not used yet).

- [ ] **Step 3: Commit**

```bash
git add apps/cli/package.json bun.lock
git commit -m "chore(cli): add yaml and fuzzysort deps"
```

---

## Task 2: Add bundle types (additive)

**Files:**
- Modify: `apps/cli/src/types.ts`

- [ ] **Step 1: Add `BundleRepo` and `BundleConfig` types**

Edit `apps/cli/src/types.ts` — append at the end (keep existing `Config` interface for now):

```typescript
export interface BundleRepo {
  name: string
  path: string
  repo_url?: string
}

export interface BundleConfig {
  name: string
  server_url?: string
  convex_url?: string
  repos: BundleRepo[]
  engineers: string[]
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
bun run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/types.ts
git commit -m "feat(cli): add BundleConfig and BundleRepo types"
```

---

## Task 3: Implement `bundle.ts`

**Files:**
- Create: `apps/cli/src/bundle.ts`
- Create: `apps/cli/src/bundle.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/cli/src/bundle.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addRepo,
  findRepoByPath,
  loadBundle,
  mergeEngineers,
  saveBundle,
} from './bundle'
import type { BundleConfig } from './types'

const tmpDirs: string[] = []
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'auctor-bundle-test-'))
  tmpDirs.push(d)
  return d
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

const base: BundleConfig = {
  name: 'browseros',
  repos: [
    { name: 'main', path: '/tmp/main' },
  ],
  engineers: ['alice'],
}

describe('saveBundle + loadBundle', () => {
  test('roundtrips a bundle through YAML', async () => {
    const dir = mkTmp()
    const path = join(dir, 'browseros.yaml')
    await saveBundle(path, {
      ...base,
      server_url: 'https://server',
      convex_url: 'https://convex',
    })
    const loaded = await loadBundle(path)
    expect(loaded.name).toBe('browseros')
    expect(loaded.server_url).toBe('https://server')
    expect(loaded.convex_url).toBe('https://convex')
    expect(loaded.repos).toEqual([{ name: 'main', path: '/tmp/main' }])
    expect(loaded.engineers).toEqual(['alice'])
  })

  test('loadBundle throws when file does not exist', async () => {
    await expect(loadBundle('/does/not/exist.yaml')).rejects.toThrow(
      /not found/i,
    )
  })

  test('loadBundle throws when YAML is missing required fields', async () => {
    const dir = mkTmp()
    const path = join(dir, 'bad.yaml')
    await Bun.write(path, 'name: test\n')
    await expect(loadBundle(path)).rejects.toThrow(/repos/)
  })
})

describe('addRepo', () => {
  test('appends a new repo', () => {
    const out = addRepo(base, { name: 'docs', path: '/tmp/docs' })
    expect(out.repos).toHaveLength(2)
    expect(out.repos[1]).toEqual({ name: 'docs', path: '/tmp/docs' })
  })

  test('is idempotent when same path is added twice', () => {
    const out = addRepo(base, { name: 'main', path: '/tmp/main' })
    expect(out.repos).toHaveLength(1)
  })

  test('does not mutate the input', () => {
    const snapshot = JSON.stringify(base)
    addRepo(base, { name: 'docs', path: '/tmp/docs' })
    expect(JSON.stringify(base)).toBe(snapshot)
  })
})

describe('mergeEngineers', () => {
  test('unions usernames without duplicates', () => {
    const out = mergeEngineers(base, ['alice', 'bob'])
    expect(out.engineers.sort()).toEqual(['alice', 'bob'])
  })

  test('preserves existing ordering then appends new', () => {
    const out = mergeEngineers({ ...base, engineers: ['alice', 'bob'] }, ['carol', 'alice'])
    expect(out.engineers).toEqual(['alice', 'bob', 'carol'])
  })
})

describe('findRepoByPath', () => {
  test('returns the matching repo', () => {
    const r = findRepoByPath(base, '/tmp/main')
    expect(r?.name).toBe('main')
  })
  test('returns null when no match', () => {
    expect(findRepoByPath(base, '/tmp/nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd apps/cli && bun test src/bundle.test.ts
```
Expected: FAIL with module-not-found on `./bundle`.

- [ ] **Step 3: Implement `bundle.ts`**

Create `apps/cli/src/bundle.ts`:

```typescript
import { existsSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import type { BundleConfig, BundleRepo } from './types'

export async function loadBundle(configPath: string): Promise<BundleConfig> {
  if (!existsSync(configPath)) {
    throw new Error(`Bundle config not found: ${configPath}`)
  }
  const raw = await Bun.file(configPath).text()
  const parsed = parse(raw) as unknown
  return validate(parsed, configPath)
}

export async function saveBundle(
  configPath: string,
  config: BundleConfig,
): Promise<void> {
  const ordered: BundleConfig = {
    name: config.name,
    ...(config.server_url ? { server_url: config.server_url } : {}),
    ...(config.convex_url ? { convex_url: config.convex_url } : {}),
    repos: config.repos,
    engineers: config.engineers,
  }
  await Bun.write(configPath, stringify(ordered))
}

export function addRepo(
  config: BundleConfig,
  repo: BundleRepo,
): BundleConfig {
  if (findRepoByPath(config, repo.path)) return config
  return { ...config, repos: [...config.repos, repo] }
}

export function mergeEngineers(
  config: BundleConfig,
  usernames: string[],
): BundleConfig {
  const existing = new Set(config.engineers)
  const merged = [...config.engineers]
  for (const u of usernames) {
    if (!existing.has(u)) {
      merged.push(u)
      existing.add(u)
    }
  }
  return { ...config, engineers: merged }
}

export function findRepoByPath(
  config: BundleConfig,
  path: string,
): BundleRepo | null {
  return config.repos.find((r) => r.path === path) ?? null
}

function validate(raw: unknown, path: string): BundleConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Bundle config at ${path} is not a YAML object`)
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string' || !obj.name) {
    throw new Error(`Bundle ${path} is missing required string field: name`)
  }
  if (!Array.isArray(obj.repos)) {
    throw new Error(`Bundle ${path} is missing required array field: repos`)
  }
  if (!Array.isArray(obj.engineers)) {
    throw new Error(
      `Bundle ${path} is missing required array field: engineers`,
    )
  }
  const repos: BundleRepo[] = obj.repos.map((r, i) => {
    if (!r || typeof r !== 'object') {
      throw new Error(`Bundle ${path} repos[${i}] is not an object`)
    }
    const rec = r as Record<string, unknown>
    if (typeof rec.name !== 'string' || typeof rec.path !== 'string') {
      throw new Error(`Bundle ${path} repos[${i}] missing name or path`)
    }
    return {
      name: rec.name,
      path: rec.path,
      ...(typeof rec.repo_url === 'string' ? { repo_url: rec.repo_url } : {}),
    }
  })
  const engineers = obj.engineers.map((e, i) => {
    if (typeof e !== 'string') {
      throw new Error(`Bundle ${path} engineers[${i}] is not a string`)
    }
    return e
  })
  return {
    name: obj.name,
    ...(typeof obj.server_url === 'string'
      ? { server_url: obj.server_url }
      : {}),
    ...(typeof obj.convex_url === 'string'
      ? { convex_url: obj.convex_url }
      : {}),
    repos,
    engineers,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/cli && bun test src/bundle.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Typecheck and lint**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck && bun run lint
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/bundle.ts apps/cli/src/bundle.test.ts
git commit -m "feat(cli): add bundle module with load/save/merge helpers"
```

---

## Task 4: Implement `microscope-output.ts`

**Files:**
- Create: `apps/cli/src/microscope-output.ts`
- Create: `apps/cli/src/microscope-output.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/cli/src/microscope-output.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import {
  buildMicroscopeReport,
  groupByDay,
  renderMicroscope,
  type MicroscopeCommit,
} from './microscope-output'

const commits: MicroscopeCommit[] = [
  {
    repo: 'main',
    sha: 'aaaaaaabbbbbbb',
    subject: 'fix: X',
    insertions: 10,
    deletions: 2,
    date: new Date('2026-04-17T12:00:00Z'),
  },
  {
    repo: 'docs',
    sha: 'ccccccc1111111',
    subject: 'docs: Y',
    insertions: 5,
    deletions: 0,
    date: new Date('2026-04-17T08:00:00Z'),
  },
  {
    repo: 'main',
    sha: 'deadbee2222222',
    subject: 'feat: Z',
    insertions: 100,
    deletions: 30,
    date: new Date('2026-04-16T20:00:00Z'),
  },
]

describe('groupByDay', () => {
  test('groups commits by YYYY-MM-DD and sorts days descending', () => {
    const days = groupByDay(commits)
    expect(days).toHaveLength(2)
    expect(days[0].date).toBe('2026-04-17')
    expect(days[0].commits).toHaveLength(2)
    expect(days[1].date).toBe('2026-04-16')
    expect(days[1].commits).toHaveLength(1)
  })

  test('sums per-day totals', () => {
    const [today, yesterday] = groupByDay(commits)
    expect(today.totals).toEqual({ commits: 2, insertions: 15, deletions: 2 })
    expect(yesterday.totals).toEqual({
      commits: 1,
      insertions: 100,
      deletions: 30,
    })
  })
})

describe('renderMicroscope', () => {
  test('includes header, day blocks, and repo-tagged commits', () => {
    const out = renderMicroscope({
      username: 'alice',
      bundleName: 'browseros',
      window: '-7d',
      days: groupByDay(commits),
    })
    expect(out).toContain('microscope: alice')
    expect(out).toContain('browseros')
    expect(out).toContain('2026-04-17')
    expect(out).toContain('2026-04-16')
    expect(out).toContain('[main]')
    expect(out).toContain('[docs]')
    expect(out).toContain('fix: X')
    expect(out).toContain('+10/-2')
  })

  test('renders an empty state message when no days', () => {
    const out = renderMicroscope({
      username: 'alice',
      bundleName: 'browseros',
      window: '-7d',
      days: [],
    })
    expect(out).toContain('no commits')
  })
})

describe('buildMicroscopeReport', () => {
  test('builds a JSON-ready report object', () => {
    const days = groupByDay(commits)
    const r = buildMicroscopeReport({
      username: 'alice',
      bundleName: 'browseros',
      window: '-7d',
      days,
    })
    expect(r.bundle).toBe('browseros')
    expect(r.username).toBe('alice')
    expect(r.window).toBe('-7d')
    expect(r.days).toHaveLength(2)
    expect(r.days[0].commits[0]).toMatchObject({
      repo: 'main',
      sha: 'aaaaaaabbbbbbb',
      subject: 'fix: X',
    })
    expect(typeof r.generated_at).toBe('string')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd apps/cli && bun test src/microscope-output.test.ts
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `microscope-output.ts`**

Create `apps/cli/src/microscope-output.ts`:

```typescript
export interface MicroscopeCommit {
  repo: string
  sha: string
  subject: string
  insertions: number
  deletions: number
  date: Date
}

export interface MicroscopeDay {
  date: string
  commits: MicroscopeCommit[]
  totals: { commits: number; insertions: number; deletions: number }
}

export interface MicroscopeRenderOpts {
  username: string
  bundleName: string
  window: string
  days: MicroscopeDay[]
}

export function groupByDay(commits: MicroscopeCommit[]): MicroscopeDay[] {
  const buckets = new Map<string, MicroscopeCommit[]>()
  for (const c of commits) {
    const key = c.date.toISOString().slice(0, 10)
    const list = buckets.get(key) ?? []
    list.push(c)
    buckets.set(key, list)
  }
  const days: MicroscopeDay[] = []
  for (const [date, list] of buckets) {
    list.sort((a, b) => b.date.getTime() - a.date.getTime())
    const totals = list.reduce(
      (acc, c) => ({
        commits: acc.commits + 1,
        insertions: acc.insertions + c.insertions,
        deletions: acc.deletions + c.deletions,
      }),
      { commits: 0, insertions: 0, deletions: 0 },
    )
    days.push({ date, commits: list, totals })
  }
  days.sort((a, b) => (a.date < b.date ? 1 : -1))
  return days
}

export function renderMicroscope(opts: MicroscopeRenderOpts): string {
  const lines: string[] = []
  lines.push(`microscope: ${opts.username} — ${opts.bundleName} (${opts.window})`)
  lines.push('')
  if (opts.days.length === 0) {
    lines.push('(no commits in window)')
    return lines.join('\n')
  }
  for (const day of opts.days) {
    const weekday = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(
      'en-US',
      { weekday: 'short', timeZone: 'UTC' },
    )
    const t = day.totals
    lines.push(
      `=== ${day.date} (${weekday}) — ${t.commits} commit${t.commits === 1 ? '' : 's'}, +${t.insertions}/-${t.deletions} ===`,
    )
    for (const c of day.commits) {
      lines.push(
        `  [${c.repo}] ${c.sha.slice(0, 7)} ${c.subject} (+${c.insertions}/-${c.deletions})`,
      )
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

export interface MicroscopeReport {
  bundle: string
  username: string
  window: string
  generated_at: string
  days: Array<{
    date: string
    commits: Array<{
      repo: string
      sha: string
      subject: string
      insertions: number
      deletions: number
      date: string
    }>
    totals: { commits: number; insertions: number; deletions: number }
  }>
}

export function buildMicroscopeReport(
  opts: MicroscopeRenderOpts,
): MicroscopeReport {
  return {
    bundle: opts.bundleName,
    username: opts.username,
    window: opts.window,
    generated_at: new Date().toISOString(),
    days: opts.days.map((d) => ({
      date: d.date,
      commits: d.commits.map((c) => ({
        repo: c.repo,
        sha: c.sha,
        subject: c.subject,
        insertions: c.insertions,
        deletions: c.deletions,
        date: c.date.toISOString(),
      })),
      totals: d.totals,
    })),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/cli && bun test src/microscope-output.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/microscope-output.ts apps/cli/src/microscope-output.test.ts
git commit -m "feat(cli): add microscope-output module"
```

---

## Task 5: Extract and test `aggregateBundleResults`

**Files:**
- Create: `apps/cli/src/analyze-aggregate.ts`
- Create: `apps/cli/src/analyze-aggregate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/cli/src/analyze-aggregate.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import {
  aggregateBundleResults,
  type PerRepoScoredUnit,
} from './analyze-aggregate'

describe('aggregateBundleResults', () => {
  test('sums commits, prs, LOC, and scores across repos per author', () => {
    const units: PerRepoScoredUnit[] = [
      {
        author: 'alice',
        repoName: 'main',
        date: '2026-04-15',
        score: 0.5,
        commits: 2,
        isPr: false,
        insertions: 40,
        deletions: 10,
      },
      {
        author: 'alice',
        repoName: 'docs',
        date: '2026-04-16',
        score: 0.3,
        commits: 1,
        isPr: true,
        insertions: 20,
        deletions: 5,
      },
      {
        author: 'bob',
        repoName: 'main',
        date: '2026-04-15',
        score: 0.2,
        commits: 1,
        isPr: false,
        insertions: 10,
        deletions: 0,
      },
    ]

    const since = new Date('2026-04-14T00:00:00Z')
    const out = aggregateBundleResults(units, since, 7)

    const alice = out.find((a) => a.author === 'alice')!
    expect(alice.commits).toBe(3)
    expect(alice.prs).toBe(1)
    expect(alice.insertions).toBe(60)
    expect(alice.deletions).toBe(15)
    expect(alice.net).toBe(45)
    expect(alice.score).toBeGreaterThan(0)
    expect(alice.daily_scores.length).toBe(7)

    const bob = out.find((a) => a.author === 'bob')!
    expect(bob.commits).toBe(1)
    expect(bob.prs).toBe(0)
    expect(bob.insertions).toBe(10)
    expect(bob.deletions).toBe(0)

    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score)
  })

  test('returns empty array when no units', () => {
    expect(aggregateBundleResults([], new Date(), 7)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd apps/cli && bun test src/analyze-aggregate.test.ts
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `analyze-aggregate.ts`**

Create `apps/cli/src/analyze-aggregate.ts`:

```typescript
import { calculateAuthorScore, computeDailyScores } from './scoring'
import type { AuthorStats } from './types'

export interface PerRepoScoredUnit {
  author: string
  repoName: string
  date: string
  score: number
  commits: number
  isPr: boolean
  insertions: number
  deletions: number
}

interface AuthorBucket {
  scoredUnits: { date: string; score: number }[]
  commits: number
  prs: number
  insertions: number
  deletions: number
}

export function aggregateBundleResults(
  units: PerRepoScoredUnit[],
  since: Date,
  daysInWindow: number,
): AuthorStats[] {
  const buckets = new Map<string, AuthorBucket>()

  for (const u of units) {
    const b =
      buckets.get(u.author) ??
      {
        scoredUnits: [],
        commits: 0,
        prs: 0,
        insertions: 0,
        deletions: 0,
      }
    b.scoredUnits.push({ date: u.date, score: u.score })
    b.commits += u.commits
    if (u.isPr) b.prs += 1
    b.insertions += u.insertions
    b.deletions += u.deletions
    buckets.set(u.author, b)
  }

  const result: AuthorStats[] = [...buckets.entries()]
    .map(([author, b]) => ({
      author,
      commits: b.commits,
      prs: b.prs,
      insertions: b.insertions,
      deletions: b.deletions,
      net: b.insertions - b.deletions,
      score: calculateAuthorScore(
        b.scoredUnits.map((s) => s.score),
        daysInWindow,
      ),
      daily_scores: computeDailyScores(b.scoredUnits, since, daysInWindow),
    }))
    .sort((a, b) => b.score - a.score)

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/cli && bun test src/analyze-aggregate.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/analyze-aggregate.ts apps/cli/src/analyze-aggregate.test.ts
git commit -m "feat(cli): add aggregateBundleResults helper"
```

---

## Task 6: Rewrite `configure.ts` and update `index.ts`

**Files:**
- Modify: `apps/cli/src/commands/configure.ts`
- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Rewrite `configure.ts`**

Replace the entire contents of `apps/cli/src/commands/configure.ts` with:

```typescript
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import * as clack from '@clack/prompts'
import {
  addRepo,
  findRepoByPath,
  loadBundle,
  mergeEngineers,
  saveBundle,
} from '../bundle'
import { createConvexClient, ensureAuthors, ensureRepo } from '../convex-client'
import { getUniqueAuthors } from '../git/authors'
import { parseTimeWindow } from '../git/log'
import type { BundleConfig } from '../types'

export async function configure(
  configPath: string,
  repoPath: string,
  timeWindow: string,
): Promise<void> {
  const absoluteConfigPath = resolve(configPath)
  const absoluteRepoPath = resolve(repoPath)

  if (!existsSync(`${absoluteRepoPath}/.git`)) {
    console.error(`Not a git repository: ${absoluteRepoPath}`)
    process.exit(1)
  }

  clack.intro('auctor configure')

  const bundle = await getOrInitBundle(absoluteConfigPath)

  const since = parseTimeWindow(timeWindow)
  const authorInfos = await getUniqueAuthors(absoluteRepoPath, since)

  let selected: string[] = []
  if (authorInfos.length === 0) {
    clack.log.warn(
      `No authors found in ${timeWindow} window; skipping engineer prompt.`,
    )
  } else {
    const picked = await clack.multiselect({
      message: 'Select engineers to track (GitHub usernames):',
      options: authorInfos.map((a) => ({
        value: a.username,
        label: a.username === a.name ? a.username : `${a.username} (${a.name})`,
      })),
      initialValues: authorInfos
        .map((a) => a.username)
        .filter((u) => bundle.engineers.includes(u)),
      required: false,
    })
    if (clack.isCancel(picked)) {
      clack.cancel('Configuration cancelled.')
      process.exit(0)
    }
    selected = picked as string[]
  }

  const repoEntry = findRepoByPath(bundle, absoluteRepoPath) ?? {
    name: basename(absoluteRepoPath),
    path: absoluteRepoPath,
  }
  const withRepo = addRepo(bundle, repoEntry)
  const withEngineers = mergeEngineers(withRepo, selected)

  await saveBundle(absoluteConfigPath, withEngineers)

  if (withEngineers.convex_url) {
    try {
      const client = createConvexClient(withEngineers.convex_url)
      const bundleRepoId = await ensureRepo(client, withEngineers.name)
      const perRepoId = await ensureRepo(client, repoEntry.name)
      const engineersPayload = withEngineers.engineers.map((username) => ({
        username,
        whitelisted: true,
      }))
      await ensureAuthors(client, bundleRepoId, engineersPayload)
      await ensureAuthors(client, perRepoId, engineersPayload)
      clack.log.success('Synced to Convex')
      await client.close()
    } catch (err) {
      clack.log.warn(
        `Failed to sync to Convex: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  clack.outro(
    `Saved bundle ${withEngineers.name}: ${withEngineers.repos.length} repo(s), ${withEngineers.engineers.length} engineer(s)`,
  )
}

async function getOrInitBundle(configPath: string): Promise<BundleConfig> {
  if (existsSync(configPath)) {
    return loadBundle(configPath)
  }
  clack.log.info(`Creating new bundle at ${configPath}`)
  const defaultName = basename(configPath).replace(/\.ya?ml$/, '')
  const nameRes = await clack.text({
    message: 'Bundle name:',
    initialValue: defaultName,
    validate: (v) => (v.trim() ? undefined : 'Name is required'),
  })
  if (clack.isCancel(nameRes)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }
  const serverRes = await clack.text({
    message: 'Server URL (blank to skip):',
    placeholder: 'https://auctor-server.fly.dev',
    defaultValue: '',
  })
  if (clack.isCancel(serverRes)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }
  const convexRes = await clack.text({
    message: 'Convex URL (blank to skip):',
    placeholder: 'https://<deployment>.convex.cloud',
    defaultValue: '',
  })
  if (clack.isCancel(convexRes)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }
  const { mkdirSync } = await import('node:fs')
  mkdirSync(dirname(configPath), { recursive: true })
  return {
    name: (nameRes as string).trim(),
    ...((serverRes as string).trim()
      ? { server_url: (serverRes as string).trim() }
      : {}),
    ...((convexRes as string).trim()
      ? { convex_url: (convexRes as string).trim() }
      : {}),
    repos: [],
    engineers: [],
  }
}
```

- [ ] **Step 2: Update the `configure` command registration in `index.ts`**

Replace the `program.command('configure')` block in `apps/cli/src/index.ts` with:

```typescript
program
  .command('configure')
  .description('Add a repo to a bundle and refresh its engineer list')
  .argument('<config>', 'Path to bundle YAML file')
  .argument('<repo>', 'Path to git repository to add')
  .argument('<time-window>', 'Time window for author scan (e.g., -7d, -30d)')
  .action(
    async (configPath: string, repoPath: string, timeWindow: string) => {
      await configure(configPath, repoPath, timeWindow)
    },
  )
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck
```
Expected: exit 0. (analyze.ts still uses old `Config` import — that's fine, it's untouched in this task.)

- [ ] **Step 4: Run all tests**

Run:
```bash
cd apps/cli && bun test
```
Expected: existing tests pass; new bundle/microscope/aggregate tests pass.

- [ ] **Step 5: Smoke test configure against a tmp repo**

Run:
```bash
set -e
TMP=$(mktemp -d)
git init -q "$TMP"
git -C "$TMP" config user.email "t@t.com"
git -C "$TMP" config user.name "t"
echo hi > "$TMP/README.md"
git -C "$TMP" add -A
git -C "$TMP" commit -q -m "init"
# Dry run: just verify the CLI prints help without crashing
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4
bun apps/cli/src/index.ts configure --help
```
Expected: help output shows three required args `<config> <repo> <time-window>`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/configure.ts apps/cli/src/index.ts
git commit -m "feat(cli): rewrite configure command around bundle YAML"
```

---

## Task 7: Rewrite `analyze.ts` and update `index.ts`

**Files:**
- Modify: `apps/cli/src/commands/analyze.ts`
- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Replace `analyze.ts` contents**

Replace the entire contents of `apps/cli/src/commands/analyze.ts` with:

```typescript
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ConvexClient } from '@auctor/database/client'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import {
  DIFFICULTY_WEIGHTS,
  TYPE_WEIGHTS,
} from '@auctor/shared/scoring-weights'
import { aggregateBundleResults, type PerRepoScoredUnit } from '../analyze-aggregate'
import { classifyWorkUnits } from '../api-client'
import { loadBundle } from '../bundle'
import {
  buildWorkUnitPayload,
  createConvexClient,
  ensureAuthors,
  ensureRepo,
  findExistingWorkUnit,
  insertAnalysisRun,
  insertWorkUnit,
} from '../convex-client'
import { getDiffForCommits } from '../git/diff'
import {
  getGitLog,
  getMergeCommits,
  parseGitLog,
  parseTimeWindow,
} from '../git/log'
import { extractBranchDayUnits, extractPrUnits } from '../git/work-units'
import { renderLeaderboard, renderSparklines } from '../output'
import {
  calculateLocFactor,
  calculateUnitScore,
} from '../scoring'
import type { BundleConfig, BundleRepo } from '../types'

export async function analyze(
  configPath: string,
  timeWindow: string,
  jsonPath?: string,
): Promise<void> {
  const absoluteConfigPath = resolve(configPath)
  const bundle = await loadBundle(absoluteConfigPath)

  const validRepos = bundle.repos.filter((r) => {
    if (!existsSync(`${r.path}/.git`)) {
      console.warn(`Skipping ${r.name}: ${r.path} is not a git repo`)
      return false
    }
    return true
  })
  if (validRepos.length === 0) {
    console.error('No valid repos in bundle.')
    process.exit(1)
  }
  if (bundle.engineers.length === 0) {
    console.error('No engineers in bundle. Run `auctor configure` first.')
    process.exit(1)
  }

  const since = parseTimeWindow(timeWindow)
  const daysMatch = timeWindow.match(/^-?(\d+)d$/)
  const daysInWindow = daysMatch ? Number.parseInt(daysMatch[1], 10) : 7

  let convexClient: ConvexClient | null = null
  let bundleRepoId: string | null = null
  let bundleAuthorIdMap = new Map<string, string>()
  if (bundle.convex_url) {
    try {
      convexClient = createConvexClient(bundle.convex_url)
      bundleRepoId = await ensureRepo(convexClient, bundle.name)
      bundleAuthorIdMap = await ensureAuthors(
        convexClient,
        bundleRepoId,
        bundle.engineers.map((username) => ({ username, whitelisted: true })),
      )
    } catch (err) {
      console.warn(
        'Warning: Convex initialization failed, continuing without cache.',
        err,
      )
      convexClient = null
      bundleRepoId = null
      bundleAuthorIdMap = new Map()
    }
  }

  const allScoredUnits: PerRepoScoredUnit[] = []
  for (const repo of validRepos) {
    const units = await analyzeSingleRepo(
      repo,
      bundle,
      since,
      convexClient,
    )
    allScoredUnits.push(...units)
  }

  const leaderboard = aggregateBundleResults(allScoredUnits, since, daysInWindow)

  if (convexClient && bundleRepoId) {
    try {
      await insertAnalysisRun(convexClient, {
        repoId: bundleRepoId,
        timeWindow,
        analyzedAt: new Date().toISOString(),
        daysInWindow,
        authorScores: leaderboard.map((s) => ({
          authorId: bundleAuthorIdMap.get(s.author) ?? '',
          username: s.author,
          commits: s.commits,
          locAdded: s.insertions,
          locRemoved: s.deletions,
          locNet: s.net,
          score: s.score,
        })),
      })
    } catch (err) {
      console.warn('Warning: Failed to upload analysis run.', err)
    }
  }

  console.log(`\n${bundle.name} (${validRepos.length} repo${validRepos.length === 1 ? '' : 's'})`)
  console.log(renderLeaderboard(leaderboard))
  console.log(renderSparklines(leaderboard))

  const resultsDir = join(dirname(absoluteConfigPath), '.results')
  mkdirSync(resultsDir, { recursive: true })
  const resultPath = join(resultsDir, `${bundle.name}.json`)
  const result = {
    bundle: bundle.name,
    repos: validRepos.map((r) => r.name),
    window: timeWindow,
    analyzed_at: new Date().toISOString(),
    authors: leaderboard.map((s) => ({
      name: s.author,
      score: s.score,
      commits: s.commits,
      prs: s.prs,
      loc_added: s.insertions,
      loc_removed: s.deletions,
      loc_net: s.net,
      daily_scores: s.daily_scores,
    })),
  }
  await Bun.write(resultPath, JSON.stringify(result, null, 2))
  console.log(`\nResults written to ${resultPath}`)

  if (jsonPath) {
    const reportPath = resolve(jsonPath)
    mkdirSync(dirname(reportPath), { recursive: true })
    const report = {
      repo: bundle.name,
      generated_at: new Date().toISOString(),
      window_days: daysInWindow,
      authors: leaderboard.map((s) => ({
        author: s.author,
        commits: s.commits,
        prs: s.prs,
        insertions: s.insertions,
        deletions: s.deletions,
        net: s.net,
        score: Number(s.score.toFixed(4)),
      })),
    }
    await Bun.write(reportPath, JSON.stringify(report, null, 2))
    console.log(`Report written to ${reportPath}`)
  }

  if (convexClient) await convexClient.close()
}

async function analyzeSingleRepo(
  repo: BundleRepo,
  bundle: BundleConfig,
  since: Date,
  convexClient: ConvexClient | null,
): Promise<PerRepoScoredUnit[]> {
  let repoId: string | null = null
  let authorIdMap = new Map<string, string>()
  if (convexClient) {
    try {
      repoId = await ensureRepo(convexClient, repo.name)
      authorIdMap = await ensureAuthors(
        convexClient,
        repoId,
        bundle.engineers.map((username) => ({ username, whitelisted: true })),
      )
    } catch (err) {
      console.warn(`Warning: Convex init for ${repo.name} failed.`, err)
    }
  }

  const [logOutput, mergeShas] = await Promise.all([
    getGitLog(repo.path, since),
    getMergeCommits(repo.path, since),
  ])
  let commits = parseGitLog(logOutput)
  for (const commit of commits) {
    commit.isMerge = mergeShas.has(commit.sha)
  }
  const engineerSet = new Set(bundle.engineers)
  commits = commits.filter((c) => engineerSet.has(c.author))
  if (commits.length === 0) return []

  const branchDayUnits = extractBranchDayUnits(commits, 'main')
  const prUnits = extractPrUnits(commits)
  const shellUnits = [...branchDayUnits, ...prUnits]

  const hydratedUnits: WorkUnit[] = await Promise.all(
    shellUnits.map(async (unit) => {
      const diff = await getDiffForCommits(repo.path, unit.commit_shas)
      return { ...unit, diff }
    }),
  )

  const classificationMap = new Map<string, Classification>()
  const cachedIds = new Set<string>()
  let uncachedUnits = hydratedUnits
  if (convexClient && repoId) {
    for (const unit of hydratedUnits) {
      const authorId = authorIdMap.get(unit.author)
      if (!authorId) continue
      try {
        const unitType = unit.kind === 'branch-day' ? 'branch_day' : unit.kind
        const cached = await findExistingWorkUnit(
          convexClient,
          repoId,
          authorId,
          unit.date,
          unitType as 'pr' | 'branch_day',
          unit.branch,
        )
        if (cached) {
          cachedIds.add(unit.id)
          classificationMap.set(unit.id, {
            type: cached.classificationType,
            difficulty: cached.difficultyLevel,
            impact_score: cached.impactScore,
            reasoning: cached.reasoning,
          })
        }
      } catch {
        // skip cache check on error
      }
    }
    if (cachedIds.size > 0) {
      console.log(`[${repo.name}] Skipping ${cachedIds.size} cached work unit(s).`)
      uncachedUnits = hydratedUnits.filter((u) => !cachedIds.has(u.id))
    }
  }

  if (bundle.server_url && uncachedUnits.length > 0) {
    const repoUrl = repo.repo_url ?? repo.path
    const response = await classifyWorkUnits(
      bundle.server_url,
      repoUrl,
      uncachedUnits,
    )
    for (const item of response.classifications) {
      classificationMap.set(item.id, item.classification)
    }
  } else if (!bundle.server_url) {
    for (const unit of uncachedUnits) {
      classificationMap.set(unit.id, {
        type: 'feature',
        difficulty: 'medium',
        impact_score: 5,
        reasoning: 'default classification',
      })
    }
  }

  const scored: PerRepoScoredUnit[] = []
  for (const unit of hydratedUnits) {
    const classification = classificationMap.get(unit.id)
    if (!classification) continue
    const unitScore = calculateUnitScore({
      net_loc: unit.net,
      difficulty: classification.difficulty,
      type: classification.type,
      impact_score: classification.impact_score,
    })

    if (convexClient && repoId && !cachedIds.has(unit.id)) {
      const authorId = authorIdMap.get(unit.author)
      if (authorId) {
        try {
          const locFactor = calculateLocFactor(unit.net)
          const formulaScore =
            locFactor * DIFFICULTY_WEIGHTS[classification.difficulty]
          const aiScore = classification.impact_score / 10
          const payload = buildWorkUnitPayload({
            workUnit: unit,
            repoId,
            authorId,
            classification,
            locFactor,
            formulaScore,
            aiScore,
            typeWeight: TYPE_WEIGHTS[classification.type],
            difficultyWeight: DIFFICULTY_WEIGHTS[classification.difficulty],
            unitScore,
          })
          await insertWorkUnit(convexClient, payload)
        } catch (err) {
          console.warn(
            `Warning: Failed to upload work unit ${unit.id}.`,
            err,
          )
        }
      }
    }

    scored.push({
      author: unit.author,
      repoName: repo.name,
      date: unit.date,
      score: unitScore,
      commits: unit.commit_shas.length,
      isPr: unit.kind === 'pr',
      insertions: unit.insertions,
      deletions: unit.deletions,
    })
  }

  return scored
}
```

- [ ] **Step 2: Update the `analyze` command registration in `index.ts`**

Replace the `program.command('analyze')` block in `apps/cli/src/index.ts` with:

```typescript
program
  .command('analyze')
  .description('Analyze a bundle: one leaderboard across all repos in the bundle')
  .argument('<config>', 'Path to bundle YAML file')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d, 0d)')
  .option('--json <file>', 'Write RepoReport JSON to file')
  .action(
    async (
      configPath: string,
      timeWindow: string,
      opts: { json?: string },
    ) => {
      await analyze(configPath, timeWindow, opts.json)
    },
  )
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Run all tests**

Run:
```bash
cd apps/cli && bun test
```
Expected: all tests pass.

- [ ] **Step 5: Smoke test analyze help**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun apps/cli/src/index.ts analyze --help
```
Expected: help shows `<config> <time-window>` with `--json` option.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/analyze.ts apps/cli/src/index.ts
git commit -m "feat(cli): rewrite analyze around bundle YAML with combined leaderboard"
```

---

## Task 8: Implement `microscope` command

**Files:**
- Create: `apps/cli/src/commands/microscope.ts`
- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Implement `microscope.ts`**

Create `apps/cli/src/commands/microscope.ts`:

```typescript
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import * as clack from '@clack/prompts'
import fuzzysort from 'fuzzysort'
import { loadBundle } from '../bundle'
import { getDiffForCommits } from '../git/diff'
import { getGitLog, parseGitLog, parseTimeWindow } from '../git/log'
import {
  buildMicroscopeReport,
  groupByDay,
  renderMicroscope,
  type MicroscopeCommit,
} from '../microscope-output'

export async function microscope(
  configPath: string,
  timeWindow: string,
): Promise<void> {
  const absoluteConfigPath = resolve(configPath)
  const bundle = await loadBundle(absoluteConfigPath)

  if (bundle.engineers.length === 0) {
    console.error('No engineers in bundle. Run `auctor configure` first.')
    process.exit(1)
  }

  clack.intro('auctor microscope')
  const username = await pickEngineer(bundle.engineers)
  if (!username) {
    clack.cancel('No engineer selected.')
    process.exit(0)
  }

  const since = parseTimeWindow(timeWindow)
  const commits: MicroscopeCommit[] = []
  for (const repo of bundle.repos) {
    if (!existsSync(`${repo.path}/.git`)) {
      clack.log.warn(`Skipping ${repo.name}: path not found`)
      continue
    }
    const log = await getGitLog(repo.path, since)
    const parsed = parseGitLog(log).filter((c) => c.author === username)
    for (const c of parsed) {
      const diff = await getDiffForCommits(repo.path, [c.sha])
      commits.push({
        repo: repo.name,
        sha: c.sha,
        subject: c.subject,
        insertions: diff.insertions,
        deletions: diff.deletions,
        date: c.date,
      })
    }
  }

  const days = groupByDay(commits)
  const output = renderMicroscope({
    username,
    bundleName: bundle.name,
    window: timeWindow,
    days,
  })
  clack.outro(`${commits.length} commit(s) across ${bundle.repos.length} repo(s)`)
  console.log(`\n${output}`)

  const resultsDir = join(dirname(absoluteConfigPath), '.results')
  mkdirSync(resultsDir, { recursive: true })
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*/, '')
    .replace('T', '-')
  const reportPath = join(
    resultsDir,
    `${bundle.name}-microscope-${username}-${stamp}.json`,
  )
  const report = buildMicroscopeReport({
    username,
    bundleName: bundle.name,
    window: timeWindow,
    days,
  })
  await Bun.write(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport written to ${reportPath}`)
}

async function pickEngineer(engineers: string[]): Promise<string | null> {
  if (engineers.length <= 20) {
    const res = await clack.select({
      message: 'Pick engineer:',
      options: engineers.map((e) => ({ value: e, label: e })),
    })
    if (clack.isCancel(res)) return null
    return res as string
  }
  const query = await clack.text({
    message: 'Search engineer (type a prefix):',
    placeholder: '',
  })
  if (clack.isCancel(query)) return null
  const matches = fuzzysort.go(query as string, engineers, { limit: 10 })
  const top = matches.length > 0 ? matches.map((m) => m.target) : engineers.slice(0, 10)
  const res = await clack.select({
    message: 'Pick engineer:',
    options: top.map((e) => ({ value: e, label: e })),
  })
  if (clack.isCancel(res)) return null
  return res as string
}
```

- [ ] **Step 2: Register `microscope` in `index.ts`**

Edit `apps/cli/src/index.ts`. Add import at the top (next to the other command imports):

```typescript
import { microscope } from './commands/microscope'
```

Add a new command block after the `analyze` block, before `program.parse()`:

```typescript
program
  .command('microscope')
  .description('Zoom into one engineer across a bundle, grouped by day')
  .argument('<config>', 'Path to bundle YAML file')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d)')
  .action(async (configPath: string, timeWindow: string) => {
    await microscope(configPath, timeWindow)
  })
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Run all tests**

Run:
```bash
cd apps/cli && bun test
```
Expected: all tests pass.

- [ ] **Step 5: Smoke test microscope help**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun apps/cli/src/index.ts microscope --help
```
Expected: help shows `<config> <time-window>`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/microscope.ts apps/cli/src/index.ts
git commit -m "feat(cli): add microscope command for per-engineer per-day breakdown"
```

---

## Task 9: Cleanup — remove old `Config` type, add `configs/.gitkeep`, update `.gitignore`

**Files:**
- Modify: `apps/cli/src/types.ts`
- Create: `configs/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Remove the old `Config` interface**

Edit `apps/cli/src/types.ts`. Remove the `Config` interface:

Delete this block:
```typescript
export interface Config {
  authors: string[]
  server_url?: string
  repo_url?: string
  convex_url?: string
}
```

- [ ] **Step 2: Create `configs/.gitkeep`**

Run:
```bash
mkdir -p /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/configs
touch /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/configs/.gitkeep
```

- [ ] **Step 3: Update `.gitignore`**

Open `.gitignore` at repo root. Append:

```
# Auctor bundle run results (generated)
configs/.results/
```

- [ ] **Step 4: Typecheck**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck
```
Expected: exit 0 (no remaining references to `Config`).

- [ ] **Step 5: Run full test suite and lint**

Run:
```bash
cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck && cd apps/cli && bun test && cd ../.. && bun run lint
```
Expected: exit 0.

- [ ] **Step 6: End-to-end smoke test against a real tmp bundle**

Run:
```bash
set -e
ROOT=/Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4
TMP=$(mktemp -d)
git init -q "$TMP/repo1"
git -C "$TMP/repo1" config user.email "alice@users.noreply.github.com"
git -C "$TMP/repo1" config user.name "alice"
echo one > "$TMP/repo1/a.txt"
git -C "$TMP/repo1" add -A
git -C "$TMP/repo1" commit -q -m "feat: initial"
echo two > "$TMP/repo1/a.txt"
git -C "$TMP/repo1" add -A
git -C "$TMP/repo1" commit -q -m "fix: tweak"
# Build a bundle YAML by hand (skip interactive init)
mkdir -p "$TMP/configs"
cat > "$TMP/configs/smoke.yaml" <<EOF
name: smoke
repos:
  - name: repo1
    path: $TMP/repo1
engineers:
  - alice
EOF
cd "$ROOT"
bun apps/cli/src/index.ts analyze "$TMP/configs/smoke.yaml" -7d
```
Expected: prints a single combined leaderboard titled `smoke (1 repo)` with alice listed and a score > 0. Writes `$TMP/configs/.results/smoke.json`.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/types.ts configs/.gitkeep .gitignore
git commit -m "chore(cli): remove old Config type, add configs/ scaffolding"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Config format (YAML schema, fields): Tasks 2, 3
- ✅ `configs/` layout and `.gitignore`: Task 9
- ✅ `auctor configure <config> <repo> <window>`: Task 6
- ✅ `auctor analyze <config> <window>` combined leaderboard: Task 7
- ✅ `auctor microscope <config> <window>` with fuzzy engineer pick: Task 8
- ✅ Bundle-level + per-repo Convex doc pattern: Tasks 6, 7
- ✅ Removing `.auctor.json`: Task 6 (rewrite drops it) + Task 9 (removes `Config` type)
- ✅ Error cases (missing repo, no engineers): Tasks 6, 7, 8
- ✅ JSON report paths (`configs/.results/...`): Tasks 7, 8
- ✅ Testing strategy (bundle, microscope-output, aggregate unit tests + smoke e2e): Tasks 3, 4, 5, 9

**Type consistency check:**
- `BundleConfig` / `BundleRepo` introduced in Task 2; used consistently in Tasks 3, 6, 7, 8. ✅
- `PerRepoScoredUnit` defined in Task 5; consumed in Task 7. ✅
- `MicroscopeCommit` defined in Task 4; produced in Task 8. ✅
- Function names (`loadBundle`, `saveBundle`, `addRepo`, `mergeEngineers`, `findRepoByPath`, `aggregateBundleResults`, `groupByDay`, `renderMicroscope`, `buildMicroscopeReport`) match across their defining task and their usage. ✅

**Placeholder scan:** No TBDs, no "handle edge cases", no "similar to Task N" references. Every code step contains full code. ✅
