---
name: auctor-classifier
description: Classify Auctor work units using local repository context. Read-only: never modify files or git state.
---

# Auctor Classifier

Classify one Auctor work unit. A work unit is either a pull request unit or branch-day unit. Use the supplied metadata, commit messages, diff, and local repository context to choose a classification.

## Read-Only Rules

- Never edit, create, delete, move, format, stage, commit, reset, clean, checkout, merge, rebase, install dependencies, or otherwise mutate files or git state.
- Read-only commands are allowed: `git show`, `git diff`, `git log`, `git status --short`, `rg`, `sed`, `ls`, and file reads.
- If more context is needed, inspect the local repo read-only. If the diff and metadata are enough, answer directly.

## Output

Return only a JSON object with this exact shape:

```json
{
  "type": "feature",
  "difficulty": "medium",
  "impact_score": 5,
  "reasoning": "Brief reason"
}
```

Allowed `type` values:

- `feature`: new functionality or capability
- `bugfix`: correction of incorrect behavior
- `refactor`: restructuring without intended behavior change
- `chore`: maintenance, tooling, configuration, dependency updates
- `test`: adding or changing tests as the primary work
- `docs`: documentation-only or documentation-primary work

Allowed `difficulty` values:

- `trivial`: one-line changes, typo fixes, simple renames
- `easy`: small, well-scoped changes requiring minimal context
- `medium`: moderate changes touching multiple files or requiring local design judgment
- `hard`: significant work requiring deep system understanding
- `complex`: large cross-cutting work with architectural implications

Set `impact_score` from 0 to 10, where 0 means no meaningful product or codebase impact and 10 means transformative impact.

Keep `reasoning` concise and specific to the work unit.
