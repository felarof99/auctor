# Commit SHA Aggregation Dedupe Design

## Goal

Deduplicate commit SHA contributions in `auctor analyze` during aggregation, so a commit reachable from multiple active branch refs is counted once for leaderboard commit totals, LOC totals, score, and commit provenance.

## Context

The branch-scoped analyzer intentionally collects commits from every active branch ref. That fixed missed non-main branch activity, but it also means the same commit SHA can appear many times when it is reachable from many active branches. PR units already dedupe by parsed PR number or merge commit SHA. Commit units still need a dedupe layer.

The chosen design keeps branch collection unchanged and dedupes at the aggregation boundary. Lower layers continue preserving branch evidence; aggregation decides what counts in leaderboard totals.

## Counting Semantics

Deduplicate commit contributions by `repo::sha` inside each author bucket. If the same SHA appears on multiple branch-day units for the same author, count it once for:

- `commits`
- `insertions`
- `deletions`
- `net`
- commit provenance rows
- the portion of score attributable to branch-day units

Do not dedupe across different authors. If the same SHA appears under two resolved authors, keep both records because that indicates an identity resolution issue that should not be hidden by aggregation.

PRs remain separate signals. A squash commit with a subject like `fix: thing (#749)` may contribute one commit and one PR, but duplicate branch observations of that same SHA should not inflate commit totals.

## Data Flow

Extend `PerRepoScoredUnit` so branch-day units carry exact commit-level evidence:

```ts
commitDetails: {
  repo: string
  sha: string
  branch?: string
  message: string
  insertions: number
  deletions: number
}[]
```

PR units may leave `commitDetails` empty because PR counting already has dedicated provenance and dedupe rules.

`analyzeSingleRepo` already has access to `WorkUnit` data before it creates `PerRepoScoredUnit`, so it should populate `commitDetails` from branch-day work units. This avoids trying to infer per-commit LOC from rolled-up unit totals later.

## Aggregation Rules

`aggregateBundleResults` should maintain a per-author `seenCommitKeys` set. For each non-PR scored unit:

1. Split `commitDetails` into unique and duplicate details using `repo::sha`.
2. Add only unique details to `commits`, `insertions`, `deletions`, and `considered.commits`.
3. Add score only for the unique portion of the unit.

For PR units, preserve current behavior:

1. Increment PR count once per PR unit.
2. Add PR provenance.
3. Add the full PR unit score.

## Score Scaling

For branch-day units containing both duplicate and new commits, scale the unit score by the unique portion of the unit.

Use absolute net LOC as the preferred weighting:

```ts
uniqueWeight = sum(abs(insertions - deletions) for unique commits)
totalWeight = sum(abs(insertions - deletions) for all commitDetails)
scaledScore = unit.score * (uniqueWeight / totalWeight)
```

If `totalWeight` is zero, fall back to commit-count weighting:

```ts
scaledScore = unit.score * (uniqueCommitCount / totalCommitCount)
```

If a branch-day unit contributes no new commits, it contributes no score.

This keeps score directionally consistent without moving dedupe earlier in the pipeline.

## Branch Provenance

The aggregation result should expose one considered commit row per counted SHA. For now, preserve the first observed branch as the row's `branch`. A future enhancement can add `branches: string[]` for full branch provenance, but this design avoids expanding the JSON schema more than needed.

The existing dashboard branch column will naturally show the primary branch for the counted commit row. Duplicate branch rows will disappear because `considered.commits` is deduped.

## Edge Cases

- Missing `commitDetails`: treat branch-day units without details as legacy units and count them using existing rolled-up behavior. This keeps tests and older callers resilient.
- Duplicate SHA with different LOC stats: first observation wins. The same SHA should normally have identical stats; a mismatch suggests unusual Git history or parser behavior.
- Duplicate SHA with different messages: first observation wins.
- Duplicate SHA with different branches: first branch wins for the current `branch` field.
- PR unit commit SHA also appears as a branch-day commit: count both signals once, matching the existing PR + commit scoring model.

## Tests

Add focused tests in `apps/cli/src/analyze-aggregate.test.ts`:

1. Duplicate `repo::sha` commit details across two branch-day units count once.
2. LOC totals include only unique commit details.
3. Commit provenance includes one row for the duplicate SHA and preserves the first branch.
4. A mixed branch-day unit with one duplicate and one new commit contributes a scaled score.
5. PR counts and PR provenance remain unchanged.
6. A branch-day unit without `commitDetails` still uses legacy rolled-up behavior.

Existing `apps/cli/src/git/work-units.test.ts` should remain unchanged because collection should still preserve branch observations before aggregation.

## Verification

Run:

```bash
bun test apps/cli/src/analyze-aggregate.test.ts
bun test apps/cli/src
bun run typecheck
bun run lint
```

Then run a real BrowserOS analysis and confirm `shadowfax92` commit totals drop from branch-inflated values while PR totals stay in the expected range:

```bash
bun apps/cli/src/index.ts analyze configs/browseros/browseros_config.yaml -7d --json /tmp/auctor-dedupe-check.json
```
