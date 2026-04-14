# Auctor Scoring System Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

A scoring system that assigns each author a single productivity score based on the complexity of code they checked in, LOC, classification (feature/bugfix/etc.), and difficulty (trivial to complex). Scores are absolute and comparable across repos for leaderboard ranking.

## 1. Work Unit Extraction

Two types of work units are extracted from git history:

### PR Units
- When a PR/merge commit exists, group all commits in the PR by author
- One work unit per author per PR
- Diff = the full PR diff for that author's commits

### Branch-Day Units
- Group all commits by (author, branch, date)
- One work unit per author per branch per day
- Diff = combined diff of that author's commits on that branch for that day

Double counting is intentional: a PR spanning 3 days produces 1 PR unit + 3 branch-day units for the same author.

## 2. AI Classification Schema

Each work unit is classified by Claude Agent SDK running on the server, with full repo access.

### Zod Schema

```typescript
const ClassificationSchema = z.object({
  type: z.enum(["feature", "bugfix", "refactor", "chore", "test", "docs"]),
  difficulty: z.enum(["trivial", "easy", "medium", "hard", "complex"]),
  impact_score: z.number().min(0).max(10),
  reasoning: z.string(),
})
```

### Agent Context

**Prompt receives:**
- The full diff for the work unit
- Commit messages
- Work unit metadata (author, branch, date range)

**Agent can use tools:**
- `Read` — read any file in the repo to understand what the diff touches
- `Grep` — search for usages of changed functions
- `Bash` — run git commands, check critical paths

### Classification Caching
- Key: SHA256 of sorted commit hashes in the work unit
- Storage: server-side (SQLite)
- Re-classifying the same commits is a no-op

## 3. Scoring Formula

Each work unit is scored in three steps.

### Step 1: LOC Factor (0 to 1)

```
loc_factor = min(1.0, log2(1 + net_loc) / log2(1 + 10000))
```

| Net LOC | loc_factor |
|---------|-----------|
| 100     | 0.50      |
| 1000    | 0.75      |
| 2000    | 0.83      |
| 5000    | 0.92      |
| 10000+  | 1.00      |

### Step 2: Formula Score

```
formula_score = loc_factor x difficulty_weight
```

| Difficulty | Weight |
|-----------|--------|
| trivial   | 0.2    |
| easy      | 0.5    |
| medium    | 1.0    |
| hard      | 1.5    |
| complex   | 2.0    |

### Step 3: Blended Unit Score

```
normalized_ai_score = impact_score / 10
unit_score = (0.5 x formula_score + 0.5 x normalized_ai_score) x type_weight
```

| Type     | Weight |
|----------|--------|
| feature  | 1.0    |
| bugfix   | 0.8    |
| refactor | 0.7    |
| docs     | 0.6    |
| test     | 0.5    |
| chore    | 0.3    |

### Worked Example

Alice ships a hard feature PR, 400 net LOC, AI gives impact 8/10:

```
loc_factor    = log2(401) / log2(10001) = 0.65
formula_score = 0.65 x 1.5 = 0.975
normalized_ai = 8 / 10 = 0.8
unit_score    = (0.5 x 0.975 + 0.5 x 0.8) x 1.0 = 0.8875
```

## 4. Author Aggregation

```
author_score = sum(all unit_scores) / days_in_window
```

- `days_in_window` = the number in the time flag (e.g., 7 for `-7d`)
- Gives average daily productivity, comparable across repos and time windows
- PR units and branch-day units from the same work both count (intentional)

### Output Table

```
Rank  Author        Commits  +LOC   -LOC   Net    Score
1     Alice           12     1,240   380    860    0.82
2     Bob              8       650   120    530    0.61
```

Sorted by Score descending.

## 5. Architecture

### CLI (`apps/cli/`)
Thin client:
```
auctor analyze -7d --path .
  -> extract work units from git history (local git commands)
  -> POST /api/classify to server with work units + diffs
  -> receive classifications back
  -> compute scores locally (formula runs client-side)
  -> render ranked table
```

### Server (`apps/server/`)
Hosted on Fly.io:
```
POST /api/classify { repo_url, work_units[] with diffs }
  -> clones repo on first request (git clone), git pull on subsequent
  -> repos cached on server disk by repo_url
  -> Agent SDK query() per work unit:
      - full repo access via Read/Grep/Bash tools
      - Zod structured output (type, difficulty, impact_score, reasoning)
  -> cache classifications by commit SHA
  -> return classifications[]
```

### Key Decisions
- Scoring formula runs client-side in the CLI, not on the server
- Server only returns `{ type, difficulty, impact_score, reasoning }`
- Weights can be tweaked locally without redeploying the server
- Claude Agent SDK with Zod structured output for classification
- Agent has full repo access to understand context beyond the diff

### Monorepo Structure

```
apps/
  cli/          <- git extraction, scoring, table output
  server/       <- classification service (Agent SDK + Fly.io)
  dashboard/    <- visualization (future)
```

## 6. Leaderboard & Cross-Repo Comparison

Scores are absolute (average daily productivity), directly comparable across repos.

### Benchmarking Flow

```bash
# Your repo
auctor analyze -7d --path .

# Competitor repo
git clone https://github.com/competitor/repo /tmp/competitor
auctor configure --path /tmp/competitor
auctor analyze -7d --path /tmp/competitor
```

### Data Output

Each `analyze` run produces JSON in `.auctor/results/`:

```json
{
  "repo": "auctor-v4",
  "window": "7d",
  "analyzed_at": "2026-04-14T12:00:00Z",
  "authors": [
    {
      "name": "Alice",
      "score": 0.82,
      "commits": 12,
      "loc_added": 1240,
      "loc_removed": 380,
      "loc_net": 860,
      "work_units": [
        {
          "type": "pr",
          "classification": {
            "type": "feature",
            "difficulty": "hard",
            "impact_score": 8
          },
          "unit_score": 0.955
        }
      ]
    }
  ]
}
```

### Cross-Repo Leaderboard

```
Repo              Author        Score   Commits   Net LOC
auctor-v4         Alice          0.82      12       860
auctor-v4         Bob            0.61       8       530
competitor/repo   Carol          0.74      15       920
competitor/repo   Dave           0.53       6       410
```

The dashboard consumes these JSON files for richer visualization.
