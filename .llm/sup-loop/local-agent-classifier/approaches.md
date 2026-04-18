# Local Agent Classifier Approaches

## Recommended: Local Server Backend With Child-Process Executors

Keep the classifier service boundary and add a `local-agent` backend inside `apps/server`. The server receives work units through the existing `/api/classify` route, requires a local `repo_path`, schedules units through a bounded pool, injects the `auctor-classifier` skill plus configured extra skills, and invokes either `claude -p` or `codex exec` as child processes. The CLI starts using `bundle.server_url` for classifications and passes local repo path context.

Pros:

- Reuses the existing Hono route, `RepoManager`, `ClassificationCache`, and shared API types.
- Keeps Bedrock and local-agent backends behind the same `classifyWorkUnit` style contract.
- Lets the user run the classifier locally by starting the server on the Mac Studio and setting `server_url: http://localhost:3001`.
- Keeps local executor and skill configuration server-side instead of expanding every bundle YAML.
- Lets the classifier rubric live as a reusable skill instead of only as inline prompt text.
- Allows the server to enforce a global max parallelism cap of 10.

Cons:

- Requires the local server process to be running during `auctor analyze`.
- The CLI still has a network hop, even when both processes are on the same machine.
- `server_url` is currently unused in analysis, so the implementation must wire that path before classifications affect scoring.
- Local-agent mode is intentionally local-only; invalid `repo_path` stops the run instead of falling back to clone/diff-only behavior.

## Alternative: CLI-In-Process Local Orchestrator

Move local orchestration into `apps/cli`, classify hydrated units directly during `auctor analyze`, and keep `apps/server` only for Bedrock or remote classifications.

Pros:

- Best user ergonomics: one `auctor analyze` command can do everything.
- Avoids local HTTP and server lifecycle.
- Natural access to exact repo paths and bundle config.

Cons:

- Duplicates or moves server classifier/cache code.
- Makes the CLI responsible for child-process orchestration, timeout handling, command probing, and executor logs.
- Makes future remote/local parity harder unless the classifier is extracted into a shared package first.

## Alternative: Paperclip-Style Runtime With Persistent Agent Sessions

Build a richer runtime modeled after Paperclip: adapter registry, session persistence, prompt bundle cache, workspaces, and a queue that can resume Claude or Codex sessions over time.

Pros:

- Maximum extensibility for future agent backends.
- Session continuity and prompt bundle hashing are proven in Paperclip.
- Could support long-running classification workflows and richer agent context later.

Cons:

- Too much scope for a classifier feature.
- Sessions create risk of context bleed between independent work units.
- Adds concepts Auctor does not currently need: heartbeats, issue wakeups, skill sync, workspace lifecycle, cost tracking, and session invalidation.

## Pick

Pick the local server backend with skill-driven child-process executors.

Reason: it is the smallest change that meets the requirement: local machine execution, Claude Code and Codex executor support, classifier-as-skill behavior, bounded parallelism up to 10, local repo context, strict failure semantics, and reuse of existing server classifier code. It also leaves a clean path to extract a shared classifier package later if the CLI should run local agents without a server.
