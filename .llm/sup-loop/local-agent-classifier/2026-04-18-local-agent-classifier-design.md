# Local Agent Classifier Design

## Goal

Add a local classifier backend that runs on the user's machine and classifies Auctor work units by launching local Claude Code and Codex executor processes against the local repository context. The backend should support a configured parallelism cap up to 10 concurrent executor processes.

## Assumptions

- The user will run the classifier server locally on the Mac Studio for this workflow.
- `claude` and `codex` are already installed and authenticated in the user's shell environment.
- The classification target remains Auctor's existing `WorkUnit` shape, not a new per-commit scoring primitive.
- Default local parallelism should be conservative at 4 and configurable up to 10.

## Non-Goals

- Do not build a Paperclip heartbeat/runtime system.
- Do not persist or resume Claude/Codex sessions across classifications.
- Do not add skills bundle injection for classifier agents.
- Do not replace the Bedrock backend; keep it as a selectable backend.
- Do not let classifier agents intentionally edit repository files.

## Current System

The server classifier path already exists:

- `apps/server/src/routes/classify.ts` exposes `POST /api/classify`.
- `apps/server/src/classifier/agent.ts` currently calls Bedrock Converse.
- `apps/server/src/classifier/prompt.ts` builds the classification prompt.
- `apps/server/src/classifier/cache.ts` caches classifications in SQLite.
- `packages/shared/src/classification.ts` defines `WorkUnit` and `Classification`.

The CLI path is only partially wired:

- `apps/cli/src/api-client.ts` can call `/api/classify`.
- `BundleConfig` has `server_url`.
- `apps/cli/src/commands/analyze.ts` currently gives every hydrated work unit a default classification, so real classifier output does not yet affect scores.

## Chosen Architecture

Keep classification behind the server route and add a second classifier backend:

```text
auctor analyze
  -> hydrate WorkUnit diffs from local repos
  -> if bundle.server_url is set, POST /api/classify with work units + local repo path
  -> server resolves repoDir
  -> backend=local-agent schedules missing units through bounded worker pool
  -> each worker runs claude -p or codex exec in scratch repo context
  -> parse final JSON, validate ClassificationSchema, cache, return
  -> CLI scores units with returned classifications
```

This preserves the server API as the integration point while making the compute local when `server_url` points at a locally running server.

## Configuration

Add server-side classifier config in a small module such as `apps/server/src/classifier/config.ts`.

Environment variables:

```bash
CLASSIFIER_BACKEND=bedrock | local-agent
LOCAL_CLASSIFIER_EXECUTORS=claude,codex
LOCAL_CLASSIFIER_MAX_PARALLEL=4
LOCAL_CLASSIFIER_TIMEOUT_SECONDS=240
LOCAL_CLASSIFIER_REPAIR_ATTEMPTS=1

LOCAL_CLASSIFIER_CLAUDE_COMMAND=claude
LOCAL_CLASSIFIER_CLAUDE_MODEL=
LOCAL_CLASSIFIER_CLAUDE_EFFORT=
LOCAL_CLASSIFIER_CLAUDE_MAX_TURNS=2
LOCAL_CLASSIFIER_CLAUDE_SKIP_PERMISSIONS=true

LOCAL_CLASSIFIER_CODEX_COMMAND=codex
LOCAL_CLASSIFIER_CODEX_MODEL=gpt-5.4
LOCAL_CLASSIFIER_CODEX_REASONING_EFFORT=medium
LOCAL_CLASSIFIER_CODEX_BYPASS_APPROVALS=true
```

Validation rules:

- `CLASSIFIER_BACKEND` defaults to `bedrock` to preserve existing deployed behavior.
- `LOCAL_CLASSIFIER_MAX_PARALLEL` defaults to 4 and clamps to 1-10.
- `LOCAL_CLASSIFIER_EXECUTORS` must include `claude`, `codex`, or both.
- Command names default to `claude` and `codex`, but can be absolute paths.
- If backend is `local-agent` and no executor is enabled, fail server startup or return a route-level 500 before accepting work.

The user's local bundle can keep using the existing field:

```yaml
server_url: http://localhost:3001
```

The local server owns executor details. Bundle YAML does not need to describe Claude/Codex internals in v1.

## API Changes

Extend `ClassifyRequest` without breaking existing callers:

```ts
export interface ClassifyRequest {
  repo_url: string
  repo_path?: string
  work_units: WorkUnit[]
}
```

Resolution order in the server:

1. If `repo_path` is present and points at a git repo, use it.
2. Else, if `repo_url` points at a local git repo path, use it.
3. Else clone/pull through `RepoManager` as the current route does.
4. If repo resolution fails, continue with a temp cwd and the diff-only prompt, but mark logs clearly.

Update the CLI request builder to pass both remote and local context:

```ts
buildClassifyPayload({
  repoUrl: repo.repo_url ?? repo.path,
  repoPath: repo.path,
  workUnits,
})
```

## Backend Interface

Create a small backend abstraction:

