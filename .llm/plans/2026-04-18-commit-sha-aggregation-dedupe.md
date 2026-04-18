# Commit SHA Aggregation Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduplicate branch-inflated commit SHA contributions during CLI aggregation while preserving branch-scoped collection and PR counting.

**Architecture:** Keep branch-scoped Git collection unchanged. Add exact per-commit evidence to branch-day `PerRepoScoredUnit`s, then teach `aggregateBundleResults` to count each `repo::sha` once per author bucket and scale branch-day score by the unique portion of each unit.

**Tech Stack:** Bun, TypeScript, existing `@auctor/cli` test suite.

---

### Task 1: Add Aggregation Dedupe Tests

**Files:**
- Modify: `apps/cli/src/analyze-aggregate.test.ts`

- [ ] **Step 1: Add a duplicate SHA test**

Add a test where two branch-day `PerRepoScoredUnit`s for `alice` contain the same `repo::sha` through `commitDetails`.

```ts
test('deduplicates commit details by repo and sha per author', () => {
  const units: PerRepoScoredUnit[] = [
    {
      author: 'alice',
      repoName: 'main',
      date: '2026-04-15',
      score: 1,
      commits: 1,
      isPr: false,
      insertions: 10,
      deletions: 2,
      commitDetails: [
        {
          repo: 'main',
          sha: 'same-sha',
          branch: 'dev',
          message: 'feat: same',
          insertions: 10,
          deletions: 2,
        },
      ],
      considered: { commits: [], prs: [] },
    },
    {
      author: 'alice',
      repoName: 'main',
      date: '2026-04-15',
      score: 1,
      commits: 1,
      isPr: false,
      insertions: 10,
      deletions: 2,
      commitDetails: [
        {
          repo: 'main',
          sha: 'same-sha',
          branch: 'release',
          message: 'feat: same',
          insertions: 10,
          deletions: 2,
        },
      ],
      considered: { commits: [], prs: [] },
    },
  ]

  const out = aggregateBundleResults(units, new Date('2026-04-14T00:00:00Z'), 7)
  const alice = out.find((a) => a.author === 'alice')

  expect(alice?.commits).toBe(1)
  expect(alice?.insertions).toBe(10)
  expect(alice?.deletions).toBe(2)
  expect(alice?.net).toBe(8)
  expect(alice?.considered.commits).toEqual([
    {
      repo: 'main',
      branch: 'dev',
      sha: 'same-sha',
      message: 'feat: same',
    },
  ])
})
```

- [ ] **Step 2: Add a mixed-score scaling test**

Add a test where a second unit has one duplicate commit and one new commit. Use equal absolute net LOC so the second unit contributes half its score.

```ts
test('scales branch-day score by the unique commit portion', () => {
  const units: PerRepoScoredUnit[] = [
    {
      author: 'alice',
      repoName: 'main',
      date: '2026-04-15',
      score: 1,
      commits: 1,
      isPr: false,
      insertions: 10,
      deletions: 0,
      commitDetails: [
        {
          repo: 'main',
          sha: 'a',
          branch: 'dev',
          message: 'feat: a',
          insertions: 10,
          deletions: 0,
        },
      ],
      considered: { commits: [], prs: [] },
    },
    {
      author: 'alice',
      repoName: 'main',
      date: '2026-04-16',
      score: 1,
      commits: 2,
      isPr: false,
      insertions: 20,
      deletions: 0,
      commitDetails: [
        {
          repo: 'main',
          sha: 'a',
          branch: 'release',
          message: 'feat: a',
          insertions: 10,
          deletions: 0,
        },
        {
          repo: 'main',
          sha: 'b',
          branch: 'release',
          message: 'feat: b',
          insertions: 10,
          deletions: 0,
        },
      ],
      considered: { commits: [], prs: [] },
    },
  ]

  const out = aggregateBundleResults(units, new Date('2026-04-14T00:00:00Z'), 7)
  const alice = out.find((a) => a.author === 'alice')

  expect(alice?.commits).toBe(2)
  expect(alice?.score).toBeCloseTo(0.214285, 5)
})
```

- [ ] **Step 3: Add a legacy fallback test**

Add a test proving non-PR units without `commitDetails` still count `commits`, LOC, score, and `considered.commits` from their rolled-up fields.

- [ ] **Step 4: Run red tests**

Run: `bun test apps/cli/src/analyze-aggregate.test.ts`

Expected: fail because `PerRepoScoredUnit` has no `commitDetails` and aggregation still sums rolled-up duplicate units.

### Task 2: Extend Aggregation Types and Logic

**Files:**
- Modify: `apps/cli/src/analyze-aggregate.ts`

- [ ] **Step 1: Add the commit detail type**

Add:

```ts
export interface PerRepoCommitDetail {
  repo: string
  sha: string
  branch?: string
  message: string
  insertions: number
  deletions: number
}
```

Then add `commitDetails?: PerRepoCommitDetail[]` to `PerRepoScoredUnit`.

- [ ] **Step 2: Track seen commits per author**

Extend `AuthorBucket`:

