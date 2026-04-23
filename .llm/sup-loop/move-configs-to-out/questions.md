# Self-answered questions — move configs and results to `out/`

Autonomous brainstorming: every clarifying question is written here, then self-answered with a confidence tag (`[grounded]`, `[default]`, `[assumption]`).

## Batch 1 — Scope

1. **What exactly moves?** Does "move configs and results" mean relocating both the committed bundle YAML (`configs/<bundle>/<bundle>_config.yaml`) and the generated `.results/` directory (`configs/<bundle>/.results/`) from `configs/` to `out/`?
   - **Answer:** Yes. Both the bundle YAML and the generated reports move. After this change, a bundle looks like `out/<bundle>/<bundle>_config.yaml` and `out/<bundle>/.results/*.json`. The existing `configs/` top-level directory is no longer used. `[grounded]` — current layout read from `apps/cli/src/commands/configure.ts`, `analyze.ts`, `microscope.ts`, and `docs/superpowers/specs/2026-04-17-auctor-json-results-dashboard-amendment.md`.

2. **Do existing `configs/browseros*/` directories auto-migrate?**
   - **Answer:** No. The user can `mv configs/* out/` manually; the feature is a convention + path change, not a migration tool. Existing `configs/` directories are already gitignored, so nothing is lost if left in place. `[default]` — simplest path; keeps the feature small.

3. **Backward compatibility with `configs/` paths?**
   - **Answer:** No. Hard rename. The user asked for a simple feature and explicitly said "move." Supporting both layouts doubles the surface area for no stated benefit. `[default]`

## Batch 2 — Details

4. **Does the `.results/` subfolder name stay the same?**
   - **Answer:** Yes — stays `.results/` (leading dot). The dot signals "generated, ignored." Renaming it to `results/` is a separate concern and is out of scope for this simple feature. `[default]`

5. **Are CLI commands affected?**
   - **Answer:** No code change is required in the CLI. `analyze.ts` and `microscope.ts` already compute `resultsDir = join(dirname(absoluteConfigPath), '.results')`, so results follow whatever directory the user's config YAML lives in. `configure.ts` similarly writes wherever the user points it. The move is purely a user-facing convention: pass `out/<bundle>/<bundle>_config.yaml` instead of `configs/<bundle>/<bundle>_config.yaml`. `[grounded]` — verified at `apps/cli/src/commands/analyze.ts:56` and `microscope.ts:69`.

6. **What callers/files need updating?**
   - **Answer:**
     - `apps/dashboard/scripts/sync-data.ts` — glob `configs/*/.results/*.json` → `out/*/.results/*.json` (line 23).
     - `apps/dashboard/scripts/sync-data.test.ts` — test fixtures write to `configs/<bundle>/.results/` → `out/<bundle>/.results/` (lines 25, 72).
     - `.gitignore` — swap `configs/**/.results/` and `configs/*` patterns for `out/**/.results/` and `out/*`.
     - `configs/.gitkeep` — delete; add `out/.gitkeep` so the directory ships in git.
     - No CLI source changes needed (see Q5).
   `[grounded]` — files and line numbers verified via Grep.

## Not asked (out of scope)

- Dashboard dropdown / `sync.sh` / Vite dev middleware — the earlier broader design at `.llm/move_config_results_to_out/design.md` scoped this in; the current request does not. Leaving out.
- Timestamped report filenames — same reason; not requested this round.
- Path helper module (`apps/cli/src/paths.ts`) — would be an abstraction with no current second caller. Skipping.
