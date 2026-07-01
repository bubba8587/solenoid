# Outside review — June 2026

A second-set-of-eyes review of the whole project, done from a neutral outside
perspective. Scope: correctness, data safety, architecture, product surface,
testing, and tooling. It deliberately does **not** count unbuilt features
(Sparkline, Format Controller redesign, etc.) against the project — those are
tracked WIP. Everything below was verified against the code at the cited
locations; claims that couldn't be verified were left out.

**Overall:** the foundations are unusually solid for a v0.1 — strict
TypeScript with essentially zero escape hatches, a property-tested cable
router, 185 passing unit tests over the numerics, and clean web/desktop
separation. The real weaknesses cluster in three places: **data safety around
save/load**, **error visibility for the end user**, and a handful of
**verified Excel-parity bugs**. None of them are structural; all are fixable
without rework.

---

## 1. Verified computation bugs

### 1.1 DATEDIF "MD" returns wrong values — `src/graph/nodes/date.ts:594-598`

The MD branch builds `new Date(Date.UTC(ey, em, sday))` without clamping
`sday` to the end month's length. JS Date rolls overflow forward
(Feb 31 → Mar 2), and the subsequent "step back a month" correction then
lands on the wrong day.

Traced example: `DATEDIF(2024-01-31, 2024-02-28, "MD")` → the adjusted date
rolls to Mar 2, steps back to **Feb 2**, result **26**. Excel returns **28**.
Fix is to clamp the day before constructing the date. The MD/YD units have no
test coverage (`date.ts` has no test file at all — the only node domain
without one), which is exactly where this hid.