```ts
export interface ClassifierBackend {
  classifyMany(input: {
    repoDir: string
    workUnits: WorkUnit[]
  }): Promise<Map<string, Classification>>
}
```

Implementations:

- `BedrockClassifierBackend`: wraps the current Bedrock `classifyWorkUnit`.
- `LocalAgentClassifierBackend`: orchestrates Claude/Codex child processes.

The route should:

1. Validate request.
2. Resolve `repoDir`.
3. Split work units into cached and missing using the new cache key.
4. Call `backend.classifyMany` for missing units.
5. Cache valid classifications.
6. Return classifications in the same order as requested.

## Local Executor Orchestrator

Add local-agent files under `apps/server/src/classifier/local/`:

```text
config.ts
executor.ts
claude.ts
codex.ts
json.ts
orchestrator.ts
workspace.ts
```

Core types:

```ts
type LocalExecutorType = 'claude' | 'codex'

interface LocalExecutorConfig {
  type: LocalExecutorType
  command: string
  model?: string
  effort?: string
  timeoutMs: number
  extraArgs: string[]
}

interface LocalClassificationTask {
  unit: WorkUnit
  repoDir: string
  workspaceDir: string
  prompt: string
}

interface LocalExecutor {
  type: LocalExecutorType
  classify(task: LocalClassificationTask): Promise<Classification>
}
```

Scheduling:

- Use a bounded promise pool with a global max parallelism.
- Clamp max parallelism to 1-10.
- Assign executors round-robin across enabled executor types.
- A single unit failure should not stop the whole batch.
- Preserve response order by mapping results back to `unit.id`.

This is the Paperclip-inspired part: use child-process adapters, structured output parsing, timeout handling, and clear execution metadata. Do not adopt heartbeat sessions.

## Executor Commands

Claude Code command:

```bash
claude --print - --output-format stream-json --verbose \
  --max-turns 2 \
  --dangerously-skip-permissions \
  [--model <model>] \
  [--effort <effort>]
```

Prompt is piped through stdin. Parse stdout line-by-line and extract the final `result.result` text from the `result` event. Also capture `system.init.session_id`, model, usage, and cost if present for logs.

Codex command:

```bash
codex exec --json \
  --dangerously-bypass-approvals-and-sandbox \
  [--model <model>] \
  [-c model_reasoning_effort="<effort>"] \
  -
```

Prompt is piped through stdin. Parse JSONL stdout and extract the final `item.completed` event where `item.type === 'agent_message'`. Capture `thread.started.thread_id` and `turn.completed.usage` for logs.

The implementation should keep the command builders small and tested, borrowing the command shapes and JSON parsers from Paperclip rather than importing Paperclip packages.

## Workspace Safety

Executors need repo context but should not touch the user's active working tree.

For local git repos, create temporary scratch worktrees:

```text
/tmp/auctor-local-classifier/<run-id>/slot-0
/tmp/auctor-local-classifier/<run-id>/slot-1
...
```

Rules:

- Create one scratch worktree per concurrent slot with `git worktree add --detach <slotDir> HEAD`.
- Run executor processes with `cwd` set to a slot worktree.
- Clean up worktrees after the batch with `git worktree remove --force <slotDir>`.
- If worktree creation fails, fall back to using `repoDir` directly and record a warning.
- Never auto-revert the user's active repo. If a fallback direct-cwd executor dirties the repo, fail loudly after detecting `git status --porcelain`.

The prompt should still instruct the agent to inspect only and not edit files, but scratch worktrees are the real safety boundary.

## Prompt Design

Keep the current classification schema and reuse most of `buildClassificationPrompt(unit)`, then add local-repo instructions for executor backends:

```text
You are running in a local git checkout for this repo.
Use repository context only if it helps classify the work unit.
Prefer read-only commands such as git show, git diff, git log, rg, and sed.
Do not edit files, run formatters, install dependencies, commit, or modify git state.
Return only a JSON object matching the schema.
```

Include:

- Work unit metadata.
- Commit SHAs.
- Commit messages.
- Existing diff payload.
- Repo context instructions.
- Exact JSON schema.

Keep the prompt versioned with a constant such as `LOCAL_CLASSIFIER_PROMPT_VERSION = 1` so cache invalidation is explicit when prompt semantics change.

## JSON Parsing And Validation

Agents may wrap JSON in markdown or include commentary despite instructions. Implement a tolerant parser:

1. Try `JSON.parse(finalText)`.
2. Try fenced code block extraction.
3. Try first balanced JSON object extraction.
4. Validate with `ClassificationSchema`.
5. If parsing or validation fails, run one repair prompt against the same executor:

```text
Your previous response was not valid classification JSON.
Return only a JSON object matching this schema: ...
Previous response: ...
```

If repair fails, return fallback classification for that unit:

```ts
{
  type: 'feature',
  difficulty: 'medium',
  impact_score: 5,
  reasoning: `Local classifier failed via ${executor}: ${shortError}`,
}
```

## Cache Design

Replace the current `work_unit_id`-only cache key with a content/config key:

