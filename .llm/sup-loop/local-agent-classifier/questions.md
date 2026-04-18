# Local Agent Classifier Questions

## Batch 1

1. Should the local classifier classify the existing Auctor `WorkUnit` shape or introduce a new per-commit classification primitive?

**Answer:** [grounded] Keep the existing `WorkUnit` shape. `apps/server/src/classifier/agent.ts`, `apps/server/src/classifier/prompt.ts`, `packages/shared/src/classification.ts`, and the CLI scoring path all classify a `WorkUnit`, where a unit is either a PR or a branch-day group with one or more commit SHAs. The user said "commits", but the current scoring contract depends on unit-level `type`, `difficulty`, and `impact_score`, so changing the classification grain would ripple through scoring and aggregation.

2. Does Auctor already have a server boundary that can host the local classifier without adding a new daemon?

**Answer:** [grounded] Yes. `apps/server/src/routes/classify.ts` exposes `POST /api/classify`, owns `RepoManager`, owns a SQLite `ClassificationCache`, and already calls `classifyWorkUnit(unit, repoDir)`. It currently uses Bedrock in `apps/server/src/classifier/agent.ts`, but the route is the right place to swap classifier backends.

3. Does the CLI currently consume classifications from the server?

**Answer:** [grounded] Not in the current analyze path. `apps/cli/src/api-client.ts` has `classifyWorkUnits`, and `BundleConfig` already has `server_url`, but `apps/cli/src/commands/analyze.ts` currently seeds every hydrated unit with the default classification. The design must wire `analyze` to the classifier service, otherwise the local executor work will not affect scores.

## Batch 2

4. Should the local classifier live in the CLI process instead of the server process?

**Answer:** [default] No for v1. Keeping it in the server reuses the existing route, cache, repo manager, and future remote deployment boundary. The CLI should call a local server when `server_url` points at `localhost`. A future follow-up can extract the classifier into a shared package if direct in-process CLI execution becomes important.

5. How should the executor commands be configured?

**Answer:** [default] Use server-side environment/config parsing for v1: backend, enabled executors, max parallelism, command paths, model/effort, timeout, and unsafe permission flags. This keeps bundle YAML small and lets the same CLI config point at either a remote classifier or a local Mac Studio classifier.

6. How much Paperclip architecture should be copied?

**Answer:** [grounded] Copy the adapter pattern, child-process invocation, JSONL parsing, timeout handling, and bounded queue ideas. Do not copy heartbeats, persistent sessions, skills bundles, issue wakeups, or workspace lifecycle. Auctor classification is request/response batch work, not an ongoing autonomous task runner.

## Batch 3

7. How should local repo context be provided to Claude Code and Codex?

**Answer:** [grounded] The server route already resolves a `repoDir`. For local analysis, the CLI should send the repo path as explicit local context, and the server should prefer that path over a clone URL when present. Each executor process should run with `cwd` set to a scratch worktree derived from that repo so agents can inspect files and git history without touching the user's active working tree.

8. Should local executors run concurrently per work unit or should one long agent session classify the whole batch?

**Answer:** [default] Run one child process per work unit through a bounded pool. This gives simple retry/error isolation, easy max parallelism, and clean JSON parsing. Long sessions might amortize startup cost, but they add context bleed between unrelated units and make partial failures harder to reason about.

9. What is the safe default for parallelism?

**Answer:** [assumption] Default to 4 and clamp configured values to 1-10. The user explicitly wants up to 10 parallel executors and will run this on a Mac Studio, but 4 is a safer first-run default for laptops, CI, and accounts with stricter local-agent quota behavior.

## Batch 4

10. How should cache keys change?

**Answer:** [grounded] The current cache key is just `work_unit_id`. That is too broad once Bedrock, Claude Code, and Codex can all classify the same unit with different prompts/models. The cache key should include the unit content hash, backend type, executor type, model/effort, and prompt version.

11. What should happen when an executor is missing, logged out, times out, or returns invalid JSON?

**Answer:** [default] Treat missing global executor configuration as a route-level configuration error. Treat per-unit execution failures as classification failures that produce the existing fallback classification with a precise reasoning string, while logging the executor, exit code, stderr summary, and timeout state. Invalid JSON should get one repair retry before fallback.

12. Should sessions be resumed across classifications?

**Answer:** [default] No. Paperclip resumes sessions because agents wake repeatedly on the same task. Auctor classification tasks are independent and should avoid cross-unit contamination. The local executor should run fresh sessions per unit for deterministic, isolated classifications.
