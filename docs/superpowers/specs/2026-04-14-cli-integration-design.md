# CLI Integration Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

Wire the CLI to the classification server and ConvexDB. The CLI becomes the single writer to Convex (repos, authors, work_units, analysis_runs). ConvexDB serves as both permanent store and classification cache.

## Integration Points

### 1. `auctor configure` → Convex

After writing `.auctor.json` locally, also upsert to Convex:
- `repos.getOrCreate(repoName)` → get repoId
- `authors.upsert(repoId, username, whitelisted)` for each selected author

### 2. `auctor analyze` → Classification Server + Convex

```
1. Extract work units from git (existing)
2. Hydrate diffs (existing)
3. Check Convex for already-classified work units
   → work_units.exists(repoId, authorId, date, unitType, branch)
   → skip classification for cached units
4. Classify uncached units via server (existing POST /api/classify)
5. Score all units (existing formula)
6. Upload newly classified work_units to Convex
   → work_units.insert() with all flat fields per DB spec
7. Upload analysis_run to Convex
   → analysis_runs.insert() with leaderboard
8. Render table + sparklines (existing)
9. Write local JSON (existing)
```

## New Module: `apps/cli/src/convex-client.ts`

Thin wrapper with 5 functions:

- `ensureRepo(client, repoName)` → repos.getOrCreate, returns repoId
- `ensureAuthors(client, repoId, authors[])` → authors.upsert per author, returns Map<username, authorId>
- `findExistingWorkUnit(client, repoId, authorId, date, unitType, branch)` → work_units.exists, returns boolean
- `insertWorkUnit(client, data)` → work_units.insert with all flat fields (metrics + classification + scores)
- `insertAnalysisRun(client, data)` → analysis_runs.insert with ranked author scores

Client initialized from `convex_url` in .auctor.json. All Convex functions use the existing mutations/queries in `convex/`.

## Config Changes

`.auctor.json` gets `convex_url` (optional):

```json
{
  "authors": ["Alice", "Bob"],
  "server_url": "http://localhost:3001",
  "repo_url": "https://github.com/user/repo",
  "convex_url": "https://your-deployment.convex.cloud"
}
```

| convex_url | server_url | Behavior |
|-----------|------------|----------|
| set | set | Full: Convex cache → server classify → Convex store |
| set | not set | Convex cache → default classification → Convex store |
| not set | set | Server classify → local JSON only |
| not set | not set | Default classification → local JSON only |

Both are independently optional.

## Files Modified

- `apps/cli/src/types.ts` — add `convex_url` to Config
- `apps/cli/src/commands/configure.ts` — add Convex upsert after local write
- `apps/cli/src/commands/analyze.ts` — add Convex cache check, upload work_units, upload analysis_run
- `apps/cli/package.json` — add `@auctor/database` dependency

## Files Created

- `apps/cli/src/convex-client.ts` — Convex wrapper (ensureRepo, ensureAuthors, findExistingWorkUnit, insertWorkUnit, insertAnalysisRun)

## Convex Functions Used (all already exist)

- `repos.getOrCreate` — upsert repo by name
- `authors.upsert` — upsert author by repoId + username
- `work_units.exists` — check if work unit already classified
- `work_units.insert` — store classified work unit with all flat fields
- `analysis_runs.insert` — store analysis run with ranked author scores

## work_units.insert payload

Each work unit row contains raw metrics, AI classification, and computed score — all flat:

```typescript
{
  repoId, authorId,
  unitType: 'pr' | 'branch_day',
  branch, date, prNumber?,
  commitShas: string[],
  locAdded, locRemoved, locNet,
  classificationType, difficultyLevel, impactScore, reasoning,
  locFactor, formulaScore, aiScore, typeWeight, difficultyWeight, unitScore
}
```

## Graceful Degradation

If `convex_url` is not configured, all Convex operations are silently skipped. The CLI works exactly as it does today — local JSON output only.

If Convex is configured but unreachable, the CLI should log a warning and fall back to local-only mode rather than crashing.
