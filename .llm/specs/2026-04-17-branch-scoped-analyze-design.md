# Branch-Scoped Analyze Design

## Goal

`auctor analyze` should count commits and PR merge commits on every branch that has activity inside the requested time window, using only the local Git database after fetching from remotes.

## Current Bug

The existing Git queries use `git log --all`, but the analysis pipeline discards branch identity. Branch-day work units are created with a hard-coded `main` branch, and PR work units have an empty branch. This makes the dashboard provenance misleading and undercounts PRs merged into active non-main branches such as `dev`.

## Design

Before analyzing each repo, keep the existing `git fetch --all --prune` behavior unless `--no-fetch` is supplied. Do not create or check out local branches. Instead, analyze local refs after fetch, including `refs/remotes/*` remote-tracking refs such as `origin/dev`. Treat those refs as the local mirror of remote branch state.

Enumerate branch refs that have at least one commit since the parsed time-window start. For each active branch, run branch-scoped `git log` commands against that ref. Attach a normalized branch name to each parsed commit: `origin/dev` displays as `dev`, while local-only branches keep their local names. The same commit may be counted under multiple branches for now.

Build branch-day units by grouping commits by `(author, branch, date)`. Build PR units from merge commits observed in a branch history and assign the PR unit to the branch where the merge was observed. Also treat squash-merge commits with GitHub-style PR numbers in the subject, such as `fix: package resource (#749)`, as PR units. Deduplicate PR units by parsed PR number, falling back to merge commit SHA when no PR number is available, so a PR reachable from many active refs is not counted hundreds of times. This stays local-Git-only while allowing PRs merged into `dev`, release branches, or feature branches to count.

## Error Handling

If fetch fails, keep the current behavior: warn and continue with whatever local refs are available. If branch enumeration fails, surface the Git error because analysis cannot know which refs to inspect. Empty branch lists produce no work units for that repo.

## Testing

Add unit tests around branch ref parsing and active branch discovery command behavior. Add work-unit tests proving branch-day grouping separates the same author and date across different branches, PR units retain their branch, squash commits ending in `(#123)` count as PR units, and duplicate PR numbers reachable from multiple branches count once. Add an analysis-level regression test if the current module boundaries allow it without brittle process mocks; otherwise cover the behavior through the Git and work-unit modules.

## Verification

Run the targeted CLI tests, then the full CLI test suite, root typecheck, and a real `analyze -7d` command against the BrowserOS bundle. Confirm that `shadowfax92` reports materially more than the current two PRs when branch-scoped merge commits are included.
