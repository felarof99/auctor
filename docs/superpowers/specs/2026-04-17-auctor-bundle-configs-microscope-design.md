# Auctor Bundle Configs & Microscope — Design

Date: 2026-04-17
Status: Approved for planning
Author: nithin@browseros.com

## Summary

Replace the per-repo `.auctor.json` config with a committed bundle YAML that lists several related repos and their shared engineer roster. Update `auctor configure` to add a repo to a bundle and refresh its engineers list. Update `auctor analyze` to run across every repo in a bundle and produce one combined leaderboard. Add a new `auctor microscope` command that fuzzy-picks one engineer from a bundle and prints their commits grouped by day across every repo in the bundle.

## Motivation

Today, each repo owns its own `.auctor.json`. Running auctor against a group of related repos (e.g. all browseros repos) requires configuring each one and running `analyze` per repo. There is no way to ask "what did Alice ship this week across all of browseros" without manually stitching N reports together. A bundle-centric model matches how engineers actually work: one team, many repos.

## Non-goals

- No LLM-generated daily narratives in microscope — raw commits + diffs only.
- No automatic path portability across machines; absolute paths are committed as-is.
- No backwards compatibility with `.auctor.json`; it is removed.
- No per-repo leaderboards in bundle analyze output (one combined leaderboard only).
- No changes to the existing scoring formula, Convex schema for `work_units`, or server classification API.

## Config format

One YAML file per bundle, committed under `configs/` at the repo root.

```yaml
# configs/browseros.yaml
name: browseros
server_url: https://auctor-server.fly.dev
convex_url: https://<deployment>.convex.cloud
repos:
  - name: browseros-main
    path: /Users/felarof01/Workspaces/build/browseros/browseros
    repo_url: https://github.com/browseros-ai/browseros
  - name: browseros-docs
    path: /Users/felarof01/Workspaces/build/browseros/docs
engineers:
  - felarof01
  - alice
  - bob
```

### Schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Bundle identifier used as the aggregate Convex repo doc name and in output headers. Must be unique within `configs/`. |
| `server_url` | string | no | Classification server; falls back to no-server default classification if absent, same as today. |
| `convex_url` | string | no | Convex deployment URL; bundle runs skip Convex upload if absent. |
| `repos[].name` | string | yes | Unique within this bundle. Used as the Convex per-repo doc name (preserves today's `basename(repoPath)` behavior when `name === basename(path)`). |
| `repos[].path` | string | yes | Absolute filesystem path to a git working tree. Validated at load. |
| `repos[].repo_url` | string | no | Optional remote URL (e.g. for the classification server to clone). |
| `engineers` | string[] | yes | List of git author usernames. Case-sensitive match against `getUniqueAuthors` output. May be empty immediately after `configure` creates the file but before authors are selected. |

### Persistence & location

- Files live at `configs/<bundle-name>.yaml` (flat, one file per bundle).
- `configs/` is committed to git. `configs/.results/` is gitignored (generated reports).

## Commands

### `auctor configure <config.yaml> <repo-path> <time-window>`

Purpose: add one repo to a bundle and refresh the shared engineer list from that repo.

Flow:
1. Resolve `config.yaml` path (may or may not exist yet).
2. Resolve `repo-path` to an absolute path, verify `<repo-path>/.git` exists.
3. Parse `time-window` with existing `parseTimeWindow`.
4. Run `getUniqueAuthors(repoPath, since)` to get candidate authors.
5. If the YAML does not exist, prompt for `name`, `server_url`, `convex_url` (server URL and convex URL optional; default blank).
6. Load existing YAML (if present). If `<repo-path>` is already in `repos:` (by absolute path match), skip appending the repo entry but continue to engineer selection.
7. Present a `clack.multiselect` over the candidate authors. Pre-select entries whose username already appears in `engineers:`.
8. Append repo entry: `{ name: basename(path), path: absolute-path }` (only if new).
9. Merge selected usernames into `engineers:` (set-union, preserve existing entries).
10. Write YAML back.
11. If `convex_url` is set, call `ensureRepo(client, bundle.name)` and `ensureRepo(client, repo.name)` and `ensureAuthors(client, bundleRepoId, engineers)` — mirrors today's sync behavior but against both the bundle repo doc and the per-repo doc.

Errors:
- Invalid git repo → exit 1 with clear message.
- Zero authors found in window → warn, still write the repo entry, skip the engineer prompt.
- User cancels multi-select → save the repo entry but skip engineer changes.

### `auctor analyze <config.yaml> <time-window>`

Purpose: run the full classify→score pipeline across every repo in a bundle and print one combined leaderboard.

Flow:
1. Load bundle YAML. Validate every `repos[].path` exists and is a git repo; on failure, warn and skip that repo. If all are skipped, error out.
2. If `convex_url` is set, initialize Convex client once; `ensureRepo(client, bundle.name)` for the bundle-level doc.
3. Parse `time-window` once.
4. For each repo in `bundle.repos`:
   a. `ensureRepo(client, repo.name)` → per-repo Convex doc (for work-unit attribution).
   b. `ensureAuthors` for the shared engineer list against the per-repo doc.
   c. Run existing pipeline: `getGitLog` + `getMergeCommits`, filter by `engineers`, extract branch-day + PR work units, hydrate diffs, check Convex cache, classify uncached via server, score each unit.
   d. Upload new work units to Convex (unchanged logic, scoped to per-repo doc).
   e. Collect scored units into a shared `authorUnitsMap` keyed by `author`, tagging each entry with `repo.name` for downstream reporting.
5. After all repos processed, aggregate: for each author, union all their scored units, compute `calculateAuthorScore(scores, daysInWindow)` using a single days-in-window value from the time window.
6. Render one leaderboard titled `"<bundle.name> (N repos)"` plus the existing sparkline.
7. Upload one `analysis_run` to Convex against the bundle doc ID with the aggregated `authorScores`.
8. Write combined result JSON to `configs/.results/<bundle.name>.json` (same schema as today's per-repo result, with an added `repos: [name...]` field).
9. If `--json <file>` is passed, write the existing `RepoReport` format to that path, using `bundle.name` as the repo field.

Error handling:
- Per-repo failures (git errors, classification errors) log a warning and the repo is skipped; the bundle run continues.
- Zero engineers in config → error with "run `auctor configure` first".

### `auctor microscope <config.yaml> <time-window>`

Purpose: microscope one engineer's commits across every repo in a bundle, grouped by day. No scoring, no LLM.

Flow:
1. Load bundle YAML. If `engineers:` is empty → error "run `auctor configure` first".
2. Present a fuzzy-matching prompt over `engineers:` — use `fuzzysort` for ranking and `@clack/prompts` `select` to render the top N matches as the user types (implementation detail: a small wrapper that re-renders the select options as keystrokes come in, or fall back to `clack.select` over the full list if the list is ≤ 20 engineers). Return the selected username exactly as stored in YAML. Cancel → exit 0.
3. Parse `time-window`.
4. For each repo in `bundle.repos` (sequential, missing paths logged and skipped):
   a. `getGitLog(repoPath, since)` → parse via `parseGitLog`.
   b. Filter commits to `commit.author === username`.
   c. For each commit, fetch per-commit diff stat via `getDiffForCommits(repoPath, [sha])`.
   d. Tag each commit with `repo.name`.
5. Merge commits from all repos, sort descending by date, group by `YYYY-MM-DD`.
6. Render:
   ```
   microscope: <username> — <bundle.name> (<time-window>)

   === 2026-04-17 (Fri) — 3 commits, +142/-38 ===
     [browseros-main] 4794995 fix(cli): render leaderboard when all work units are cached (+12/-4)
     [browseros-main] 33968c5 fix(server): make repo cloning optional for classification (+45/-18)
     [browseros-docs]  a1b2c3d update release notes (+85/-16)
   === 2026-04-16 (Thu) — 1 commit, +220/-12 ===
     [browseros-main] 86425ea fix(server): ensure cache directory exists before opening SQLite (+220/-12)
   ```
7. Write JSON report to `configs/.results/<bundle.name>-microscope-<username>-<YYYYMMDD-HHMM>.json` with structure `{ bundle, username, window, generated_at, days: [{ date, commits: [{ repo, sha, subject, insertions, deletions, date }], totals: { commits, insertions, deletions } }] }`.

## Architecture

### New files

- `apps/cli/src/bundle.ts` — pure functions: `loadBundle(path): BundleConfig`, `saveBundle(path, config): void`, `addRepoToBundle(config, repoEntry): BundleConfig`, `mergeEngineers(config, usernames): BundleConfig`, `findRepoByPath(config, path): BundleRepo | null`. Uses `yaml` npm package.
- `apps/cli/src/commands/microscope.ts` — new command implementation.
- `apps/cli/src/microscope-output.ts` — pure rendering function `renderMicroscope(days, username, bundle, window): string` for CLI output plus a JSON builder for the report file.
- `configs/.gitkeep` — ensure directory exists in git.

### Modified files

- `apps/cli/src/commands/configure.ts` — full rewrite. Signature changes from `(timeWindow, path)` to `(configPath, repoPath, timeWindow)`.
- `apps/cli/src/commands/analyze.ts` — full rewrite around a "repo loop + aggregate" shape. Extract the per-repo pipeline into a helper `analyzeSingleRepo(repo, bundle, context): PerRepoResult` and keep aggregation logic in `analyze()`.
- `apps/cli/src/types.ts` — add `BundleConfig`, `BundleRepo` types. Keep existing `AuthorStats`, `Commit`, `DailyScore` as-is. Remove the old `Config` type.
- `apps/cli/src/index.ts` — update `configure` and `analyze` command signatures; register `microscope` command.
- `.gitignore` — add `configs/.results/`.
- `apps/cli/package.json` — add `yaml` and `fuzzysort` dependencies.

### Removed behavior

- All reads/writes of `.auctor.json` in any command.
- The old `Config` type in `types.ts`.

### Convex schema impact

None. Continues to use existing `repos`, `authors`, `work_units`, `analysis_runs` tables. The only new usage pattern is that a bundle's `analysis_run` is written against a bundle-level `repos` doc whose `name === bundle.name`, which coexists with the per-repo docs used for work-unit attribution.

## Data flow (analyze)

```
bundle.yaml ─┐
             ├──► analyze()
repos + window
             │
             ▼
   for each repo ──► ensureRepo, ensureAuthors
                     getGitLog + getMergeCommits
                     extractBranchDayUnits + extractPrUnits
                     getDiffForCommits
                     findExistingWorkUnit (cache)
                     classifyWorkUnits (server, uncached only)
                     calculateUnitScore
                     insertWorkUnit (new only)
                     → append {author, date, score, repo.name} to shared map
             │
             ▼
   aggregate per author across all repos
             │
             ▼
   calculateAuthorScore per author
   computeDailyScores per author
             │
             ▼
   renderLeaderboard + renderSparklines (one leaderboard)
   insertAnalysisRun (bundle-level, aggregate authorScores)
   write configs/.results/<bundle>.json
   optional RepoReport JSON via --json
```

## Testing strategy

- `bundle.test.ts` — load/save roundtrip, merge-repo idempotence, engineer set-union semantics, missing-file behavior.
- `configure.test.ts` — integration test using a tmp YAML and a tmp git repo (`git init`, seeded commits); assert post-run YAML matches expected; test the "repo already in bundle" path.
- `analyze.test.ts` — integration test with two tmp git repos in one bundle; mock `classifyWorkUnits` to return deterministic classifications; assert leaderboard is aggregated across repos and the combined score equals the sum of per-repo scores for each author.
- `microscope.test.ts` — integration test with two tmp git repos; one engineer commits to both; assert day-grouping is correct and per-commit repo attribution is right.
- `microscope-output.test.ts` — snapshot test on rendering with a deterministic fixture.

No new test infrastructure required beyond `Bun.spawn`/`bun test` already in use.

## Edge cases

- Bundle with no Convex URL → analyze runs fully offline, just prints the leaderboard and writes local JSON.
- Repo in bundle has no commits from any engineer in window → contributes zero, does not break the aggregate.
- Engineer in bundle has no commits in any repo in window → excluded from leaderboard (same as today).
- YAML file with duplicate `repos[].name` → error at load time (validation).
- YAML with duplicate absolute `repos[].path` → collapse to one entry silently (configure's add-repo path matching already prevents this for new writes).
- Microscope fuzzy-match returns multiple candidates → clack autocomplete handles selection; if the engineer types an unknown prefix, clack returns no selection and the command exits cleanly.

## Open questions

None at design time. All clarifications resolved during brainstorming.

## Rollout

Single PR. No feature flag. The command surface changes are breaking (removal of `.auctor.json`) but this tool is used only by the author.
