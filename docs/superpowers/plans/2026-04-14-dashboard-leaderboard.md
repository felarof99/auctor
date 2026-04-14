# Dashboard Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Twitter dashboard with an auctor leaderboard showing ranked authors per repo, fed by static JSON files.

**Architecture:** Static Vite SPA reads `manifest.json` listing repo report files from `public/data/`. Each report contains `AuthorStats[]` sorted by score. Tabs switch between repos, table shows the leaderboard.

**Tech Stack:** React 19, Tailwind v4, shadcn/ui (existing), Vite, Bun

---

## File Structure

```
packages/shared/
  src/report.ts              (CREATE) — RepoReport type
  package.json               (MODIFY) — add ./report export

apps/dashboard/
  public/data/
    manifest.json            (CREATE) — sample manifest
    sample-repo.json         (CREATE) — sample repo data
  components/ui/tabs.tsx     (CREATE) — shadcn Tabs component
  src/
    App.tsx                  (REWRITE) — leaderboard app
    hooks/use-reports.ts     (CREATE) — data loading hook
  package.json               (MODIFY) — remove supabase dep

apps/cli/
  src/commands/analyze.ts    (MODIFY) — add --json flag + RepoReport output
```

---

### Task 1: Add RepoReport Type to Shared Package

**Files:**
- Create: `packages/shared/src/report.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Create the RepoReport type**

```typescript
// packages/shared/src/report.ts

export interface RepoAuthorStats {
  author: string
  commits: number
  prs: number
  insertions: number
  deletions: number
  net: number
  score: number
}

