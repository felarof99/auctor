# Auctor CLI Design Spec

## Overview

Auctor is a TypeScript CLI tool that analyzes git history to produce per-engineer productivity leaderboards. It runs locally against any cloned repo, extracts commit data, and outputs a ranked table of author stats.

This spec covers the CLI only — classification service and dashboard are separate future specs.

## Tech Stack

- **Runtime:** Bun (TypeScript, no build step)
- **Command parsing:** Commander
- **Interactive prompts:** @clack/prompts
- **Table output:** cli-table3
- **Git:** Shell out via `Bun.spawn` (no git library)

## Commands

### `auctor configure <time-window> [--path <path>]`

Discovers git authors within a time window and lets the user whitelist which ones to track.

**Flow:**
1. Resolve `--path` (default `.`), validate it contains `.git`
2. Run `git log --all --format="%an" --since="<date>"` with `cwd` set to the resolved path
3. Extract unique author names, sort alphabetically
4. If `.auctor.json` already exists in the target repo, pre-select previously whitelisted authors
5. Present @clack/prompts multi-select — space to toggle, enter to confirm
6. Write selected authors to `.auctor.json` in the target repo root

### `auctor analyze <time-window> [--path <path>]`

Analyzes git history for whitelisted authors and outputs a leaderboard.

**Flow:**
1. Resolve `--path` (default `.`), validate it contains `.git`
2. Read `.auctor.json` from the target repo root — error with message if missing: "No config found. Run `auctor configure` first."
3. Run two git commands (details in Git Data Extraction):
   - All commits with stats within the time window
   - Merge commit SHAs within the time window (for PR detection)
4. Filter commits to whitelisted authors only
5. Aggregate per author: commits, PRs, +LOC, -LOC, net LOC
6. Calculate score per author using the scoring formula
7. Sort by score descending, assign ranks
8. Render leaderboard table to stdout

### Time Window Format

Positional argument, required for both commands:
- `-7d` — last 7 days
- `-30d` — last 30 days
- `0d` — today only
- Pattern: `-?(\d+)d`, parsed into a `--since` date for git

### `--path` Flag

Defaults to `.` (current directory). Accepts any local path. Must point to a valid git repo.

## Config File

**`.auctor.json`** — stored in the target repo root:

```json
{
  "authors": ["alice", "bob", "charlie"]
}
```

Minimal by design. No additional fields for now.

## Types

```typescript
interface Config {
  authors: string[]
}

interface Commit {
  sha: string
  author: string
  date: Date
  subject: string
  insertions: number
  deletions: number
  isMerge: boolean
}

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

## Git Data Extraction

All git commands run via `Bun.spawn` with `cwd` set to the resolved `--path`.

### All commits (stats + metadata)

```bash
git log --all --shortstat --format="COMMIT_START%n%H%n%an%n%aI%n%s" --since="<date>"
```

Output per commit:
```
COMMIT_START
abc123def
Alice
2026-04-10T14:30:00-07:00
feat: add user auth
 3 files changed, 45 insertions(+), 12 deletions(-)
```

Parse by splitting on `COMMIT_START`, extract fields line-by-line. Insertions/deletions parsed from the `--shortstat` line via regex: `/(\d+) insertion/` and `/(\d+) deletion/`.

### Merge commits (PR detection)

```bash
git log --all --merges --format="%H" --since="<date>"
```

Collect SHAs into a `Set<string>`, mark `isMerge: true` on matching commits.

### Author discovery (for configure)

Same `git log --all --format="%an" --since="<date>"`, deduplicate into a sorted array.

## Scoring

Placeholder formula — intentionally simple, will be replaced later:

```typescript
function calculateScore(stats: Omit<AuthorStats, 'score'>): number {
  // Weighted sum normalized to 0-1 range
  // Factors: commits, PRs, net LOC
  // Initial implementation: simple weighted formula
  // User will replace with a custom scoring function later
}
```

## Output

Leaderboard table rendered to stdout via cli-table3:

```
┌──────┬──────────────┬─────────┬─────┬────────┬────────┬────────┬───────┐
│ Rank │ Author       │ Commits │ PRs │   +LOC │   -LOC │    Net │ Score │
├──────┼──────────────┼─────────┼─────┼────────┼────────┼────────┼───────┤
│    1 │ alice        │      12 │   3 │  1,240 │    380 │    860 │  0.82 │
│    2 │ bob          │       8 │   2 │    650 │    120 │    530 │  0.61 │
│    3 │ charlie      │       5 │   1 │    320 │     90 │    230 │  0.38 │
└──────┴──────────────┴─────────┴─────┴────────┴────────┴────────┴───────┘
```

## Package Structure

Located at `apps/cli/` in the monorepo:

```
apps/cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Commander program setup, registers commands
│   ├── commands/
│   │   ├── configure.ts      # auctor configure
│   │   └── analyze.ts        # auctor analyze
│   ├── git/
│   │   ├── log.ts            # git log parsing via Bun.spawn
│   │   └── authors.ts        # unique author extraction
│   ├── scoring.ts            # score = f(commits, PRs, LOC)
│   ├── output.ts             # terminal table rendering
│   └── types.ts              # Commit, AuthorStats, Config types
```

**package.json bin field:** `{ "auctor": "./src/index.ts" }` — Bun runs TypeScript natively, no build step.

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | Command and argument parsing |
| `@clack/prompts` | Interactive multi-select for author whitelisting |
| `cli-table3` | Terminal table rendering |

Three runtime dependencies. Everything else uses Bun built-ins.

## Out of Scope

- AI-powered commit classification (future spec)
- JSON/file output modes
- SQLite persistence and trend analysis
- Dashboard integration
- Work type breakdown (Feature/Bug/KTLO)
- Author aliasing (multiple emails → one person)
