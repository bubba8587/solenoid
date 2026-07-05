# Docs index

Solenoid's `docs/` folder, grouped by purpose, with reading paths for common tasks.
`CLAUDE.md` (repo root) is always loaded and is the source of truth for standing rules;
this index is the map to everything else. (Archived/point-in-time docs live in
`archive/` — see `archive/README.md`.)

## Start here (new agent, in this order)

1. **`../CLAUDE.md`** — standing rules, architecture notes, the non-obvious traps.
2. **`glossary.md`** — the invented vocabulary (Conduit, Standoff, FrameRef, unit flow…).
   Read this before the deep-dive docs or their terms won't parse.
3. **`architecture.md`** — the file map: where things live.
4. **`decisions.md`** — the big WHYs and what would reverse them; read before proposing
   anything that touches a settled call, so you don't re-litigate it.

## Reference (read the relevant section before touching a subsystem)

- **`subsystem-invariants.md`** — the "don't break this" mechanics for the tricky
  subsystems (cable routing, group push, standoffs, tidy, error values, unit flow, alerts).
- **`node-coverage.md`** / **`archive/node-arity-audit.md`** — the node inventory and the
  labeled-slots-vs-list-socket arity decisions. `nodeCatalog.ts` is the real source of truth.
- **`compute-architecture.md`**, **`cable-routing.md`**, **`grid-system.md`**,
  **`cube-node-scope.md`** — per-subsystem depth.
- **`excel-pain-points.md`** / **`excel-toolbar-supplementals.md`** — the Excel-parity
  reference (function gaps + the non-function ribbon verdicts).
- **`performance-hardening.md`** — the perf floor and known remaining costs.

## Planning & status (forward-looking — verify against code; these rot)

- **`backlog.md`** — the fine-grained to-do list; **the single source of truth for tasks.**
- **`v1.0-plan.md`** / **`v1.1-plan.md`** — the release execution plans.
- **`pack-architecture.md`** — the lean-core + optional-packs design (not yet built).
- **`dev-notes.md`** — dated session log; the running narrative + gotchas.

## The 2026-07 review series (audit → vision; read in order)

Produced as one arc. Each builds on the last:

1. **`v1.0-audit.md`** — independent nine-domain audit of 1.0 (P0–P3 findings to fix).
2. **`future-directions.md`** — five *architecture* bets (fuse/compile, addressable model,
   schema inference, provenance, external-engine) — the enabling layer.
3. **`scope-features.md`** — *features* that expand scope (3 rounds + the Alteryx
   recreate-and-undercut demo), each tied to an architecture bet.
4. **`strategy-threads.md`** — distribution/positioning/composition (seeds-as-marketing,
   packs-as-business-model, the governance vertical, linked graphs, local-first identity).
5. **`out-of-scope.md`** — **DRAFT, unratified** — the standing NO list; do not cite to
   reject work until the author has reviewed it.

## Process

- **`agent-coordination.md`** — parallel-agent scratchpad (dormant in solo sessions).

---

## Task → docs cheat-sheet

- **Adding/changing a node:** `node-coverage.md` + `node-arity-audit.md` + `glossary.md`;
  `nodeCatalog.ts` is the source of truth (Add menu + Function Reference generate from it).
- **Touching frames/the engine:** `glossary.md` (frame terms) + `compute-architecture.md`
  + `decisions.md` D1/D5 + the `frameVerbs.ts` oracle and cargo parity tests.
- **A visual/UI change:** `../DESIGN.md` (the design-system rulebook) first, always.
- **Fixing an audit finding:** `v1.0-audit.md` (evidence + suggested fix + verification
  status) + `decisions.md` (to confirm the fix aligns with a decision, not against it).
- **Proposing a feature or scope change:** `scope-features.md` + `out-of-scope.md` (draft)
  + `decisions.md` (D2 especially — the cap precedent).
- **Wrapping up a session:** the reconcile ritual in `CLAUDE.md` — append to `dev-notes.md`,
  re-read and flip `backlog.md`, reconcile the "What's working / Still to build" sections,
  update the relevant reference doc **and this index** if the doc set changed.
