# Design — Move bundle configs and results from `configs/` to `out/`

**Date:** 2026-04-23
**Status:** Draft (autonomous design via `/sup-loop-design`)
**Slug:** `move-configs-to-out`
**Companion artifacts:** `questions.md`, `approaches.md` (same directory)

## Assumptions

- `[assumption]` `out/` is not currently used at the repo root (confirmed absent from top-level `ls`).
- `[default]` No backward compatibility with `configs/` — this is a hard rename.
- `[default]` `.results/` subfolder name is preserved.
- `[default]` User migrates existing bundles manually (`mv configs/* out/`).
- Out of scope: dashboard dropdown, `sync.sh`, Vite middleware, timestamped filenames. (A broader design covering those lives at `.llm/move_config_results_to_out/design.md`.)

## Summary

Relocate bundle YAML and generated reports from `configs/<bundle>/` to `out/<bundle>/`. No new modules, no new abstractions, no CLI code changes — the CLI already computes `.results/` from `dirname(configPath)`, so it automatically follows wherever users put their config. The change is confined to the dashboard sync glob, the gitignore, a `.gitkeep` move, and one test file.

## Current state (before)

```
configs/
├── .gitkeep
└── browseros/
    ├── browseros_config.yaml          ← committed
    └── .results/                       ← gitignored
        ├── browseros-main.json
        └── browseros-microscope-*.json
```

- `analyze.ts:56` writes to `join(dirname(absoluteConfigPath), '.results')`.
- `microscope.ts:69` writes to the same path.
- `sync-data.ts:23` scans `configs/*/.results/*.json`.
- `.gitignore` has `configs/**/.results/` and `configs/*`.

## Target state (after)

```
out/
├── .gitkeep                            ← committed
└── browseros/                          ← gitignored (`out/*` rule)
    ├── browseros_config.yaml           ← gitignored (sits inside ignored dir)
    └── .results/                        ← gitignored
        ├── browseros-main.json
        └── browseros-microscope-*.json
```

Identical layout, parent directory renamed. Gitignore semantics carry over from `configs/`: the YAML and `.results/` stay local-only; `.gitkeep` is the only committed file, preserving the empty-dir-in-git convention (commit `9c91e45 chore: ignore generated configs broadly`).

## Changes

### 1. `apps/dashboard/scripts/sync-data.ts`

Single-line change at line 23:

```diff
-  const glob = new Bun.Glob('configs/*/.results/*.json')
+  const glob = new Bun.Glob('out/*/.results/*.json')
```

No other edits to this file; bundle-name extraction (`basename(dirname(dirname(rel)))` at line 37) keeps working because the directory depth is unchanged.

### 2. `apps/dashboard/scripts/sync-data.test.ts`

Update two fixture paths (lines 25 and 72):

```diff
-    const resultsDir = join(rootDir, 'configs', bundle, '.results')
+    const resultsDir = join(rootDir, 'out', bundle, '.results')
```

```diff
-    const resultsDir = join(rootDir, 'configs', 'browseros', '.results')
+    const resultsDir = join(rootDir, 'out', 'browseros', '.results')
```

All seven existing test cases keep their semantics. No new tests.

### 3. `.gitignore`

Replace the two `configs/` patterns with `out/` equivalents, and add an explicit negation so `.gitkeep` can be tracked in the same commit:

```diff
-# Auctor bundle run results (generated)
-configs/**/.results/
-
-# Generated local Auctor bundle configs
-configs/*
+# Auctor bundle run results (generated)
+out/**/.results/
+
+# Generated local Auctor bundle configs
+out/*
+!out/.gitkeep
```

The negation is needed because the `out/.gitkeep` file is being added in the same commit as the `out/*` rule — without the negation git would ignore it. (The existing `configs/.gitkeep` is tracked only because it predates the `configs/*` rule; we don't have that history for `out/`.) Other rules (`dist/`, `/bin/`, etc.) stay untouched.

### 4. Move `.gitkeep`

- Delete `configs/.gitkeep`.
- Add `out/.gitkeep`.

This keeps the empty directory tracked so fresh clones have `out/` ready to receive bundles.

### 5. CLI commands — no changes

Verified by reading:

- `apps/cli/src/commands/configure.ts` — writes to whatever `configPath` the user passes.
- `apps/cli/src/commands/analyze.ts:56` — `resultsDir = join(dirname(absoluteConfigPath), '.results')`.
- `apps/cli/src/commands/microscope.ts:69` — same pattern.

Users invoke:

```bash
auctor configure out/browseros/browseros_config.yaml -30d ../browseros-main
auctor analyze   out/browseros/browseros_config.yaml -14d
auctor microscope out/browseros/browseros_config.yaml -14d
```

No source edits needed.

### 6. Docs / CLAUDE.md

No change required in this pass. The repo-level `CLAUDE.md` does not reference `configs/`. Older specs under `docs/superpowers/specs/` describing the `configs/` layout are historical and left alone.

## Migration

One-time user command (not automated):

```bash
mv configs/* out/ 2>/dev/null || true
rmdir configs 2>/dev/null || true
```

After this, the user runs `bun run dashboard:sync` to verify `apps/dashboard/public/data/` regenerates from the new location.

## Testing

- `bun test apps/dashboard/scripts/sync-data.test.ts` — all seven existing cases pass with updated fixtures.
- `bun run typecheck` — no new types introduced.
- Manual smoke: `auctor analyze out/<bundle>/<bundle>_config.yaml -7d` → confirm JSON lands at `out/<bundle>/.results/<repo>.json`; `bun run dashboard:sync` → confirm `apps/dashboard/public/data/<bundle>__<repo>.json` regenerates.

## Risk / Rollback

- **Risk:** a contributor with a stale checkout keeps writing to `configs/`. Mitigation: the new `.gitignore` leaves `configs/` untracked, so stale local state is harmless; the dashboard sync simply won't see it.
- **Rollback:** revert the single commit. No data migration to undo.

## What this design deliberately does NOT do

- Does not add a dashboard root-selector dropdown.
- Does not add `apps/dashboard/sync.sh` or Vite dev middleware.
- Does not add timestamped report filenames.
- Does not introduce `apps/cli/src/paths.ts` or any helper module.
- Does not support both layouts simultaneously.

If any of those are wanted later, the broader prior design at `.llm/move_config_results_to_out/` covers them and can be picked up as a separate effort.