export interface RepoReport {
  repo: string
  generated_at: string
  window_days: number
  authors: RepoAuthorStats[]
}
```

- [ ] **Step 2: Add export to shared package.json**

Add this entry to the `"exports"` object in `packages/shared/package.json`:

```json
"./report": {
  "types": "./src/report.ts",
  "default": "./src/report.ts"
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck`
Expected: No errors from the shared package

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/report.ts packages/shared/package.json
git commit -m "feat(shared): add RepoReport type for dashboard data"
```

---

### Task 2: Create Sample Data Files

**Files:**
- Create: `apps/dashboard/public/data/manifest.json`
- Create: `apps/dashboard/public/data/sample-repo.json`
- Create: `apps/dashboard/public/data/competitor-repo.json`

- [ ] **Step 1: Create manifest.json**

```json
["sample-repo.json", "competitor-repo.json"]
```

Write to: `apps/dashboard/public/data/manifest.json`

- [ ] **Step 2: Create sample-repo.json**

```json
{
  "repo": "acme/core",
  "generated_at": "2026-04-14T12:00:00.000Z",
  "window_days": 7,
  "authors": [
    { "author": "Alice Chen", "commits": 12, "prs": 4, "insertions": 1240, "deletions": 380, "net": 860, "score": 0.82 },
    { "author": "Bob Rivera", "commits": 8, "prs": 3, "insertions": 650, "deletions": 120, "net": 530, "score": 0.61 },
    { "author": "Carol Zhang", "commits": 6, "prs": 2, "insertions": 420, "deletions": 110, "net": 310, "score": 0.48 },
    { "author": "Dave Kim", "commits": 4, "prs": 1, "insertions": 280, "deletions": 90, "net": 190, "score": 0.33 }
  ]
}
```

Write to: `apps/dashboard/public/data/sample-repo.json`

- [ ] **Step 3: Create competitor-repo.json**

```json
{
  "repo": "competitor/sdk",
  "generated_at": "2026-04-14T12:00:00.000Z",
  "window_days": 7,
  "authors": [
    { "author": "Eve Park", "commits": 10, "prs": 5, "insertions": 890, "deletions": 200, "net": 690, "score": 0.59 },
    { "author": "Frank Lee", "commits": 7, "prs": 2, "insertions": 510, "deletions": 150, "net": 360, "score": 0.42 },
    { "author": "Grace Wu", "commits": 3, "prs": 1, "insertions": 220, "deletions": 80, "net": 140, "score": 0.31 }
  ]
}
```

Write to: `apps/dashboard/public/data/competitor-repo.json`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/public/data/
git commit -m "feat(dashboard): add sample leaderboard data files"
```

---

### Task 3: Add Tabs Component from shadcn/ui

**Files:**
- Create: `apps/dashboard/components/ui/tabs.tsx`

- [ ] **Step 1: Install Radix Tabs dependency**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/dashboard && bun add @radix-ui/react-tabs`

- [ ] **Step 2: Create the Tabs component**

```typescript
// apps/dashboard/components/ui/tabs.tsx
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'

import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
      className,
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsContent, TabsList, TabsTrigger }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/ui/tabs.tsx apps/dashboard/package.json
git commit -m "feat(dashboard): add shadcn Tabs component"
```

---

### Task 4: Create Data Loading Hook

**Files:**
- Create: `apps/dashboard/src/hooks/use-reports.ts`

- [ ] **Step 1: Create the useReports hook**

```typescript
// apps/dashboard/src/hooks/use-reports.ts
import { useCallback, useEffect, useState } from 'react'
import type { RepoReport } from '@auctor/shared/report'

interface UseReportsResult {
  reports: Record<string, RepoReport>
  repoNames: string[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useReports(): UseReportsResult {
  const [reports, setReports] = useState<Record<string, RepoReport>>({})
  const [repoNames, setRepoNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const manifestRes = await fetch('/data/manifest.json')
      if (!manifestRes.ok) throw new Error('Failed to load manifest.json')
      const filenames: string[] = await manifestRes.json()

      const entries = await Promise.all(
        filenames.map(async (filename) => {
          const res = await fetch(`/data/${filename}`)
          if (!res.ok) throw new Error(`Failed to load ${filename}`)
          const report: RepoReport = await res.json()
          return [report.repo, report] as const
        }),
      )

      setReports(Object.fromEntries(entries))
      setRepoNames(entries.map(([name]) => name))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { reports, repoNames, loading, error, refresh: load }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/hooks/use-reports.ts
git commit -m "feat(dashboard): add useReports data loading hook"
```

---

### Task 5: Rewrite App.tsx — Leaderboard Dashboard

**Files:**
- Rewrite: `apps/dashboard/src/App.tsx`
- Modify: `apps/dashboard/package.json` (remove supabase)

- [ ] **Step 1: Remove Supabase dependency**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/dashboard && bun remove @supabase/supabase-js`

- [ ] **Step 2: Rewrite App.tsx**

Replace the entire contents of `apps/dashboard/src/App.tsx` with:

```tsx
// apps/dashboard/src/App.tsx
import { useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useReports } from '@/src/hooks/use-reports'
import type { RepoAuthorStats } from '@auctor/shared/report'

type SortKey = 'score' | 'commits' | 'prs' | 'insertions' | 'deletions' | 'net'

const RANK_COLORS: Record<number, string> = {
  1: 'text-yellow-400',
  2: 'text-gray-300',
  3: 'text-amber-600',
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string
  sortKey: SortKey
  currentSort: SortKey
  currentDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}) {
  const isActive = currentSort === sortKey
  return (
    <th
      className="cursor-pointer select-none px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive ? (currentDir === 'desc' ? ' \u2193' : ' \u2191') : ''}
    </th>
  )
}

