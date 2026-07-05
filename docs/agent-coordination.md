# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## This session (overnight EXTENDED — author said "keep going", 2026-07-05 ~08:40)

Same rules as the closed block below in git history: verify = tsc + vitest; NOBODY
pushes; commits via A3 when its loop is alive, else self-commit with rationale;
"author eyeball" dev-notes for anything visual. The ~03:30–08:30 digest lives in
dev-notes "OVERNIGHT SESSION SUMMARY"; this block continues it.

## Claims

- **Agent 2**: Queue #1 — cube-aware Nest Join (accept a CUBE right side so nesting chains). Verifying the exact gap first (parent-cube path via `relateCubeToFrame` is already done per scope doc — the right-side-cube variant is what's open). `frameVerbs.ts`/`frame.ts` nest join + node + tests, JS-only.
- **Agent 3**: (welcome back — your loop was dead ~90min) you're mid-edit on
  architecture.md; it's YOURS, I backed off. **Fold these still-missing module rows
  into your pass** (I diffed doc-vs-tree): `errorValue.ts` (installErrorGuards +
  origin tagging + registerErrorSink w/ null=clean), `nodeStoreRegistry.ts` (the
  forget seam every id-keyed store self-registers on), `flyToNode.ts`,
  `frameShape.ts`+`frameShapeResolver.ts` (static shape checking, relational
  section), `excelFunctions.ts` (the resolveExcelFunction seam + formulaDivergence
  tripwire, catalog section), `catalogSearch.ts` (quick-wire filtering), and in the
  App-chrome prose: the HUD family (`HudStack`, `alertStore`, `pinStore`,
  `problemsStore`, `commentStore`, `noticeStore`) + `semanticZoomStore`/
  `gridSnapStore`/`isolateStore`. Node-compute prose list: add `quality` (Expect),
  `sink` (Write CSV/JSON), `report`, `history` (Session History), `composite`,
  `presentation`, `visual`, `cube`, `lambda`, `placeholder`.
- **Agent 1 (Lead)**: perf bench (no regression), invariants docs (`6770bc5`), reader
  fuzz (`2d162e0`) all done. NEXT: audit target — undo/redo (rete-history) state
  machine vs tonight's new surfaces.

## Queue

**Agent 2 (substantive — take #1):**
1. **Cube-aware Nest Join (multi-level)** — the named v1.1 follow-up in
   `docs/cube-node-scope.md` (Customer→Order→LineItem: Nest Join today takes a flat
   right side; make it accept a cube right side so nesting chains). You have the cube
   context loaded from the XLOOKUP work. Engine (`frameVerbs.ts` nest join) + node +
   tests; JS-only (Nest is eager, no Rust half). Read the scope doc's DECIDED lines
   first (flat verbs do NOT map over nested cells).
2. **ELK Tidy integration guard**: your layout property tests scoped out the ELK+
   settleStandoffs integration path. elkjs runs under node — build a small integration
   test (real editor + arrange on a fixture with a standoff cluster + a group) asserting
   the no-overlap invariant post-Tidy. If elkjs-in-vitest proves too heavy/flaky, gate it
   like perfScaling (`describe.runIf(!!process.env.SLOW)`) and document the run command.

**Agent 3 (mechanical + git — commit duty first, if your loop is back):**
1. Commit duty per the standing rule (diff named files, project-style message, never push).
2. ~~architecture.md file-map reconcile~~ — DONE (`70e3c0d` + `3c541dd`, the latter folding in
   Agent 1's diffed-vs-tree gap list). Queue empty — idle & polling for commit duty.

## Ready to commit

_(empty — tree clean)_

## Recently done

(older entries trimmed — full history in `git log`)
- Agent 1 — popup "Go to node" action. Committed `4e75b68`.
- Agent 1 — add-menu close keys on doc ID, not autosave notify. Committed `c22a6a3`.
- Agent 1 — final docs sweep (session summary + board close). Committed `0432216`.
- Agent 1 — perf bench + invariants docs + reader fuzz. Committed `6770bc5`, `2d162e0`.
- Agent 3 — architecture.md file-map reconcile (own queued task, 2 passes). Committed `70e3c0d`, `3c541dd`.
