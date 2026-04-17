# Branch-Scoped Analyze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count commits and local-Git-detectable PRs across every active branch in `auctor analyze`, using fetched local Git refs.

**Architecture:** Add branch enumeration and branch-scoped log helpers in `apps/cli/src/git/log.ts`. Preserve branch names on `Commit`, group work units by branch, and update `analyzeSingleRepo` to build units from branch-scoped commits rather than one global `--all` stream.

**Tech Stack:** Bun, TypeScript, Git CLI, existing `@auctor/cli` test stack.

---

### Task 1: Add Branch-Aware Git Tests

**Files:**
- Modify: `apps/cli/src/git/log.test.ts`
- Modify: `apps/cli/src/git/work-units.test.ts`

- [ ] **Step 1: Write failing parser and branch behavior tests**

Add tests for parsing a branch field from Git log output, normalizing `origin/dev` to `dev`, and preserving branch names in parsed commits.

- [ ] **Step 2: Write failing work-unit tests**

Add tests proving `extractBranchDayUnits` groups by author, branch, and day, `extractPrUnits` assigns PR units to the merge commit branch, squash commits with subjects like `fix: package resource (#749)` count as PR units, and duplicate PR numbers reachable from multiple branches count once.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run: `bun test apps/cli/src/git/log.test.ts apps/cli/src/git/work-units.test.ts`

Expected: tests fail because `Commit` has no branch support and work-unit extraction still accepts one hard-coded branch argument.

### Task 2: Implement Branch-Aware Git Helpers

**Files:**
- Modify: `apps/cli/src/types.ts`
- Modify: `apps/cli/src/git/log.ts`

- [ ] **Step 1: Add `branch?: string` to `Commit`**

`Commit` should carry the normalized branch name when it comes from a branch-scoped log.

- [ ] **Step 2: Add branch normalization and active branch enumeration**

Implement helpers that list branch refs with `git for-each-ref`, normalize display names, and filter to refs whose histories have commits since the time-window start.

- [ ] **Step 3: Add branch-scoped log helpers**

Implement `getGitLogForBranch` and `getMergeCommitsForBranch`, each accepting a branch ref and using Git locally.

- [ ] **Step 4: Run targeted Git tests**

Run: `bun test apps/cli/src/git/log.test.ts`

Expected: all Git log tests pass.

### Task 3: Update Work-Unit Extraction

**Files:**
- Modify: `apps/cli/src/git/work-units.ts`
- Modify: `apps/cli/src/git/work-units.test.ts`

- [ ] **Step 1: Group branch-day units by commit branch**

Remove the hard-coded branch argument and group commits by `author::branch::date`.

- [ ] **Step 2: Preserve branch on PR units**

Set PR unit `branch` from the merge commit or squash commit branch.

- [ ] **Step 2.5: Deduplicate PR units by local PR identity**

Use parsed PR number as the dedupe key when available. Fall back to merge commit SHA for merge commits without a parseable PR number.

- [ ] **Step 3: Run targeted work-unit tests**

Run: `bun test apps/cli/src/git/work-units.test.ts`

Expected: all work-unit tests pass.

### Task 4: Wire Analyze to Branch-Scoped Logs

**Files:**
- Modify: `apps/cli/src/commands/analyze.ts`

- [ ] **Step 1: Enumerate active branches per repo**

After fetch, call the active branch helper. For each active branch, load commits and merge SHAs from that branch.

- [ ] **Step 2: Preserve existing author resolution and engineer filtering**

Resolve GitHub usernames after branch-scoped parsing, then filter against the configured engineer set as before.

- [ ] **Step 3: Build units from branch-aware commits**

Call the updated `extractBranchDayUnits(commits)` and `extractPrUnits(commits)`.

- [ ] **Step 4: Run CLI tests**

Run: `bun test apps/cli/src`

Expected: CLI tests pass.

### Task 5: Verify and Commit

**Files:**
- Modify only files from Tasks 1-4 and force-add this `.llm` spec/plan because `.llm/` is globally ignored.

- [ ] **Step 1: Run full verification**

Run:

```bash
bun test apps/cli/src
bun run typecheck
```

Expected: exit code 0 for both commands.

- [ ] **Step 2: Run real BrowserOS analyze check**

Run:

```bash
bun apps/cli/src/index.ts analyze browseros2.yaml -7d --json /tmp/auctor-branch-check.json
```

Expected: `shadowfax92` has substantially more than two PRs in the generated report.

- [ ] **Step 3: Commit on main**

Run:

```bash
git add -f .llm/specs/2026-04-17-branch-scoped-analyze-design.md .llm/plans/2026-04-17-branch-scoped-analyze.md
git add apps/cli/src/types.ts apps/cli/src/git/log.ts apps/cli/src/git/log.test.ts apps/cli/src/git/work-units.ts apps/cli/src/git/work-units.test.ts apps/cli/src/commands/analyze.ts
git commit -m "fix(cli): analyze active branches"
```
