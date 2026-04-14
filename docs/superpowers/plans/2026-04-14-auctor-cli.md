# Auctor CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript CLI that analyzes git history and produces per-engineer productivity leaderboards.

**Architecture:** Two commands (`auctor configure` and `auctor analyze`) backed by git log parsing via `Bun.spawn`, interactive author whitelisting via @clack/prompts, and table output via cli-table3. All data stays local — config in `.auctor.json` per repo, no backend.

**Tech Stack:** Bun, TypeScript, Commander, @clack/prompts, cli-table3

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/cli/package.json` | Package metadata, bin entry, dependencies |
| `apps/cli/tsconfig.json` | TypeScript config extending root |
| `apps/cli/src/types.ts` | `Config`, `Commit`, `AuthorStats` interfaces |
| `apps/cli/src/git/log.ts` | `parseTimeWindow`, `parseGitLog`, `getGitLog`, `getMergeCommits` |
| `apps/cli/src/git/log.test.ts` | Tests for git log parsing and time window parsing |
| `apps/cli/src/git/authors.ts` | `getUniqueAuthors` — extract unique author names from git |
| `apps/cli/src/scoring.ts` | `calculateScore` — placeholder weighted formula |
| `apps/cli/src/scoring.test.ts` | Tests for scoring |
| `apps/cli/src/output.ts` | `renderLeaderboard` — format AuthorStats[] as terminal table |
| `apps/cli/src/output.test.ts` | Tests for table rendering |
| `apps/cli/src/commands/configure.ts` | `configure()` — interactive author whitelisting flow |
| `apps/cli/src/commands/analyze.ts` | `analyze()` — git analysis and leaderboard output |
| `apps/cli/src/index.ts` | CLI entry point — Commander program with both commands |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@auctor/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "auctor": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "commander": "^13.0.0",
    "@clack/prompts": "^0.10.0",
    "cli-table3": "^0.6.5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create types.ts**

```typescript
export interface Config {
  authors: string[]
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

- [ ] **Step 4: Install dependencies**

Run: `cd apps/cli && bun install`

Expected: lockfile updates, `node_modules` created

- [ ] **Step 5: Commit**

```bash
git add apps/cli/package.json apps/cli/tsconfig.json apps/cli/src/types.ts bun.lock
git commit -m "feat(cli): scaffold auctor CLI package with types"
```

---

### Task 2: Time Window Parsing

**Files:**
- Create: `apps/cli/src/git/log.ts` (partial — just `parseTimeWindow`)
- Create: `apps/cli/src/git/log.test.ts` (partial — just time window tests)

- [ ] **Step 1: Write failing tests for parseTimeWindow**

Create `apps/cli/src/git/log.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { parseTimeWindow } from './log'

describe('parseTimeWindow', () => {
  test('parses -7d as 7 days ago', () => {
    const result = parseTimeWindow('-7d')
    const expected = new Date()
    expected.setDate(expected.getDate() - 7)
    expected.setHours(0, 0, 0, 0)
    expect(result.getTime()).toBe(expected.getTime())
  })

  test('parses -30d as 30 days ago', () => {
    const result = parseTimeWindow('-30d')
    const expected = new Date()
    expected.setDate(expected.getDate() - 30)
    expected.setHours(0, 0, 0, 0)
    expect(result.getTime()).toBe(expected.getTime())
  })

  test('parses 0d as start of today', () => {
    const result = parseTimeWindow('0d')
    const expected = new Date()
    expected.setHours(0, 0, 0, 0)
    expect(result.getTime()).toBe(expected.getTime())
  })

  test('parses 7d without minus sign', () => {
    const result = parseTimeWindow('7d')
    const expected = new Date()
    expected.setDate(expected.getDate() - 7)
    expected.setHours(0, 0, 0, 0)
    expect(result.getTime()).toBe(expected.getTime())
  })

  test('throws on invalid format', () => {
    expect(() => parseTimeWindow('abc')).toThrow('Invalid time window')
    expect(() => parseTimeWindow('7')).toThrow('Invalid time window')
    expect(() => parseTimeWindow('-7w')).toThrow('Invalid time window')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/cli && bun test src/git/log.test.ts`

Expected: FAIL — `parseTimeWindow` not found

- [ ] **Step 3: Implement parseTimeWindow**

Create `apps/cli/src/git/log.ts`:

```typescript
export function parseTimeWindow(window: string): Date {
  const match = window.match(/^-?(\d+)d$/)
  if (!match) {
    throw new Error(
      `Invalid time window: ${window}. Expected format: -7d, -30d, 0d`
    )
  }
  const days = parseInt(match[1])
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(0, 0, 0, 0)
  return date
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && bun test src/git/log.test.ts`

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/git/log.ts apps/cli/src/git/log.test.ts
git commit -m "feat(cli): add time window parsing with tests"
```

---

### Task 3: Git Log Parsing

**Files:**
- Modify: `apps/cli/src/git/log.ts` (add `parseGitLog`)
- Modify: `apps/cli/src/git/log.test.ts` (add parsing tests)

- [ ] **Step 1: Write failing tests for parseGitLog**

Add to `apps/cli/src/git/log.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { parseTimeWindow, parseGitLog } from './log'

describe('parseGitLog', () => {
  test('parses a single commit with stats', () => {
    const output = `COMMIT_START
abc123def
Alice
2026-04-10T14:30:00-07:00
feat: add user auth

 3 files changed, 45 insertions(+), 12 deletions(-)`

    const commits = parseGitLog(output)
    expect(commits).toHaveLength(1)
    expect(commits[0].sha).toBe('abc123def')
    expect(commits[0].author).toBe('Alice')
    expect(commits[0].subject).toBe('feat: add user auth')
    expect(commits[0].insertions).toBe(45)
    expect(commits[0].deletions).toBe(12)
    expect(commits[0].isMerge).toBe(false)
  })

  test('parses multiple commits', () => {
    const output = `COMMIT_START
abc123
Alice
2026-04-10T14:30:00-07:00
feat: add auth

 2 files changed, 45 insertions(+), 12 deletions(-)
COMMIT_START
def456
Bob
2026-04-09T10:00:00-07:00
fix: typo

 1 file changed, 1 insertion(+), 1 deletion(-)`

    const commits = parseGitLog(output)
    expect(commits).toHaveLength(2)
    expect(commits[0].author).toBe('Alice')
    expect(commits[1].author).toBe('Bob')
    expect(commits[1].insertions).toBe(1)
    expect(commits[1].deletions).toBe(1)
  })

  test('handles commit with no stat line (no file changes)', () => {
    const output = `COMMIT_START
abc123
Alice
2026-04-10T14:30:00-07:00
Merge branch 'main'`

    const commits = parseGitLog(output)
    expect(commits).toHaveLength(1)
    expect(commits[0].insertions).toBe(0)
    expect(commits[0].deletions).toBe(0)
  })

  test('handles insertions only (no deletions)', () => {
    const output = `COMMIT_START
abc123
Alice
2026-04-10T14:30:00-07:00
feat: new file

 1 file changed, 50 insertions(+)`

    const commits = parseGitLog(output)
    expect(commits[0].insertions).toBe(50)
    expect(commits[0].deletions).toBe(0)
  })

  test('returns empty array for empty output', () => {
    expect(parseGitLog('')).toEqual([])
    expect(parseGitLog('  \n  ')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/cli && bun test src/git/log.test.ts`

Expected: FAIL — `parseGitLog` not exported

- [ ] **Step 3: Implement parseGitLog**

Add to `apps/cli/src/git/log.ts`:

```typescript
import type { Commit } from '../types'

export function parseGitLog(output: string): Commit[] {
  const blocks = output.split('COMMIT_START').filter((b) => b.trim())
  return blocks.map((block) => {
    const lines = block
      .trim()
      .split('\n')
      .filter((l) => l !== '')
    const sha = lines[0]
    const author = lines[1]
    const date = new Date(lines[2])
    const subject = lines[3]

    let insertions = 0
    let deletions = 0

    for (let i = 4; i < lines.length; i++) {
      const line = lines[i]
      const insertMatch = line.match(/(\d+) insertion/)
      const deleteMatch = line.match(/(\d+) deletion/)
      if (insertMatch) insertions = parseInt(insertMatch[1])
      if (deleteMatch) deletions = parseInt(deleteMatch[1])
    }

    return { sha, author, date, subject, insertions, deletions, isMerge: false }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && bun test src/git/log.test.ts`

Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/git/log.ts apps/cli/src/git/log.test.ts
git commit -m "feat(cli): add git log parsing with tests"
```

---

### Task 4: Git Commands (getGitLog, getMergeCommits, getUniqueAuthors)

**Files:**
- Modify: `apps/cli/src/git/log.ts` (add `getGitLog`, `getMergeCommits`)
- Create: `apps/cli/src/git/authors.ts`

These are thin wrappers around `Bun.spawn` — no unit tests, tested via manual integration later.

- [ ] **Step 1: Add getGitLog and getMergeCommits to log.ts**

Add to `apps/cli/src/git/log.ts`:

```typescript
export async function getGitLog(
  repoPath: string,
  since: Date
): Promise<string> {
  const proc = Bun.spawn(
    [
      'git',
      'log',
      '--all',
      '--shortstat',
      '--format=COMMIT_START%n%H%n%an%n%aI%n%s',
      `--since=${since.toISOString()}`,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' }
  )
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git log failed: ${stderr}`)
  }
  return output
}

export async function getMergeCommits(
  repoPath: string,
  since: Date
): Promise<Set<string>> {
  const proc = Bun.spawn(
    [
      'git',
      'log',
      '--all',
      '--merges',
      '--format=%H',
      `--since=${since.toISOString()}`,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' }
  )
  const output = await new Response(proc.stdout).text()
  await proc.exited
  return new Set(
    output
      .trim()
      .split('\n')
      .filter(Boolean)
  )
}
```

- [ ] **Step 2: Create authors.ts**

Create `apps/cli/src/git/authors.ts`:

```typescript
export async function getUniqueAuthors(
  repoPath: string,
  since: Date
): Promise<string[]> {
  const proc = Bun.spawn(
    [
      'git',
      'log',
      '--all',
      '--format=%an',
      `--since=${since.toISOString()}`,
    ],
    { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' }
  )
  const output = await new Response(proc.stdout).text()
  await proc.exited
  const authors = [
    ...new Set(
      output
        .trim()
        .split('\n')
        .filter(Boolean)
    ),
  ]
  return authors.sort()
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/git/log.ts apps/cli/src/git/authors.ts
git commit -m "feat(cli): add git log, merge commit, and author extraction"
```

---

### Task 5: Scoring

**Files:**
- Create: `apps/cli/src/scoring.ts`
- Create: `apps/cli/src/scoring.test.ts`

- [ ] **Step 1: Write failing tests for calculateScore**

Create `apps/cli/src/scoring.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { calculateScore } from './scoring'

describe('calculateScore', () => {
  test('returns 0 for zero activity', () => {
    const score = calculateScore({
      author: 'alice',
      commits: 0,
      prs: 0,
      insertions: 0,
      deletions: 0,
      net: 0,
    })
    expect(score).toBe(0)
  })

  test('scores a moderately active engineer', () => {
    const score = calculateScore({
      author: 'alice',
      commits: 10,
      prs: 2,
      insertions: 500,
      deletions: 100,
      net: 400,
    })
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('caps at 1.0 for very high activity', () => {
    const score = calculateScore({
      author: 'alice',
      commits: 100,
      prs: 20,
      insertions: 10000,
      deletions: 1000,
      net: 9000,
    })
    expect(score).toBeLessThanOrEqual(1)
  })

  test('higher activity produces higher score', () => {
    const low = calculateScore({
      author: 'alice',
      commits: 2,
      prs: 0,
      insertions: 50,
      deletions: 10,
      net: 40,
    })
    const high = calculateScore({
      author: 'bob',
      commits: 15,
      prs: 4,
      insertions: 1500,
      deletions: 300,
      net: 1200,
    })
    expect(high).toBeGreaterThan(low)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/cli && bun test src/scoring.test.ts`

Expected: FAIL — `calculateScore` not found

- [ ] **Step 3: Implement calculateScore**

Create `apps/cli/src/scoring.ts`:

```typescript
import type { AuthorStats } from './types'

export function calculateScore(
  stats: Omit<AuthorStats, 'score'>
): number {
  const commitWeight = 0.3
  const prWeight = 0.2
  const locWeight = 0.5

  const commitScore = Math.min(stats.commits / 20, 1)
  const prScore = Math.min(stats.prs / 5, 1)
  const locScore = Math.min(Math.max(stats.net, 0) / 2000, 1)

  const raw =
    commitScore * commitWeight +
    prScore * prWeight +
    locScore * locWeight

  return Math.round(raw * 100) / 100
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && bun test src/scoring.test.ts`

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/scoring.ts apps/cli/src/scoring.test.ts
git commit -m "feat(cli): add scoring formula with tests"
```

---

### Task 6: Output Rendering

**Files:**
- Create: `apps/cli/src/output.ts`
- Create: `apps/cli/src/output.test.ts`

- [ ] **Step 1: Write failing tests for renderLeaderboard**

Create `apps/cli/src/output.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { renderLeaderboard } from './output'
import type { AuthorStats } from './types'

describe('renderLeaderboard', () => {
  test('renders a table with author stats', () => {
    const stats: AuthorStats[] = [
      {
        author: 'alice',
        commits: 12,
        prs: 3,
        insertions: 1240,
        deletions: 380,
        net: 860,
        score: 0.82,
      },
      {
        author: 'bob',
        commits: 8,
        prs: 2,
        insertions: 650,
        deletions: 120,
        net: 530,
        score: 0.61,
      },
    ]

    const output = renderLeaderboard(stats)
    expect(output).toContain('alice')
    expect(output).toContain('bob')
    expect(output).toContain('Rank')
    expect(output).toContain('Author')
    expect(output).toContain('Commits')
    expect(output).toContain('PRs')
    expect(output).toContain('Score')
    expect(output).toContain('0.82')
    expect(output).toContain('0.61')
  })

  test('renders empty table when no stats', () => {
    const output = renderLeaderboard([])
    expect(output).toContain('Rank')
    expect(output).not.toContain('alice')
  })

  test('ranks are sequential starting at 1', () => {
    const stats: AuthorStats[] = [
      { author: 'a', commits: 1, prs: 0, insertions: 10, deletions: 0, net: 10, score: 0.5 },
      { author: 'b', commits: 1, prs: 0, insertions: 5, deletions: 0, net: 5, score: 0.3 },
    ]
    const output = renderLeaderboard(stats)
    const lines = output.split('\n')
    const dataLines = lines.filter((l) => l.includes('│') && !l.includes('Rank'))
    expect(dataLines[0]).toContain('1')
    expect(dataLines[1]).toContain('2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/cli && bun test src/output.test.ts`

Expected: FAIL — `renderLeaderboard` not found

- [ ] **Step 3: Implement renderLeaderboard**

Create `apps/cli/src/output.ts`:

```typescript
import Table from 'cli-table3'
import type { AuthorStats } from './types'

export function renderLeaderboard(stats: AuthorStats[]): string {
  const table = new Table({
    head: ['Rank', 'Author', 'Commits', 'PRs', '+LOC', '-LOC', 'Net', 'Score'],
    colAligns: [
      'right',
      'left',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
    ],
  })

  for (let i = 0; i < stats.length; i++) {
    const s = stats[i]
    table.push([
      i + 1,
      s.author,
      s.commits,
      s.prs,
      s.insertions.toLocaleString(),
      s.deletions.toLocaleString(),
      s.net.toLocaleString(),
      s.score.toFixed(2),
    ])
  }

  return table.toString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && bun test src/output.test.ts`

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/output.ts apps/cli/src/output.test.ts
git commit -m "feat(cli): add leaderboard table rendering with tests"
```

---

### Task 7: Configure Command

**Files:**
- Create: `apps/cli/src/commands/configure.ts`

No unit test — this is interactive (prompts user input). Tested manually in Task 9.

- [ ] **Step 1: Implement configure command**

Create `apps/cli/src/commands/configure.ts`:

```typescript
import { resolve, join } from 'path'
import { existsSync } from 'fs'
import * as clack from '@clack/prompts'
import { getUniqueAuthors } from '../git/authors'
import { parseTimeWindow } from '../git/log'
import type { Config } from '../types'

export async function configure(
  timeWindow: string,
  path: string
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
  let existingAuthors: string[] = []
  if (existsSync(configPath)) {
    const existing: Config = JSON.parse(
      await Bun.file(configPath).text()
    )
    existingAuthors = existing.authors
  }

  clack.intro('auctor configure')

  const selected = await clack.multiselect({
    message: 'Select authors to track:',
    options: authors.map((a) => ({
      value: a,
      label: a,
    })),
    initialValues: existingAuthors.filter((a) => authors.includes(a)),
  })

  if (clack.isCancel(selected)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }

  const config: Config = { authors: selected as string[] }
  await Bun.write(configPath, JSON.stringify(config, null, 2))

  clack.outro(`Saved ${config.authors.length} authors to .auctor.json`)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/commands/configure.ts
git commit -m "feat(cli): add configure command with interactive author selector"
```

---

### Task 8: Analyze Command

**Files:**
- Create: `apps/cli/src/commands/analyze.ts`

No unit test — orchestration logic. Core logic (parsing, scoring, output) is already tested. Tested manually in Task 9.

- [ ] **Step 1: Implement analyze command**

Create `apps/cli/src/commands/analyze.ts`:

```typescript
import { resolve, join } from 'path'
import { existsSync } from 'fs'
import type { Config, AuthorStats } from '../types'
import {
  parseTimeWindow,
  getGitLog,
  parseGitLog,
  getMergeCommits,
} from '../git/log'
import { calculateScore } from '../scoring'
import { renderLeaderboard } from '../output'

export async function analyze(
  timeWindow: string,
  path: string
): Promise<void> {
  const repoPath = resolve(path)
  const gitDir = join(repoPath, '.git')

  if (!existsSync(gitDir)) {
    console.error(`Not a git repository: ${repoPath}`)
    process.exit(1)
  }

  const configPath = join(repoPath, '.auctor.json')
  if (!existsSync(configPath)) {
    console.error(
      'No config found. Run `auctor configure` first.'
    )
    process.exit(1)
  }

  const config: Config = JSON.parse(
    await Bun.file(configPath).text()
  )
  const since = parseTimeWindow(timeWindow)

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

  const statsMap = new Map<string, Omit<AuthorStats, 'score'>>()

  for (const commit of commits) {
    const existing = statsMap.get(commit.author) ?? {
      author: commit.author,
      commits: 0,
      prs: 0,
      insertions: 0,
      deletions: 0,
      net: 0,
    }

    existing.commits++
    if (commit.isMerge) existing.prs++
    existing.insertions += commit.insertions
    existing.deletions += commit.deletions
    existing.net = existing.insertions - existing.deletions

    statsMap.set(commit.author, existing)
  }

  const leaderboard: AuthorStats[] = [...statsMap.values()]
    .map((s) => ({ ...s, score: calculateScore(s) }))
    .sort((a, b) => b.score - a.score)

  console.log(renderLeaderboard(leaderboard))
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/commands/analyze.ts
git commit -m "feat(cli): add analyze command with aggregation and leaderboard"
```

---

### Task 9: CLI Entry Point & Integration Test

**Files:**
- Create: `apps/cli/src/index.ts`

- [ ] **Step 1: Create CLI entry point**

Create `apps/cli/src/index.ts`:

```typescript
#!/usr/bin/env bun
import { Command } from 'commander'
import { configure } from './commands/configure'
import { analyze } from './commands/analyze'

const program = new Command()
  .name('auctor')
  .description('Team coding productivity tracker')
  .version('0.1.0')

program
  .command('configure')
  .description('Configure author whitelist from git history')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d, 0d)')
  .option('--path <path>', 'Path to git repository', '.')
  .action(async (timeWindow: string, opts: { path: string }) => {
    await configure(timeWindow, opts.path)
  })

program
  .command('analyze')
  .description('Analyze git history and show leaderboard')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d, 0d)')
  .option('--path <path>', 'Path to git repository', '.')
  .action(async (timeWindow: string, opts: { path: string }) => {
    await analyze(timeWindow, opts.path)
  })

program.parse()
```

- [ ] **Step 2: Run all unit tests**

Run: `cd apps/cli && bun test`

Expected: All tests pass (time window, git log parsing, scoring, output)

- [ ] **Step 3: Run lint**

Run: `bun run lint`

Expected: No errors. Fix any issues biome reports.

- [ ] **Step 4: Manual integration test — configure**

Run: `cd apps/cli && bun src/index.ts configure -30d --path ../..`

Expected: Interactive multi-select appears showing authors from this monorepo. Select some authors, press enter. `.auctor.json` is written to the monorepo root.

- [ ] **Step 5: Manual integration test — analyze**

Run: `cd apps/cli && bun src/index.ts analyze -30d --path ../..`

Expected: Leaderboard table prints to stdout with stats for selected authors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/index.ts
git commit -m "feat(cli): add CLI entry point wiring configure and analyze commands"
```

- [ ] **Step 7: Clean up — add .auctor.json to .gitignore**

Add `.auctor.json` to the root `.gitignore` so per-repo configs aren't accidentally committed.

```bash
echo ".auctor.json" >> .gitignore
git add .gitignore
git commit -m "chore: add .auctor.json to gitignore"
```
