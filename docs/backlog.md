# Solenoid — Backlog (1.3)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **The 1.3 cut (author, 2026-08-30):** user-facing
polish and perf are DONE; what ships 1.3 is this list's easy under-the-hood work plus
the release tail. Everything feature-shaped or author-gated lives in `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale: `decisions.md`.

## Under-the-hood (agent-runnable now)

- [ ] **Model layer, the last two cuts (2026-08-27, after the Area rework — author-approved).**
  (1) Rename the seam's word: `area` → `view` (type `Area` → `View`, `area.ts` → `view.ts`,
  `getArea`/`getActiveArea`/`getOwningArea`, `areaRef`, ~230 variables) — rete's word, meaning
  nothing to a new reader; AND drop the `nodeViews` Map for explicit `view.position(id)` /
  `view.nodeElement(id)` — today `.element` is a `querySelector` on every read, incl. per-frame
  paths (lasso, standoffs, HIC sync). One tsc-guided sweep, ~half a day; the fakes in the 7
  layout tests follow. (2) Put position ON the node (beside `width`/`height`) and delete
  `FlowModel.positions` + `syncViews`'s reconciliation of the side-map against the editor's
  node set. Touches persistence/copyPaste/flowModel; the save-path suites are the net.
  Docs to follow: subsystem-invariants § React Flow surface contract, glossary "Area".

## Awaiting the author

- [ ] **Finance absolute-value verification (real Excel needed).** The bond/coupon
  family has NO oracle — Formula.js implements almost none of it. `financeInvariants.test.ts`
  now pins the round-trips/identities (PRICE↔YIELD, PRICEMAT↔YIELDMAT, ODD* pairs,
  COUP* day-count, DURATION/MDURATION, VDB total/additivity), which catch structural
  bugs but NOT a consistently-wrong absolute value. Want golden real-Excel values for:
  COUP*, ODDF/ODDL, ACCRINT/ACCRINTM, VDB. Already confirmed absolute: PRICE/YIELD
  + DURATION (Microsoft examples), TBILLYIELD/TBILLEQ + PRICEMAT (real Excel). Worth
  one real-Excel check: Microsoft's MDURATION example (1-Jan-2008 → 1-Jan-2016, 8%,
  9%, semiannual, basis 1) publishes 5.7355689 where we and a hand-worked textbook
  Macaulay both give 5.7356698 — and our DURATION matches Microsoft's own DURATION
  example to 8 digits, so the doc value looks like a typo.
- [ ] **Script on desktop**: `'unsafe-eval'` added to the Tauri CSP for the sandbox worker
  and the main-thread compile; untested on a desktop build. Author: place a Script,
  `(x) => x * 2` with x = 21 should read 42, not a CSP refusal.
- [ ] **OUTSIDE REVIEW WANTED: number→text semantics of the text predicates** —
  author defers to a reviewer. Today: text predicates on number/date columns compare
  the JS display string (oracle `String(cell)`; engine mirrors via hand-written
  `js_number_string` — the own-it-forever liability under review). Alternatives:
  (a) status quo; (b) `#TYPE!` + require Cast (most lattice-consistent, deletes the
  Rust formatter); (c) app-format strings (rejected-by-default). Verdict lands as a
  VAL rule + corpus cases.

## Dependency updates (walking them one at a time; TypeScript 7 landed 2026-08-11a)

Current state (2026-08-26): the walkable set is on latest in-range (`react` 19.2.8,
`vitest` 4.1.11, `vite` 8, etc. — git has the walk); the rete RENDER packages and
`styled-components` were removed outright by the React Flow cutover (rete core
2.0.6 + rete-engine + elkjs 0.12 + `@xyflow/react` remain). Remaining major:
`@anthropic-ai/sdk` 0.120 (skipped). The `.npmrc` `legacy-peer-deps` workaround is
REMOVED — the old elkjs-vs-rete-auto-arrange peer conflict left with the plugin
(clean `npm install` dry-run verified).

## Architecture spec (`docs/rules.md`) — small tail

- [ ] **Spec-promotion remainder** — read-as is coercion-not-assertion
  (`applyGetColumnReadAs` pins it); promote if config-driven coercions grow.
- [ ] **Enforcement tail (low value)** — socketBox12 partial (un-greppable visual half),
  oneResolvePredicate unenforced (recorded un-greppable).

## Release tail (author-run)

- [ ] **Deferral review (author-present)** — walk `deferrals.md` (now incl. the
  Pushed-to-1.4/2.0 section) and ratify/amend `out-of-scope.md` (still DRAFT).
- [ ] **Keep `release-notes-features.md` current** — the 1.3 selling list.
- [ ] **Cut 1.3**: desktop-gated checks (cargo on Windows, path-stripped
  `release:desktop`, exe smoke), bump 1.3.0, merge → `main`, tag `v1.3.0`.