Severity: **medium** (wrong answers; MD is a rarely used unit, and Excel
itself documents MD as unreliable — but Solenoid's value differs from Excel's
in cases where Excel's is well-defined).

### 1.2 PERCENTILE.EXC clamps instead of erroring — `src/graph/nodes/stats.ts:77-80`

Excel's PERCENTILE.EXC returns `#NUM!` for `p` outside
`(1/(n+1), n/(n+1))`. The implementation guards only `p <= 0 || p >= 1` and
otherwise clamps the index into range, so e.g. `PERCENTILE.EXC([1,2,3,4], 0.1)`
silently returns the minimum element where Excel errors. Inside the valid
domain the formula matches Excel.

Severity: **low** (silent wrong-ish answer at the domain edges only).

---

## 2. Data safety (highest-priority area)

These compound each other, so they're worth treating as one workstream.

### 2.1 `loadGraph` destroys the current graph before the new one is known-good — `src/graph/persistence.ts:125-160`

The load path clears every existing node/connection first, then constructs
the saved nodes. If a constructor or `addNode` throws partway through, the
user's previous graph is already gone and what remains is a half-built one.
Combined with single-slot autosave (2.3), the next edit then persists the
damage. Building into a detached state (or snapshotting the old serialized
form first and restoring on failure) would close this.

Severity: **high** — it's the one scenario in the app where a user can
permanently lose work through no fault of their own.

### 2.2 Unknown node types are skipped with only a `console.warn` — `persistence.ts:150-152`

Graceful skipping is the right call, but the user gets no visible indication
that their file loaded incompletely. Worst case: a file written by a future
version loads as a near-empty graph, the user doesn't notice, and autosave
overwrites the slot. Related: there is no forward-version check — `g.v ?? 1`
detects v1, but a hypothetical v3 file is treated as v2 with unknown fields
silently dropped. A one-line `if (g.v > 2) refuse-and-explain` plus a small
"N nodes could not be loaded" toast would cover both.

Severity: **high** in combination with 2.1/2.3; cheap to fix.

### 2.3 Autosave is a single slot with silently-swallowed failures — `persistence.ts:243-253`

One localStorage key, and the `setItem` is wrapped in an empty `catch` (as
are the writes in `appTheme.ts:29`, `settingsStore.ts:65`, `packs.ts:250`).
If quota is exceeded or storage is disabled, the user keeps working with no
indication nothing is being saved. A rotating two-slot save plus a status-bar
indicator when a write fails would be proportionate — this is the product's
only safety net on web.

Severity: **medium-high**.

### 2.4 Import validation is minimal — `persistence.ts:291-310`

`importGraphFromFile` checks `Array.isArray(g.nodes)` and nothing else; node
entries and connection endpoints are not validated before the destructive
load in 2.1 begins. Doesn't need a schema library — a small structural check
pass before clearing the editor would do.

Severity: **medium** (multiplies 2.1).

### 2.5 No persistence round-trip test

`persistence.ts` (310 lines, id remapping, legacy migration, group/FC
reference rewriting) has zero tests, while far simpler numeric code is
well-tested. One test that builds a representative graph (groups, docked FC,
extensible inputs, conduit), serializes, reloads, and compares structure +
recomputed values would protect the single most dangerous code path in the
app. Severity: **medium**.

---

## 3. Desktop security posture

### 3.1 CSP is disabled — `src-tauri/tauri.conf.json:22`

`"csp": null`. The app renders user-influenced strings (labels, notes via
`marked`, imported file content), and the Tauri webview has fs read
capability, so XSS → arbitrary `$HOME` file read is a real chain. Tauri's
default CSP (or a minimal `default-src 'self'`-style policy) is the fix.

Severity: **medium-high** for a distributed binary.

### 3.2 Filesystem read scope is all of `$HOME` — `src-tauri/capabilities/default.json`

`fs:allow-read-text-file` and `fs:allow-read-dir` are scoped to `$HOME/**`,
i.e. the webview may read any file in the user's home directory without a
dialog. The actual feature (CSV folder) needs either a user-picked directory
(dialog-granted scopes) or a dedicated app folder.

Severity: **medium**.

---

## 4. Architecture observations

### 4.1 Every change recomputes and re-renders the whole graph — `src/graph/process.ts:247-268`

`processGraph()` does `engine.reset()`, then `fetch`es every node
sequentially, then `area.update("node", id)` for **every node** — on every
edit, keystroke-debounced or not. Within one pass the DataflowEngine cache
keeps shared subtrees from recomputing twice, so a pass is O(graph), but the
work per edit still scales with total graph size rather than with the dirty
subtree, and so does the React re-render fan-out. Fine at tens of nodes;
a wall for the "Excel alternative for data tables" ambition, where hundreds
of nodes and long lists are the success case.

Two concrete notes:

- The README's "How it works" section claims "changing a value re-evaluates
  only the parts of the graph that depend on it." That is not what the code
  does today. Either the docs should match reality or (better, eventually)
  reality should match the docs — `DataflowEngine` retains per-node cache
  until reset, so dirty-marking only the downstream cone of the edited node
  is an achievable incremental path.
- The `area.update` loop also re-renders nodes whose displayed value didn't
  change, which makes typing cost proportional to graph size even when the
  computation is cheap.

Severity: **medium now, high later**. Worth a deliberate decision about when
the incremental pass happens, since node `data()` signatures were designed
for exactly this.

### 4.2 Per-node UI state has no unified lifecycle

State about a node lives in two regimes: fields on the node instance
(captured by `extractInit` in `copyPaste.ts:66-87` → cloned, saved, loaded)
and module-level stores keyed by node id (handled ad hoc, mostly not at
all):

- **Collapse state is silently lost** on save/load (not in
  `serializeGraph`, `persistence.ts:85-121`) and on copy/paste (not in
  `extractInit`). A user who collapses nodes and reloads gets everything
  expanded. Group `collapsed` *is* preserved (it's an instance field), which
  makes the inconsistency more visible, not less.
- **No store cleanup on `noderemoved`** — the Canvas handler
  (`Canvas.tsx:1563-1580`) handles FC undocking and group membership only;
  `cableValueStore` and `collapseStore` entries for deleted nodes live until
  reload. Memory-only and bounded by session edits, so low severity in
  itself, but it's a symptom: nothing owns the question "what happens to
  store entries when a node is created/cloned/saved/deleted?" Each new store
  re-answers it ad hoc, and collapse answered it wrong.

A small convention — stores registering serialize/cleanup hooks, or moving
genuinely-persistent state onto node instances so `extractInit` captures it —
would fix the class of bug rather than the instance. Severity: **medium**.

### 4.3 A throwing `data()` silently halts recomputation — `process.ts:255-262`

Only `Cancelled` is swallowed; any real exception from a node's `data()`
propagates out of `processGraph` as an unhandled rejection. The app doesn't
crash, but the recompute pass dies partway: some nodes show fresh values,
some stale, and nothing tells the user. There's also no React error boundary
(`App.tsx`). The numeric nodes are defensively written (null guards
everywhere), so this is rare today — but with 150+ node types, one bad edge
case in any of them degrades the whole graph. A catch-per-node that marks
the node errored (see 5.1) would convert this from a global failure to a
local, visible one. Severity: **medium**.

### 4.4 `Canvas.tsx` is a 2,027-line god file

Rete init, ~27 event handlers, selection, lasso, cable highlighting, FC
docking geometry, group management, delete-with-splice, the tidy/auto-arrange
implementation (~300 lines), context menus, keyboard shortcuts, and mobile
touch all live in one file. Everything in it works, and node-editor "shell"
files do trend large — but at the current growth rate it's where merge pain
and regression risk will concentrate. The natural seams are already visible
(tidy/cleanup, FC docking, selection/lasso, keyboard map) and most are
already communicating through the `process.ts` registry anyway.
Severity: **low-medium**, maintainability only.

---

## 5. Product-level gaps (relative to the project's own stated goals)

### 5.1 Errors are invisible: everything is `null`

Nodes signal every failure — division by zero, bad domain, shape mismatch,
unconverged solver — by returning `null`, which renders the same as "not
wired yet." Excel's single most load-bearing UX feature is arguably that
`#DIV/0!` / `#NUM!` / `#VALUE!` are *visible and propagate*, so the user can
trace a failure to its source. For an Excel-alternative aimed at Excel
users, "the answer just went blank somewhere upstream" is the kind of thing
that erodes trust in numbers. A tagged error value flowing through the
dataflow (rendered as a red badge on the value box, propagated through
downstream nodes) would also resolve 4.3 cleanly. This is the largest
product-level gap that isn't already on the roadmap.
Severity: **medium-high** for the target audience.

### 5.2 Locale handling is en-US-hardcoded

Display formatting is `toFixed` with dot decimals
(`components/format.ts`), and text-based numeric entry goes through bare
`parseFloat` — in a decimal-comma locale, pasting `1,5` into Table Input
or any text-parsed field yields `1` with no error. (The inline
`<input type="number">` fields are partially insulated because the browser
normalizes locale input.) Table Input's CSV parsing splits on bare commas,
which collides with comma-decimal data. Severity: **medium** if
international consumers are in scope; worth an explicit decision either way.

### 5.3 Self-documentation is half-delivered on the canvas

The catalog has good one-line `description`s for every node and the Add
menu surfaces them — but a placed node's header hover shows the class name
(the "node type hint"), not the description. CLAUDE.md's own UX principle
says descriptions should be "accessible on hover of the node header."
The data exists; it just isn't threaded to `NodeCard`.
Severity: **low-medium**, cheap win.

### 5.4 Accessibility is at "node editors usually punt" level

No ARIA on socket dots (`SocketComponent.tsx`), AngleDial, or SegToggle; no
focus traps in FunctionReference / AddNodeMenu / TablePopup; cables can only
be created by pointer. This is normal for the genre and reasonable to defer
— flagged because a consumer "Excel alternative" will eventually be held to
spreadsheet-app expectations, and retrofitting is costlier than accreting.
The shape+color socket encoding is already a genuine a11y strength.
Severity: **low now**, schedule-it-deliberately.

---

## 6. Testing & tooling

- **CI builds but doesn't test.** The only workflow
  (`.github/workflows/windows-portable.yml`) builds the Tauri portable exe.
  `npm test` (185 tests, all passing) and `tsc` (clean, strict) run only on
  dev machines. A test+typecheck job on push is ~10 lines and makes every
  other guarantee in this review durable. **This is the single best
  effort-to-value fix in the document.**
- **Coverage is inverted relative to risk in places.** Numerics and the
  cable router (property tests, exemplary) are well covered; persistence
  (2.5), group logic (`groupCollapse/Membership/Logic.ts`), copy/paste, and
  all interaction paths have zero tests. The recent-code-is-manually-QA'd
  rationale holds today, but those areas have stabilized enough to lock in.
- **No ESLint/Prettier.** Informal discipline is visibly working (zero
  stray `any` in `src/`, no dead code, consistent style), so this is low
  priority — it matters the day there's a second regular contributor.
- **Bundle is ~3 MB (917 KB gz) with no code splitting.** Irrelevant for
  Tauri; for the web demo, dynamic-importing `elkjs`/`katex` would be the
  first cut if load time starts to matter.
- **`styled-components` appears unused** (no imports in `src/`). It may be
  exercised by rete-react-plugin presets — verify before removing, but it's
  probably a leftover.

## 7. Repo & docs hygiene

- **`docs/architecture.md` describes a React Flow app.** The project is
  built on Rete v2; the doc (file tree, "React Flow edge type", `nodeTypes`
  registry, etc.) predates the port and is now misleading to any new reader
  — more damaging than no doc, since it reads authoritatively. Either rewrite
  or delete; CLAUDE.md currently does the real architectural duty.
- README "How it works" overstates recompute granularity (see 4.1).
- Stray files in the repo root: `import tests/New Text Document.csv`,
  `solenoid logo.af` (design source), `solenoid-graph-2026-06-04.json`
  (a working graph). Move to `docs/`/assets or delete.

---

## What's genuinely strong

Called out so the priorities above land with proportion:

1. **Type discipline.** `strict: true`, `noUnusedLocals/Parameters`, and
   effectively zero `any`/`@ts-ignore` across 41k lines. Rare at this stage.
2. **The cable router is the best-engineered piece of the codebase** —
   closed-form walk solver with invariants and drag-continuity
   machine-checked by property tests, and the design rationale written down
   in CLAUDE.md at a level that survives author turnover.
3. **Numerics are correct where it counts.** MOD sign, ROUND
   half-away-from-zero, RANK ties, TVM/IRR/RATE against known Excel values,
   real special-function implementations under the distributions — verified
   against Excel semantics, with tests. The two bugs found (§1) are the
   exceptions, not the pattern.
4. **The hard Rete/React integration problems are solved and documented** —
   measured socket rows instead of magic offsets, two-root state via a
   shared `storeKit` notifier abstraction (not 20 copy-pasted stores),
   deliberate StrictMode handling.
5. **Web/desktop divergence is clean** (`env.ts` + `fileBridge.ts` guards),
   and mobile got a real second pass rather than token CSS.
6. **CLAUDE.md / dev-notes are genuinely good engineering docs** — they
   record *why*, including failed approaches, which is exactly what an
   outside reviewer (or future maintainer) needs.

## Suggested priority order

1. **CI test job** (§6) — trivial, locks in everything else.
2. **Load-path safety**: build-before-clear, version ceiling, "N nodes
   skipped" surfacing, autosave failure indicator + second slot (§2).
3. **Fix DATEDIF MD + add a date test file; PERCENTILE.EXC domain guard** (§1).
4. **CSP + fs scope** before the next desktop release (§3).
5. **Decide the error-value story** (§5.1) — it interlocks with 4.3 and gets
   more expensive every month as node count grows.
6. **Persistence round-trip test; collapse-state lifecycle** (§2.5, §4.2).
7. Delete/rewrite `docs/architecture.md`; fix the README recompute claim;
   sweep the stray root files (§7).