export function App() {
  const { reports, repoNames, loading, error, refresh } = useReports()
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const activeRepo = selectedRepo ?? repoNames[0] ?? null
  const report = activeRepo ? reports[activeRepo] : null

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const filtered = useMemo(() => {
    if (!report) return []
    let authors = report.authors
    const q = query.trim().toLowerCase()
    if (q) {
      authors = authors.filter((a) => a.author.toLowerCase().includes(q))
    }
    const sorted = [...authors].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return sorted
  }, [report, query, sortKey, sortDir])

  if (loading) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="mb-8 h-4 w-72" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Failed to load data</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Make sure <code>public/data/manifest.json</code> exists and lists valid repo JSON files.
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl leading-none">auctor</h1>
            <div className="text-muted-foreground text-sm">
              Engineering Productivity Leaderboard
            </div>
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <Badge variant="outline">{report.window_days}d window</Badge>
            )}
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Repo Tabs */}
        {repoNames.length > 1 && (
          <Tabs
            value={activeRepo ?? undefined}
            onValueChange={setSelectedRepo}
          >
            <TabsList>
              {repoNames.map((name) => (
                <TabsTrigger key={name} value={name}>
                  {name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by author name..."
              className="pl-9"
            />
          </div>
          <Badge variant="secondary">
            {filtered.length} author{filtered.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        {/* Leaderboard Table */}
        {filtered.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No authors found</CardTitle>
              <CardDescription>
                {query ? 'Try a different search.' : 'No data available for this repo.'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Author
                  </th>
                  <SortableHeader label="Commits" sortKey="commits" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="PRs" sortKey="prs" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="+LOC" sortKey="insertions" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="-LOC" sortKey="deletions" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Net" sortKey="net" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Score" sortKey="score" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((author, i) => {
                  const rank = i + 1
                  return (
                    <tr
                      key={author.author}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className={cn('px-4 py-3 font-bold', RANK_COLORS[rank] ?? 'text-muted-foreground')}>
                        {rank}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {author.author}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {author.commits}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {author.prs}
                      </td>
                      <td className="px-4 py-3 text-right text-green-400">
                        {formatNumber(author.insertions)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatNumber(author.deletions)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatNumber(author.net)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-indigo-400">
                        {author.score.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        {report && (
          <div className="text-xs text-muted-foreground">
            Generated {new Date(report.generated_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck`
Expected: No errors

- [ ] **Step 4: Verify dev server starts and renders**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/dashboard && bun run dev`
Expected: Opens at http://localhost:5176 showing the leaderboard with sample data

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/App.tsx apps/dashboard/package.json
git commit -m "feat(dashboard): replace Twitter dashboard with auctor leaderboard"
```

---

### Task 6: Add --json Flag to CLI Analyze Command

**Files:**
- Modify: `apps/cli/src/commands/analyze.ts`
- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Add RepoReport import and --json option to index.ts**

In `apps/cli/src/index.ts`, find the `analyze` command definition and add a `--json <path>` option. The exact change depends on the CLI framework used (likely Commander or similar). Add an optional `jsonPath` parameter that gets passed to the `analyze` function.

- [ ] **Step 2: Modify analyze.ts to accept and use jsonPath**

Change the function signature:

```typescript
export async function analyze(timeWindow: string, path: string, jsonPath?: string): Promise<void> {
```

After the existing JSON write block (lines 171-192), add:

```typescript
  // Write RepoReport JSON if --json flag provided
  if (jsonPath) {
    const reportPath = resolve(jsonPath)
    const reportDir = join(reportPath, '..')
    mkdirSync(reportDir, { recursive: true })

    const report = {
      repo: config.repo_url ?? repoName,
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
    console.log(`\nReport written to ${reportPath}`)
  }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/analyze.ts apps/cli/src/index.ts
git commit -m "feat(cli): add --json flag to write RepoReport for dashboard"
```

---

### Task 7: Verify End-to-End & Clean Up

- [ ] **Step 1: Run lint**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run lint`
Expected: No errors (or fix any that appear)

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4 && bun run typecheck`
Expected: No errors

- [ ] **Step 3: Start dashboard and visually verify**

Run: `cd /Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4/apps/dashboard && bun run dev`

Verify:
- Page loads at http://localhost:5176
- "auctor" header visible
- Two repo tabs (acme/core, competitor/sdk)
- Leaderboard table with correct columns
- Rank 1/2/3 have gold/silver/bronze colors
- +LOC is green, Score is indigo
- Search filters by author name
- Column headers sort on click
- Tab switching shows different repo data

- [ ] **Step 4: Final commit if lint required changes**

```bash
git add -A
git commit -m "fix(dashboard): lint fixes"
```
