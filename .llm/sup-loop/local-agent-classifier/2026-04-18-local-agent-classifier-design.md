# Local Agent Classifier Design

## Goal

Add a local classifier backend that runs on the user's machine and classifies Auctor work units by launching local Claude Code and Codex executor processes against the local repository context. The backend should support a configured parallelism cap up to 10 concurrent executor processes.

## Assumptions

- The user will run the classifier server locally on the Mac Studio for this workflow.
- `claude` and `codex` are already installed and authenticated in the user's shell environment.
- The classification target remains Auctor's existing `WorkUnit` shape, not a new per-commit scoring primitive.
- Default local parallelism should be conservative at 4 and configurable up to 10.
- Classifier agents can be trusted to follow a strict read-only classifier skill; v1 does not need scratch worktree isolation.

## Non-Goals

- Do not build a Paperclip heartbeat/runtime system.
- Do not persist or resume Claude/Codex sessions across classifications.
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
  -> if bundle.server_url is set, POST /api/classify with work units + repo_path
  -> server validates repo_path as a local git repo
  -> backend=local-agent schedules missing units through bounded worker pool
  -> each worker runs claude -p or codex exec in repo_path with classifier skills injected
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
LOCAL_CLASSIFIER_SKILL_PATH=./apps/server/skills/auctor-classifier
LOCAL_CLASSIFIER_EXTRA_SKILL_PATHS=

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
- `LOCAL_CLASSIFIER_SKILL_PATH` must point at a classifier skill directory containing `SKILL.md` when backend is `local-agent`.
- `LOCAL_CLASSIFIER_EXTRA_SKILL_PATHS` is an optional comma-separated list of additional skill directories.
- Command names default to `claude` and `codex`, but can be absolute paths.
- If backend is `local-agent` and no executor is enabled, fail server startup or return a route-level 500 before accepting work.

The user's local bundle can keep using the existing field:

```yaml
server_url: http://localhost:3001
```

The local server owns executor and skill details. Bundle YAML does not need to describe Claude/Codex internals in v1.

## API Changes

Change `ClassifyRequest` for local-first classification:

```ts
export interface ClassifyRequest {
  repo_path: string
  work_units: WorkUnit[]
}
```

Resolution rules in the server:

1. `repo_path` is required.
2. `repo_path` must resolve to a local directory.
3. `repo_path/.git` must exist or `git -C <repo_path> rev-parse --show-toplevel` must succeed.
4. If repo validation fails, return an error and stop classification.
5. Do not clone, pull, infer from any URL field, or continue in a temp cwd.

Update the CLI request builder to pass local context:

```ts
buildClassifyPayload({
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
skills.ts
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
- A single unit failure should stop local-agent classification and make the API return an error.
- Preserve response order by mapping results back to `unit.id`.

This is the Paperclip-inspired part: use child-process adapters, structured output parsing, timeout handling, and clear execution metadata. Do not adopt heartbeat sessions.

## Classifier Skill

Create the classifier as a first-class skill, for example:

```text
apps/server/skills/auctor-classifier/SKILL.md
```

The skill owns:

- The Auctor classification rubric.
- The exact output schema.
- Examples for feature, bugfix, refactor, chore, test, and docs classifications.
- Instructions to use repo context only for classification.
- A strict read-only rule: never edit files, run formatters, install dependencies, commit, change branches, reset, clean, or otherwise mutate the repo.
- A strict output rule: return only a JSON object matching `ClassificationSchema`.

The per-unit prompt should be short and should explicitly tell the agent to use the skill:

```text
Use the auctor-classifier skill to classify this Auctor work unit.
You are running in the local repo at the current working directory.
Return only the classification JSON requested by the skill.
```

Then include the work unit metadata, commit SHAs, commit messages, and diff.

Skill injection:

- Claude Code receives a generated `--add-dir <bundleDir>` directory containing `.claude/skills/auctor-classifier/SKILL.md` and any configured extra skills.
- Codex receives skills in a managed `CODEX_HOME/skills` directory for the executor process.
- Skill bundle contents are hashed; that hash is logged and included in cache keys.
- Extra skills are optional and must be local directories with a `SKILL.md`.

## Executor Commands

Claude Code command:

```bash
claude --print - --output-format stream-json --verbose \
  --max-turns 2 \
  --dangerously-skip-permissions \
  --add-dir <skill-bundle-dir> \
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

For Codex, set `CODEX_HOME` to the managed per-run or per-config home that contains the injected skills. Seed auth/config from the user's default Codex home where needed, following Paperclip's managed-home pattern.

The implementation should keep the command builders small and tested, borrowing the command shapes and JSON parsers from Paperclip rather than importing Paperclip packages.

## Workspace Model

Executors run directly in `repo_path`.

Rules:

- Do not create scratch worktrees in v1.
- Do not clone or pull repositories.
- Do not auto-clean or auto-revert anything.
- The classifier skill carries the read-only instruction contract.
- Optionally inspect `git status --porcelain` before and after each executor run. If the repository becomes dirty during local classification, fail loudly and leave the files untouched for the user to inspect.