```ts
cacheKey = sha256(JSON.stringify({
  unitId: unit.id,
  commitShas: unit.commit_shas,
  diffHash: sha256(unit.diff),
  promptVersion: LOCAL_CLASSIFIER_PROMPT_VERSION,
  backend: 'local-agent',
  executor: executor.type,
  model: executor.model ?? null,
  effort: executor.effort ?? null,
}))
```

SQLite table shape:

```sql
CREATE TABLE IF NOT EXISTS classifications (
  cache_key TEXT PRIMARY KEY,
  work_unit_id TEXT NOT NULL,
  backend TEXT NOT NULL,
  executor TEXT,
  classification_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

The cache class can keep compatibility helpers, but route code should use the new key. This prevents Bedrock, Claude, and Codex classifications from overwriting each other.

## CLI Wiring

Update `apps/cli/src/commands/analyze.ts`:

1. Hydrate work units with diffs as it does now.
2. If `bundle.server_url` is set, call `classifyWorkUnits`.
3. Pass `repo.repo_url ?? repo.path` as `repo_url` and `repo.path` as `repo_path`.
4. Fill `classificationMap` from the response.
5. For missing/failed units, keep the existing default classification and print a warning.
6. If `bundle.server_url` is absent, preserve existing default-classification behavior.

This makes local classification opt-in through the existing config field.

## Error Handling

Route-level errors:

- Invalid payload: 400, as today.
- No local executors configured: 500 with a clear message.
- Repo resolution failure: continue diff-only unless the backend requires repo context and no diff exists.

Per-unit errors:

- Spawn `ENOENT`: fallback classification with "command not found" reasoning.
- Auth/login required: fallback classification with "auth required" reasoning.
- Timeout: kill the process group, fallback with timeout reasoning.
- Invalid JSON after repair: fallback with parse reasoning.
- Schema validation failure: fallback with validation reasoning.

Each per-unit failure should log executor type, unit id, exit code, timeout flag, and the first non-empty stderr line.

## Tests

Add focused tests without requiring real Claude or Codex:

1. Config parsing clamps `LOCAL_CLASSIFIER_MAX_PARALLEL` to 1-10.
2. Executor selection round-robins across `claude,codex`.
3. The bounded pool never runs more than the configured max concurrently.
4. Claude stream-json parser extracts final result text and session id.
5. Codex JSONL parser extracts final agent message and thread id.
6. JSON extraction handles raw JSON, fenced JSON, and commentary with an embedded object.
7. Cache key changes when diff hash, prompt version, backend, executor, or model changes.
8. `/api/classify` uses cached results before launching local executors.
9. `/api/classify` passes `repo_path` to repo resolution when provided.
10. CLI `analyze` calls the classifier when `bundle.server_url` is present and uses returned classifications for scoring.

Use fake executable scripts in temp directories for integration tests:

- Fake Claude emits stream-json lines.
- Fake Codex emits JSONL events.
- Timeout fake sleeps beyond the configured timeout.
- Invalid fake emits malformed JSON to exercise repair/fallback.

## Verification

Run targeted tests:

```bash
bun test apps/server/src/classifier
bun test apps/server/src/routes/classify.test.ts
bun test apps/cli/src/api-client.test.ts apps/cli/src/commands/analyze.test.ts
```

Then run broader checks:

```bash
bun test apps/server/src apps/cli/src packages/shared/src
bun run typecheck
bun run lint
```

Manual local smoke test:

```bash
CLASSIFIER_BACKEND=local-agent \
LOCAL_CLASSIFIER_EXECUTORS=claude,codex \
LOCAL_CLASSIFIER_MAX_PARALLEL=10 \
bun run --cwd apps/server dev
```

In another shell:

```bash
bun apps/cli/src/index.ts analyze configs/browseros/browseros_config.yaml -3d --json /tmp/auctor-local-classifier.json
```

Expected result:

- Server logs show up to 10 concurrent local executor processes.
- CLI output uses non-default classifications.
- Report JSON scores change compared with default-only classification.
- The active repo working tree remains unchanged.

## Implementation Order

1. Add config parsing and backend interface.
2. Move current Bedrock call behind `BedrockClassifierBackend`.
3. Add local executor command builders and parsers.
4. Add JSON extraction, schema validation, and repair retry.
5. Add bounded orchestrator and scratch worktree manager.
6. Update cache keys and migration-safe table creation.
7. Update `/api/classify` to select backend and classify missing units in batches.
8. Update shared API and CLI payload builder with `repo_path`.
9. Wire `analyze` to call the classifier when `server_url` is configured.
10. Add fake-executor tests and run verification.

## Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Internal consistency: the design keeps the existing server API boundary, adds local executors behind it, and wires the CLI path that currently ignores classifiers.
- Scope check: this is one implementation plan. It avoids Paperclip heartbeat/session features and focuses on request/response classification.
- Ambiguity check: parallelism, executor command shapes, cache invalidation, fallback behavior, and repo context resolution are explicit.
