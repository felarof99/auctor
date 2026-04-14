# Auctor Database Design Spec

## Overview

ConvexDB schema for storing classification results, scores, and analysis reports. The CLI is the sole writer; the dashboard is the primary reader.

## Database: ConvexDB

Chosen for: typed schemas with validators, real-time queries, serverless functions, `v.optional()` for schema evolution without migrations.

## Data Flow

```
auctor configure → upserts repos + authors tables
auctor analyze   → checks work_units cache → calls Fly.io classifier → writes work_units + analysis_runs
dashboard        → reads analysis_runs (leaderboard) + work_units (drill-down)
```

- `work_units` are append-only, write-once, never re-classified
- `analysis_runs` are regenerated on each `auctor analyze` run
- ConvexDB serves as both permanent store and classification cache
- Fly.io classification service is stateless (optional ephemeral JSON cache)

## Schema

### `repos`

| Field | Type | Description |
|-------|------|-------------|
| name | string | Repo name, e.g. "auctor-v4" |

**Indexes:** `by_name` on `[name]`

### `authors`

| Field | Type | Description |
|-------|------|-------------|
| repoId | id("repos") | Reference to repo |
| username | string | GitHub username |
| whitelisted | boolean | Selected during `auctor configure` |

**Indexes:** `by_repo` on `[repoId]`, `by_repo_username` on `[repoId, username]`

### `work_units`

One row per classified work unit. Contains raw metrics, AI classification, and computed score — all flat fields.

| Field | Type | Description |
|-------|------|-------------|
| repoId | id("repos") | Reference to repo |
| authorId | id("authors") | Reference to author |
| unitType | "pr" \| "branch_day" | Work unit type |
| branch | string | Branch name |
| date | string | ISO date "2026-04-14" |
| prNumber | optional number | PR number if unitType is "pr" |
| commitShas | string[] | All commit SHAs in this unit |
| locAdded | number | Lines added |
| locRemoved | number | Lines removed |
| locNet | number | Net lines (added - removed) |
| classificationType | enum | "feature" \| "bugfix" \| "refactor" \| "chore" \| "test" \| "docs" |
| difficultyLevel | enum | "trivial" \| "easy" \| "medium" \| "hard" \| "complex" |
| impactScore | number | 0-10 AI-judged impact score |
| reasoning | string | AI's classification reasoning |
| locFactor | number | log2(1 + locNet) / log2(1 + 1000), capped at 1.0 |
| formulaScore | number | locFactor x difficultyWeight |
| aiScore | number | impactScore / 10 |
| typeWeight | number | feature=1.0, bugfix=0.8, refactor=0.7, docs=0.6, test=0.5, chore=0.3 |
| difficultyWeight | number | complex=2.0, hard=1.5, medium=1.0, easy=0.5, trivial=0.2 |
| unitScore | number | (0.5 x formulaScore + 0.5 x aiScore) x typeWeight |

**Indexes:** `by_repo` on `[repoId]`, `by_author` on `[repoId, authorId]`, `by_date` on `[repoId, date]`

### `analysis_runs`

One row per `auctor analyze` invocation. The dashboard's primary query target.

| Field | Type | Description |
|-------|------|-------------|
| repoId | id("repos") | Reference to repo |
| timeWindow | string | "7d", "14d", "30d" |
| analyzedAt | string | ISO timestamp |
| daysInWindow | number | Number of days in the window |
| authorScores | array of objects | Ranked author results |

Each entry in `authorScores`:

| Field | Type | Description |
|-------|------|-------------|
| authorId | id("authors") | Reference to author |
| username | string | GitHub username (denormalized for display) |
| commits | number | Total commits in window |
| locAdded | number | Total lines added |
| locRemoved | number | Total lines removed |
| locNet | number | Total net lines |
| score | number | sum(unitScores) / daysInWindow |

**Indexes:** `by_repo` on `[repoId]`, `by_repo_date` on `[repoId, analyzedAt]`

## Cache Strategy

Before classifying a work unit, CLI queries ConvexDB:
- Query `work_units` by `repoId` + `authorId` + `date` using the `by_author` and `by_date` indexes
- Filter results client-side by matching `unitType` and `branch`
- If a matching work unit exists: skip classification, use existing score
- If not found: call Fly.io service, compute score, write to ConvexDB

No local cache files needed. ConvexDB is the single source of truth.

## Schema Evolution

New fields added as `v.optional()` — existing documents remain valid, no migrations. This is a ConvexDB native capability.

## Why 4 Tables (Not 6)

- `classifications` and `scores` merged into `work_units` — always 1:1, always written together
- `reports` renamed to `analysis_runs` — clearer intent
- Result: fewer tables, fewer queries, same data model