## Prompt Design

Keep the current classification schema and reuse most of `buildClassificationPrompt(unit)`, but move the durable rubric and safety instructions into the `auctor-classifier` skill. The prompt should focus on task data and skill invocation:

```text
Use the auctor-classifier skill to classify this Auctor work unit.
The current working directory is the local repo being analyzed.
Return only valid classification JSON.
```

Include:

- Work unit metadata.
- Commit SHAs.
- Commit messages.
- Existing diff payload.
- Skill invocation instructions.
- Exact JSON schema.

Keep the prompt versioned with a constant such as `LOCAL_CLASSIFIER_PROMPT_VERSION = 1` so cache invalidation is explicit when prompt semantics change. Also hash the classifier skill bundle so rubric changes invalidate cached classifications.

## JSON Parsing And Validation

Agents may wrap JSON in markdown or include commentary despite instructions. Implement a tolerant parser:

1. Try `JSON.parse(finalText)`.
2. Try fenced code block extraction.
3. Try first balanced JSON object extraction.
4. Validate with `ClassificationSchema`.
5. If parsing or validation fails, run one repair prompt against the same executor:

```text
Your previous response was not valid classification JSON.
Return only a JSON object matching this schema:
{
  "type": "feature" | "bugfix" | "refactor" | "chore" | "test" | "docs",
  "difficulty": "trivial" | "easy" | "medium" | "hard" | "complex",
  "impact_score": 0-10,
  "reasoning": "string"
}
Previous response:
<previous response text>
```

If repair fails in local-agent mode, throw and stop the classify request. Do not return a fallback classification from local-agent mode.

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
  skillBundleHash,
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
3. Pass `repo.path` as `repo_path`.
4. Fill `classificationMap` from the response.
5. For missing/failed units in classifier mode, throw and exit nonzero.
6. If `bundle.server_url` is absent, preserve existing default-classification behavior.

This makes local classification opt-in through the existing config field.

## Error Handling

Route-level errors:

- Invalid payload: 400, as today.
- No local executors configured: 500 with a clear message.
- Invalid or missing `repo_path`: 400 with a clear message.
- Missing classifier skill: 500 with a clear message.

Per-unit errors:

- Spawn `ENOENT`: throw with "command not found" context.
- Auth/login required: throw with "auth required" context.
- Timeout: kill the process group and throw with timeout context.
- Invalid JSON after repair: throw with parse context.
- Schema validation failure: throw with validation context.

Each per-unit failure should log executor type, unit id, exit code, timeout flag, and the first non-empty stderr line. The API should return an error and the CLI should exit nonzero.

## Tests

Add focused tests without requiring real Claude or Codex:

1. Config parsing clamps `LOCAL_CLASSIFIER_MAX_PARALLEL` to 1-10.
2. Executor selection round-robins across `claude,codex`.
3. The bounded pool never runs more than the configured max concurrently.
4. Claude stream-json parser extracts final result text and session id.
5. Codex JSONL parser extracts final agent message and thread id.
6. JSON extraction handles raw JSON, fenced JSON, and commentary with an embedded object.
7. Cache key changes when diff hash, prompt version, backend, executor, or model changes.
8. Skill bundle hashing changes when `SKILL.md` changes.
9. Claude command receives `--add-dir` for the generated skill bundle.
10. Codex command receives a managed `CODEX_HOME` containing skills.
11. `/api/classify` rejects missing or invalid `repo_path`.
12. `/api/classify` uses cached results before launching local executors.
13. CLI `analyze` calls the classifier when `bundle.server_url` is present and uses returned classifications for scoring.
14. CLI `analyze` exits nonzero when local-agent classification fails.

Use fake executable scripts in temp directories for integration tests:

- Fake Claude emits stream-json lines.
- Fake Codex emits JSONL events.
- Timeout fake sleeps beyond the configured timeout.
- Invalid fake emits malformed JSON to exercise repair/error behavior.

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
- The active repo working tree remains unchanged because classifier skill instructions are read-only.

## Implementation Order

1. Add config parsing and backend interface.
2. Move current Bedrock call behind `BedrockClassifierBackend`.
3. Add the `auctor-classifier` skill and skill-bundle injection.
4. Add local executor command builders and parsers.
5. Add JSON extraction, schema validation, and repair retry.
6. Add bounded orchestrator with strict local-agent failure behavior.
7. Update cache keys and migration-safe table creation.
8. Update `/api/classify` to require `repo_path`, select backend, and classify missing units in batches.
9. Update shared API and CLI payload builder with `repo_path`.
10. Wire `analyze` to call the classifier when `server_url` is configured.
11. Add fake-executor tests and run verification.

## Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Internal consistency: the design keeps the existing server API boundary, adds skill-driven local executors behind it, requires local `repo_path`, and wires the CLI path that currently ignores classifiers.
- Scope check: this is one implementation plan. It avoids Paperclip heartbeat/session features and focuses on request/response classification.
- Ambiguity check: parallelism, executor command shapes, cache invalidation, strict error behavior, skill injection, and repo context resolution are explicit.
