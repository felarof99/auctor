# Auctor Raw Provenance Drilldown - Design

Date: 2026-04-17
Status: Approved for planning
Author: nithin@browseros.com

## Summary

Add raw provenance to every author row in the Auctor JSON reports, then render that provenance in the dashboard when a leaderboard row is clicked. The first version is intentionally narrow: show the raw commits and PR merge commits that went into the author's totals. Do not show per-item scores yet.

## Goals

- Make every leaderboard count auditable from the dashboard.
- Store provenance in the same per-repo JSON reports that already power the dashboard.
- Keep the raw item shape small: repo, message, and SHA or PR number.
- Use a modal for author drilldown so the leaderboard remains scannable.

## Non-goals

- No backward compatibility for old report JSON. New CLI output and dashboard types should use the new shape directly.
- No per-commit or per-PR score in this version.
- No GitHub API lookup for PR metadata.
- No file-level stats, dates, author emails, or full diffs in the drilldown data.
- No dashboard rendering for microscope JSON files.

## Report Schema

`RepoAuthorStats` gains a required `considered` field:

```ts
export interface ConsideredCommit {
  repo: string
  sha: string
  message: string
}

export interface ConsideredPullRequest {
  repo: string
  sha: string
  pr_number?: number
  message: string
}

export interface AuthorConsideredItems {
  commits: ConsideredCommit[]
  prs: ConsideredPullRequest[]
}

export interface RepoAuthorStats {
  author: string
  commits: number
  prs: number
  insertions: number
  deletions: number
  net: number
  score: number
  daily_scores: DailyScore[]
  considered: AuthorConsideredItems
}
```

Merge commits intentionally appear in both arrays:

- `considered.commits` contains every raw commit counted by the leaderboard.
- `considered.prs` contains the subset of counted commits that are merge commits.

This duplication makes both the commit total and PR total auditable without hidden exclusions.

## CLI Data Flow

`analyzeSingleRepo` already resolves git commits to configured engineer usernames before extracting work units. The CLI will capture provenance from that resolved commit list:

1. Resolve authors through `createAuthorResolver`.
2. For each resolved commit, create a `ConsideredCommit` with `repo`, `sha`, and `message`.
3. For each resolved merge commit, create a `ConsideredPullRequest` with `repo`, `sha`, `message`, and a parsed `pr_number` when the subject contains `(#123)`.
4. Pass these raw items through the per-repo aggregation path.
5. Write every repo report with required `considered` arrays on each author.

The existing work-unit scoring path remains unchanged. Provenance explains what was counted; scoring details are a later feature.

## Aggregation

`aggregateBundleResults` should group provenance by author while it groups commits, PRs, LOC, and daily scores. For each author bucket:

- Append raw commit items into `considered.commits`.
- Append raw PR items into `considered.prs`.
- Keep existing numeric totals unchanged.

`aggregateBundle` should merge `considered` arrays across repo reports. Aggregate authors preserve the same `considered` shape plus the existing `repos` list.

Sorting does not need special handling. The modal can sort locally for display.

## Dashboard Behavior

Every author row in `AuthorTable` becomes clickable. Clicking opens a modal with:

- Title: author username.
- Summary line: commit count and PR count from the clicked row.
- `Commits` section: one row per `considered.commits` item.
- `PRs` section: one row per `considered.prs` item.

Each item displays:

- Repo name.
- Message.
- SHA short form for commits.
- PR number when available for PRs; otherwise SHA short form.

On the Aggregate tab, the modal shows all provenance across all repos. On a repo tab, the modal shows only that repo's provenance because the active report is already repo-scoped.

If a section is empty, render a compact empty state such as `No PR merge commits counted`.

## UI Constraints

- Use a modal rather than inline row expansion.
- Keep the leaderboard table layout stable.
- Make rows visibly clickable with hover state and keyboard activation.
- Long commit messages should wrap inside the modal without widening the page.
- Large authors can have hundreds of commits, so the modal body should scroll while the header remains visible.

## Testing

Add or update focused tests:

- `packages/shared/src/report.ts` types compile with required `considered`.
- `apps/cli/src/analyze-aggregate.test.ts` verifies provenance is grouped by author.
- `packages/shared/src/aggregate.test.ts` verifies aggregate provenance arrays merge across repos.
- `apps/cli/src/commands/analyze.test.ts` or the nearest existing analyze coverage verifies repo JSON includes `considered` for each author.
- Dashboard typecheck verifies the modal consumes the required field.

Manual verification:

1. Run `bun test`.
2. Run `bun run lint` or the repo's current formatting/lint command.
3. Run `bun run analyze configs/browseros/browseros_config.yaml -7d`.
4. Run `bun run dashboard:sync`.
5. Open the dashboard and click each author row on Aggregate and repo tabs.

## Rollout

This is a breaking JSON shape change. Regenerate all report JSON with the updated CLI before using the dashboard. Existing generated dashboard data can be discarded and resynced from `configs/*/.results/*.json`.

