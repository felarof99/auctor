# Auctor Dashboard — Leaderboard Design

## Overview

A minimal static dashboard that displays the auctor leaderboard — ranked authors with productivity scores — across multiple repos. Replaces the existing Twitter dashboard in `apps/dashboard/`.

## Data Source

Static JSON files. No backend, no database.

### CLI Output

The CLI gets a `--json` flag:

```bash
auctor analyze -7d --path . --json data/browseros-core.json
```

### JSON Schema

**Per-repo file** (e.g., `data/browseros-core.json`):

```typescript
interface RepoReport {
  repo: string              // "browseros/core"
  generated_at: string      // ISO timestamp
  window_days: number       // 7
  authors: AuthorStats[]    // sorted by score descending
}

// AuthorStats (from apps/cli/src/types.ts):
interface AuthorStats {
  author: string
  commits: number
  prs: number
  insertions: number
  deletions: number
  net: number
  score: number
}
```

**Manifest file** (`data/manifest.json`):

```json
["browseros-core.json", "competitor-repo-a.json"]
```

Dashboard fetches `manifest.json`, then loads each listed repo file.

## Dashboard Architecture

Replace `apps/dashboard/src/App.tsx` entirely. Remove Supabase dependency.

### Component Tree

```
App.tsx
├── Header: "auctor" branding + time window display
├── RepoTabs: one tab per repo from manifest
└── LeaderboardTable: ranked author rows for selected repo
    └── AuthorRow: rank, name, commits, PRs, +LOC, -LOC, net, score
```

### Existing Components (reuse)

From `apps/dashboard/components/ui/`:
- `Card`, `Badge`, `Button`, `Skeleton`, `Input`

### New Component

- `Tabs` from shadcn/ui (add via `bunx shadcn@latest add tabs`)

### Data Flow

1. On mount, fetch `/data/manifest.json`
2. Load all repo JSON files listed in manifest
3. Store in state: `Record<string, RepoReport>`
4. Selected repo tab renders that repo's `authors` array as the table
5. Default: first repo in manifest selected

## Table Design

Columns match the CLI output:

| Rank | Author | Commits | PRs | +LOC | -LOC | Net | Score |
|------|--------|---------|-----|------|------|-----|-------|

### Visual Treatment

- Rank 1/2/3: gold/silver/bronze color accent on rank number
- Score column: highlighted in accent color (indigo/purple)
- +LOC: green text
- Sortable columns: click header to sort (default: score descending)
- Search input above table: filters authors by name

### Styling

- Dark theme (matches existing Tailwind v4 setup)
- Existing design system: shadcn/ui + Tailwind v4
- No new CSS framework or design tokens

## File Changes

### Remove
- `@supabase/supabase-js` dependency from `apps/dashboard/package.json`
- All Supabase-related code from `App.tsx`

### Modify
- `apps/dashboard/src/App.tsx` — complete rewrite
- `apps/dashboard/package.json` — remove supabase, keep everything else

### Add
- `apps/dashboard/components/ui/tabs.tsx` — shadcn Tabs component
- `packages/shared/src/report.ts` — `RepoReport` type (imports `AuthorStats` from CLI types or re-exports)
- Export added to `packages/shared/package.json` for `./report`
- `apps/dashboard/public/data/manifest.json` — sample manifest
- `apps/dashboard/public/data/sample.json` — sample repo data for development

### CLI Addition
- `apps/cli/src/commands/analyze.ts` — add `--json <path>` flag that writes `RepoReport` JSON

## What This Does NOT Include

- No Supabase or any database
- No authentication
- No real-time updates (manual refresh after re-running CLI)
- No cross-repo comparison view (single repo at a time via tabs)
- No charts or graphs (table only for v1)
- No server-side rendering
