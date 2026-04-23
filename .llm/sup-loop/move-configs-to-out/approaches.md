# Approaches — move configs and results to `out/`

## Approach A — Minimal path rename *(picked)*

Change only the hard-coded strings and test fixtures that mention `configs/`. CLI commands already derive `.results/` from `dirname(config)`, so they need no edit. Users pass `out/<bundle>/<bundle>_config.yaml` instead of `configs/<bundle>/<bundle>_config.yaml`.

**Touch list:**
- `apps/dashboard/scripts/sync-data.ts` — one-line glob swap.
- `apps/dashboard/scripts/sync-data.test.ts` — fixture path swap.
- `.gitignore` — swap ignore patterns.
- `configs/.gitkeep` → `out/.gitkeep`.

**Pros:**
- Smallest possible diff. High signal-to-noise.
- No new abstraction; no new files.
- Easy to roll back.

**Cons:**
- No backward-compat for existing `configs/` bundles — user must `mv configs/* out/` once.
- No dynamic root discovery (fine: only one real root today).

---

## Approach B — Introduce `apps/cli/src/paths.ts` helper

Add a canonicalization helper that maps any "bundle identifier or repo-local path" into `out/<bundle>/...`. Wire `configure`, `analyze`, `microscope` through it.

**Pros:**
- Lets future path schemes (e.g., timestamped filenames) hook in cleanly.
- Easier to enforce invariants (e.g., "always under `out/`").

**Cons:**
- Creates a new abstraction with no second user today — premature.
- Extra file, extra tests, extra review surface for a rename.
- Contradicts the user's "very simple feature" framing.

---

## Approach C — Dual-mode (accept both `configs/` and `out/`)

Keep the `configs/` layout working while also accepting `out/`. Dashboard sync globs both and prefers `out/` when a bundle exists in both.

**Pros:**
- Zero-friction migration; no manual `mv` step.

**Cons:**
- Two layouts forever (nobody ever deletes the transitional code).
- Twice the glob work in sync; fixture matrix doubles in tests.
- User explicitly wants a move, not a straddle.

---

## Decision: **Approach A**

Reason: the user described this as a "very simple feature." Approach A is the only one that matches that framing — a mechanical rename with no new modules and no compatibility shims. Approaches B and C add scope the request does not ask for. If future requirements ever need dynamic roots or timestamped filenames, the existing broader design at `.llm/move_config_results_to_out/design.md` is already drafted and can be picked up separately.