```ts
seenCommitKeys: Set<string>
```

Initialize it with `new Set<string>()`.

- [ ] **Step 3: Add score scaling helpers**

Implement local helpers:

```ts
function commitKey(detail: PerRepoCommitDetail): string {
  return `${detail.repo}::${detail.sha}`
}

function absNetLoc(detail: PerRepoCommitDetail): number {
  return Math.abs(detail.insertions - detail.deletions)
}

function scaledScore(
  score: number,
  details: PerRepoCommitDetail[],
  uniqueDetails: PerRepoCommitDetail[],
): number {
  if (details.length === 0) return score
  const totalWeight = details.reduce((sum, d) => sum + absNetLoc(d), 0)
  if (totalWeight > 0) {
    const uniqueWeight = uniqueDetails.reduce((sum, d) => sum + absNetLoc(d), 0)
    return score * (uniqueWeight / totalWeight)
  }
  return score * (uniqueDetails.length / details.length)
}
```

- [ ] **Step 4: Deduplicate non-PR units**

Inside the aggregation loop:

```ts
if (!u.isPr && u.commitDetails && u.commitDetails.length > 0) {
  const uniqueDetails = u.commitDetails.filter((detail) => {
    const key = commitKey(detail)
    if (b.seenCommitKeys.has(key)) return false
    b.seenCommitKeys.add(key)
    return true
  })
  b.scoredUnits.push({
    date: u.date,
    score: scaledScore(u.score, u.commitDetails, uniqueDetails),
  })
  b.commits += uniqueDetails.length
  b.insertions += uniqueDetails.reduce((sum, d) => sum + d.insertions, 0)
  b.deletions += uniqueDetails.reduce((sum, d) => sum + d.deletions, 0)
  b.considered.commits.push(
    ...uniqueDetails.map(({ repo, branch, sha, message }) => ({
      repo,
      ...(branch ? { branch } : {}),
      sha,
      message,
    })),
  )
  buckets.set(u.author, b)
  continue
}
```

For PR units, add the full score, increment `prs`, and append PR provenance, but do not add PR unit `commits`, `insertions`, or `deletions` to commit/LOC totals. Leave the existing rolled-up behavior only for legacy non-PR units without `commitDetails`.

- [ ] **Step 5: Run aggregation tests**

Run: `bun test apps/cli/src/analyze-aggregate.test.ts`

Expected: pass.

### Task 3: Populate Commit Details From Analyze

**Files:**
- Modify: `apps/cli/src/commands/analyze.ts`

- [ ] **Step 1: Build a commit lookup**

After engineer filtering and before work-unit extraction, create:

```ts
const commitByBranchAndSha = new Map(
  commits.map((commit) => [`${commit.branch ?? 'unknown'}::${commit.sha}`, commit]),
)
```

- [ ] **Step 2: Add a helper for branch-day units**

Add a local helper near `buildConsideredItemsForUnit`:

```ts
function buildCommitDetailsForUnit(
  repoName: string,
  unit: WorkUnit,
  commitByBranchAndSha: Map<string, Commit>,
) {
  if (unit.kind === 'pr') return []
  return unit.commit_shas.map((sha, i) => {
    const commit = commitByBranchAndSha.get(`${unit.branch}::${sha}`)
    return {
      repo: repoName,
      branch: unit.branch,
      sha,
      message: unit.commit_messages[i] ?? '',
      insertions: commit?.insertions ?? 0,
      deletions: commit?.deletions ?? 0,
    }
  })
}
```

- [ ] **Step 3: Include commit details in scored units**

When pushing `PerRepoScoredUnit`, add:

```ts
commitDetails: buildCommitDetailsForUnit(
  repo.name,
  unit,
  commitByBranchAndSha,
),
```

- [ ] **Step 4: Run CLI tests**

Run: `bun test apps/cli/src`

Expected: pass.

### Task 4: Verify Real Analysis and Commit

**Files:**
- Modify: `apps/cli/src/analyze-aggregate.ts`
- Modify: `apps/cli/src/analyze-aggregate.test.ts`
- Modify: `apps/cli/src/commands/analyze.ts`

- [ ] **Step 1: Run verification**

Run:

```bash
bun test apps/cli/src/analyze-aggregate.test.ts
bun test apps/cli/src
bun run typecheck
bun run lint
```

Expected: all commands exit 0. `bun run lint` may print the existing Biome schema/generated-code warnings but must exit 0.

- [ ] **Step 2: Run real BrowserOS analysis**

Run:

```bash
bun apps/cli/src/index.ts analyze configs/browseros/browseros_config.yaml -7d --json /tmp/auctor-dedupe-check.json
```

Expected: `shadowfax92` PR count remains in the previous expected range, while commit totals are lower than the branch-inflated count.

- [ ] **Step 3: Commit**

Run:

```bash
git add apps/cli/src/analyze-aggregate.ts apps/cli/src/analyze-aggregate.test.ts apps/cli/src/commands/analyze.ts
git commit -m "fix(cli): dedupe commit shas in aggregation"
```
