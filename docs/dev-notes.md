# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.

### Image bundling — plain images/ folder beside the doc (2026-07-05, author decision)
Author picked option (b) from the overnight memo, amended: NOT a per-doc `.assets/<hash>`
sidecar — a normal shared `images/` folder beside the saved doc, with the attachment's
ORIGINAL filename. `imageAssets.ts`:
- **Save (`bundleLocalImages`, called by `saveToDisk` BEFORE serializeGraph):** each Image
  node with a session `dataUrl` (and no URL) writes to `<docdir>/images/<name>.<ext>`;
  collision rule = same bytes → reuse the file, different bytes → "name (2).ext" …
  content-hash suffix as last resort. Stamps the node's persisted, doc-relative
  `assetPath`. saveToDisk was restructured to resolve the destination path FIRST
  (`pickSaveGraphPath` — dialog without write) so a fresh Save As bundles into the right
  folder and the JSON written after carries the assetPaths; binding happens after a
  successful write.
- **Load:** the Image COMPONENT self-hydrates on mount (`hydrateImageAsset(data)`) —
  resolves `assetPath` against `documentStore.currentFilePath()`, reads bytes → `dataUrl`.
  Mount-based, so doc load, paste, and placeholder restore are all covered with no
  documentStore hook; missing file = placeholder, silent (the folder is the user's).
- **Model:** ImageNode gained `fileName` (names the bundled copy) + `assetPath` (persisted;
  both in INIT_FIELD_ORDER — `fileName` was already listed for other nodes). Typing a URL
  or re-attaching clears the binding. The "Local file — not saved" hint shows only while
  `dataUrl && !assetPath`.
- **Tauri:** new fs capability grants scoped to `$HOME/**/images{,/*}` (read/write-file,
  mkdir, exists) — the images folder is NOT dialog-picked, so static grants are required.
  fileBridge gained binary read/write + mkdir/exists/dirname wrappers.
- **Gotcha:** the Write tool materialized `\x00-\x1f` in a regex literal as RAW control
  bytes (invisible in reads, breaks exact-match edits) — fixed via a byte-level script.
- Web build: no filesystem — attach stays session-only, both hooks no-op. Tests:
  `imageAssets.test.ts` (chunked base64 round-trip past the 32k seam, sanitizeName).
  Author eyeball (desktop build): attach → Ctrl+S → images/ appears with the file, hint
  clears; reopen doc → picture back; Save As elsewhere re-bundles.

### Popup "Go to node" retargeted to "Go to source" (2026-07-05, author review)
Author's eyeball catch: since a popup only ever opens from its host node's chip, flying to
the HOST is a no-op on a Display — you're already looking at it. The crosshair now flies to
the value's ORIGIN: new `resolveValueOrigin(editor, nodeId)` in `unitFlow.ts` (it owns the
passthrough duck-typing) walks upstream through FCs (`in`), pure passthroughs (first wired
input), and data-aware selectors (the actually-chosen branch; single wired branch when
untracked), stopping at any transform (Convert included — a converted number is a new value),
at an indeterminate selector, and at an ambiguous multi-branch selector. A producer node
resolves to itself, so the button is unchanged on non-passthrough hosts. Tooltip/aria now say
"source". Tests: 7-case describe block in `unitFlowAnnotation.test.ts` (vitest 2131).

### Note frontmatter socket-removal undo-coherence — fixed (2026-07-05)
Queue #3, the OUTPUT-side sibling of the extensible-row undo hole (b0066df). **Verified the
bug first (per Lead):** a Note's output sockets are DERIVED from `data.body` (`syncFields` in
`nodes/annotation.ts` parses the YAML each blur). A body edit that deletes a wired frontmatter
key does two things: `syncFields` drops the output socket (a body-derived change history does
NOT track — body edits set `data.body` live with no history entry), and `commitFields`'s
`removeConnection` drops the cable (which rete-history DOES track). So a plain Ctrl+Z re-added
the cable onto a socket that no longer existed → a zombie cable to a missing output that did
NOT self-heal (nothing re-runs `syncFields` on undo). Reproducible.
- **Fix (`NoteNode.tsx`):** new exported `pushNoteFieldRemovalUndo(node, prevBody, newBody,
  refresh)` — records the body edit as its OWN undo entry (undo sets `body = prevBody` +
  `syncFields()` → socket re-derived; redo re-applies). `commitFields` pushes it AFTER the
  `removeConnection` calls (and only when a REMOVAL stranded a cable, body-path only), so on
  undo the socket is restored FIRST and the cable re-add lands on a live socket — the exact
  ordering `ExtensibleInputs.pushRowRemovalUndo` uses, adapted to the note's body-derived
  sockets. Same 2-pop shape as the row fix (socket entry, then cable entry).
- **Gotchas / scope:** (1) a per-key TYPE OVERRIDE pruned during removal isn't restored on
  undo — the re-derived socket takes the guessed type (rare override+remove+undo edge; noted
  in the helper). (2) A type-override drop (`force=true`, mutates `fieldTypes` not `body`) is a
  SEPARATE case, deliberately not covered here. (3) The helper restores `data.body` too, so a
  socket-affecting note edit is now undoable — that's the coherent behavior (it changed graph
  topology); plain note typing still records no history.
- **Author eyeball:** the unit test (`noteFieldUndo.test.ts`) proves the helper's node-level
  effect (undo → body+socket back, redo → gone), but the full editor+history *ordering* (does
  one Ctrl+Z vs two fully restore, does the cable visibly reconnect) wants a live check — wire a
  frontmatter key's output to a node, delete the key, Ctrl+Z, confirm no zombie cable. tsc clean,
  full vitest 2124 green.

### Final full-diff review of the overnight range + 2 fixes (2026-07-05, extended session)
A closing adversarial review swept everything since `f926fa6` (the last author-reviewed
state, ~30 commits). Verdict: the row-undo helpers check out against rete-history's
actual internals (node undo reuses the SAME instance, so the captured closures never go
stale), the cube-child Nest Join, reconcile accounting, and lazy-ref materialization
through `any` sockets are all sound. Two findings, both fixed same-pass:
- **F9 was unreachable while presenting or drilled into a composite** — the keydown
  gates (composite `2026-07-04`, presenter added in audit round 2) early-returned
  BEFORE the F9 branch, and both overlays hide/cover the StatusBar "Calculate" chip +
  MenuBar item. In manual/sketch calc mode that left NO recompute path at all inside
  either overlay (a dirty graph stayed dirty until exit). Both gates now exempt F9;
  only the compute-overlay gate still outranks it (never queue a recompute mid-pass).
- **CableSwitch undo didn't restore a clamped `activeIndex`** — removing the selected
  last input clamps the index outside the undo system; Ctrl+Z brought the input back
  but left the switch on the wrong lane. The clamp is now its own history entry,
  pushed after the row entry so undo restores index last (`data()` clamps the
  transient out-of-range render).

### ELK Tidy integration guard — elkjs under node + the post-layout passes (2026-07-05)
Queue #2. The layout property tests (`layoutInvariants.test.ts`) cover the PURE cores in
isolation; this covers the INTEGRATION they scoped out — `layoutTidyIntegration.test.ts`.
- **What it can't do headless:** the real `arrangeFn` (Canvas.tsx) is DOM-coupled — node sizes
  come off `area.nodeViews` (`offsetWidth`), it stamps inline heights and moves nodes via async
  `area.translate`. None runs in vitest's node env. So the test drives **elkjs directly** with the
  app's real ELK options (`layered` / `direction RIGHT` / `nodeNodeBetweenLayers 55` / `nodeNode
  38`) — a faithful data-level reproduction of the layout engine, minus the DOM plumbing.
- **elkjs runs fine under vitest** (`import ELK from "elkjs"`, `new ELK().layout(...)`, ~80ms for
  a handful of nodes) — NOT heavy/flaky, so it stays in the default suite (no `describe.runIf`
  gate needed; run command noted in the file header if that ever changes).
- **Two cases:** (1) a diamond+tail layered graph lays out with no node overlap (elkjs-under-node
  smoke + the app's spacing → overlap-free base of Tidy). (2) The standoff-cluster path: Tidy lays
  a standoff pair out as ONE super-node sized to the cluster bbox (so ELK keeps it clear of other
  nodes, incl. a group container node); the test then EXPANDS the super-node into its two members
  with a deliberate skew, runs the app's final `solveStandoffs` (forceLock) → asserts the locked
  band holds (perpendicular ≈ 0, gap in [min,max]), then runs `separateOverlaps` (the overlap
  backstop) over the settled members + neighbours → asserts fully overlap-free. That chains ELK
  output → standoff settle → separate, the exact hand-off the pure tests couldn't reach.
- **Gotcha:** `elkjs` default-imports cleanly for both tsc and vitest at 0.8.2; the ELK graph is
  built by hand (not via the rete `AutoArrangePlugin`, which needs the area/DOM). If the app's ELK
  options change (Canvas arrangeFn), mirror them in `APP_OPTS` here or the guard drifts from reality.

### Nest Join accepts a CUBE child — nest a pre-built cube whole (2026-07-05)
Queue #1 this block. **Important scope clarification found while verifying:** the task framed
this as "so nesting chains (Customer→Order→LineItem)", but that chaining was ALREADY done via
the PARENT-cube path (`relateCubeToFrame`, 2026-06-29 — each call adds a FLAT child one level
deeper). The genuine gap was the CHILD side: it was `frameIn` (flat only). So this adds a
DISTINCT, complementary capability — nesting an already-assembled cube:
- **Engine (`frame.ts`):** `relateFramesToCube`'s `child` widened to `FrameValue | CubeValue`.
  A cube child reads its key column as its top-level column of that name (`cubeRowCount` rows),
  groups rows by key, and nests a sub-CUBE per parent cell via a new `subCube` helper (the
  cube analogue of `subFrame`), preserving the child's own nesting. `relateCubeToFrame`'s child
  param widened too (it passes through to `relateFramesToCube` at the leaves). Key equality for
  a cube child uses `cellKeyId` (same value-equality as `keyId`; a non-scalar key cell — a
  nested frame/cube — can't join, so it's dropped).
- **Node (`nodes/cube.ts`):** Child socket `frameIn` → `anyIn` (+ `asNestChild` coercion that
  keeps the old list/matrix/scalar→frame widening while accepting a cube). **Gotcha — same as
  the XLOOKUP cube-source fix:** a `cube` socket would WRONGLY auto-widen a frame child TO a
  cube (`coerceValue`'s cube case → `toCube`), turning depth-1 sub-frames into sub-cubes and
  silently changing existing frame-child output. `any` passes a frame through as a frame, a
  cube as a cube. Lazy `FrameRef` children still materialize (not socket-typed; Nest is eager).
- **Two ways, on purpose:** parent-cube = incremental (add a flat level at a time); cube-child =
  compositional (nest a pre-built hierarchy). Both reach Customer→Order→LineItem; neither maps
  INTO nested cells (consistent with the scope doc's DECIDED rule — a cube child joins on its
  TOP level, its own nested cells riding along opaquely).
- Verified: tsc clean, full vitest 2121 green; `cubeNodes.test.ts` +11 (frame-parent+cube-child
  nests a sub-cube / no-match → empty sub-cube / flat child still a sub-frame at depth 1 / node
  path / cube-parent+cube-child deepens a leaf). JS-only (Nest is eager, no Rust half).

### Extensible-row add/remove is now undoable (2026-07-05, extended session)
Audit find in the undo system, pre-existing since the variadic-rows work
(2026-06-23): removing a WIRED row (CHOOSE/IFS/SWITCH/List/Concat/BooleanOp/
CableSwitch/Fill) recorded only the CABLE removal in history — Ctrl+Z re-added a
connection into an input key that no longer existed (ghost cable until reload,
then a silent drop; for CHOOSE, row loss also shifts positional meaning).
- Fix is GENERIC, zero per-class code: `pushRowRemovalUndo`/`pushRowAddUndo`
  (ExtensibleInputs.tsx) capture the removed `ClassicPreset.Input` OBJECTS and
  re-add the same instances on undo (socket type + label survive by identity),
  then re-slot the node's original input-key ORDER (positional nodes change
  meaning if rows reorder). Wired into ExtensibleInputs, PairedExtensibleInputs
  (a pair = ONE entry), and CableSwitch's own add/remove.
- **Entry ordering is load-bearing**: the row entry is pushed AFTER the
  connection removals and BEFORE the removal itself, so undo pops row-restore
  first and the cable re-add that follows lands on a live socket.
- "+ Add" is now also undoable (it previously left an orphan row on Ctrl+Z).
- Tests: `components/extensibleRowUndo.test.ts` (identity + order + pair cases).

### EXTENDED SESSION DIGEST (2026-07-05, ~08:40 onward — "keep going" + a 20-min loop)
Continuation of the block below; per-item entries above this one. Everything verified
per commit (tsc + full vitest, now 2124; cargo 46/46 where Rust moved).
- **Built:** cube-child Nest Join (A2 — nest a pre-built hierarchy whole); popup
  "Go to node"; per-doc autosave keys landed just before this block.
- **Undo-correctness arc (audit-driven):** extensible-row add/remove is undoable
  (`b0066df` — the generic same-Input-object/key-order helpers); Note frontmatter key
  removal undo-coherent (A2 — confirmed WORSE than flagged: body edits pushed no
  history at all, the zombie cable never self-healed); CableSwitch lane restored on
  undo; F9 exempted from the presenter/drill-in keyboard gates (was a manual-mode
  dead end with all fallback chrome hidden).
- **New standing guards:** textForm reader fuzz (800 mutants — clean rejection or
  round-trip closure); ELK Tidy integration test (A2 — elkjs under vitest, the
  no-overlap invariant through the real arrange→standoff→separate chain).
- **Hygiene/docs:** guarded clipboard writes (non-secure contexts); 6 Rust dead-code
  warnings → 0 (parity-only verbs `#[cfg(test)]`-gated); architecture.md file-map
  fully reconciled (A3, incl. errorValue/textForm/documentStore gaps); dev-notes
  archival sweep (A3 — live window = 2026-07-01+); subsystem-invariants gained the
  per-doc-autosave + drill-in-mount sections; backlog verification sweep (A2 — ~35
  open items checked against code, 1 rot catch flipped).
- **Standby state:** the autonomously-actionable backlog is EXHAUSTED — what remains
  needs author decisions (image bundling memo, toolbar reroute, FC v1.1, conditional
  formatting) or is deliberately sequenced late (bundles 08/10, money/uncertain).

### OVERNIGHT SESSION SUMMARY (2026-07-05, ~03:30–08:30 — 3-agent autonomous crew)
22 commits on develop (NOT pushed — local session). Every commit: tsc clean + full
vitest green (2044 → 2110 tests, +67); cargo 46/46; production build healthy (main
chunk ~2.0 MB after the ELK split); desktop release exe builds. All 26 seeds swept
crash-free through the headless runner. Detailed entries for each item are below this
one; per-item "author eyeball" notes are inline there.

**Features built (all previously author-approved):**
- Frame Filter case-insensitive text matching + "Match case" (the D12 build) — `9ffc8e0`
- Coalesce/Fill full N-ary (extensible Else rows) — `540bba0`
- Per-doc autosave keys (per-doc two-slot pairs + light index) — `ce94761`
- Align/distribute selection action bar (A2) — `3172bc8` · ELK lazy-loaded, ~1.5 MB out
  of the main chunk (A2) — `4635e54`
- Cube-cell XLOOKUP on Frame Lookup (A2) — `5d4eac6` · drill-in dropped-cable notice
  (A2) — `d06517d` · quick-wire memoization (A2) — `1a10863`
- Popup "Go to node" — `4e75b68` · cargo-audit CI workflow (A3) — `7c069a7`

**Audit program (4 review agents + Lead's own passes; every confirmed finding fixed
same-night):** sketch bookkeeping leak `75c62c9`; round 2 `3141e10` (presenter left all
canvas shortcuts live; docked-Report squeeze orphaned on delete/doc-switch; Expect
blind to frames; model fuzz no-op in manual mode + fired real alerts; Problems relapse
suppressed forever; textForm broke SAVING on a frontmatter key with a space); round 3
`ce22c73` (composite drill-in leaked LIVE React roots — auto-refresh intervals ran
forever after close/delete; scrub-unmount cursor lock; stale add-menu on doc switch;
semantic zoom invisible in the canvas renderer; Write double-click race;
connectionStore.forget never wired) + the add-menu refinement `c22a6a3` (close on doc-ID
change only — autosave's notify was yanking open menus); Reconcile honesty fixes (A2)
`94bcbd9` (skipped-key rows surfaced; PVM excludes errored cells).

**New standing guards (A2):** `layoutInvariants.test.ts` (~1650 seeded fixtures — the
no-overlaps rule is now machine-checked; NO violation found) `11397dd`;
`formulaDivergence.test.ts` (the node-vs-Formula.js sweep is now a durable CI tripwire;
no new drift) `253727a`.

**Needs an author decision (queued, not built):** the composite toolbar-reroute
(architecture written up in the drill-in entry below — cross-cutting refactor, wants
you live); Image bundling (decision memo with a recommended option in the backlog item).
**Author eyeball list:** Filter's Match-case checkbox · coalesce Else rows + "+ Add" ·
the selection action bar · popup crosshair button · NaN/approx chips unchanged.

### Formula-engine divergence re-sweep — no new drift (2026-07-05)
Re-ran the node-vs-Formula.js divergence audit the backlog flags as periodic. The original
`_sweep` script was never committed (only referenced in docs), so instead of resurrecting a
one-off I built a DURABLE regression guard: `formulaDivergence.test.ts` pins, through
`resolveExcelFunction`, every override the 2026-06-25 consolidation put in because FX is wrong —
**MOD** (result takes the divisor's sign), **QUOTIENT** (÷0 → #DIV/0!, trunc-toward-zero),
**ATAN2** (Excel's x-first arg order), **ROUND** (half-away-from-zero), **RANK** (#N/A for an
absent value; FX returns 0), **RANK.AVG**, **TRIMMEAN** (floor-to-even trim count), **PERCENTRANK**
(interpolate + truncate) — each asserted against a hardcoded Excel reference. Plus "FX still
diverges" tripwires (MOD/ATAN2) so an FX upgrade that changes those bugs trips the test → the
override gets re-evaluated (a judgment call, surfaced not silently absorbed). Plus hardcoded-Excel
pins for the pass-through stats family (MEDIAN/GEOMEAN/HARMEAN/AVEDEV/DEVSQ/SUMSQ) that the audit
found already agree.
- **Finding: NO new divergence.** Every override still returns the Excel-correct value; FX still
  carries its known MOD/ATAN2 bugs (so the overrides are still warranted, not redundant); the
  pass-through stats still match Excel. The engine is consistent with the 2026-06-25 audit — text
  matching / numberToText / guardFinite changes since did not introduce drift in the swept set.
- **Why a test, not a script:** this converts a "run the sweep periodically" chore into a CI guard
  that reproduces any future divergence automatically. **Not swept (scope):** text/format-family
  output (TEXT/numberToText) beyond the numeric stat/math set, and node `data()` paths that DON'T
  share the registered impl — those are a wider follow-up if a specific concern arises.

### Layout no-overlap property tests — the "no overlaps ever" rule now machine-checked (2026-07-05)
The author's standing rule (nodes/groups never overlap after a layout op) had no automated
guard. New `layoutInvariants.test.ts`: seeded-PRNG (mulberry32) randomized-fixture sweeps over
the PURE layout cores, ~1650 fixtures total, **all green — no violations found**. What each op
guarantees (and, importantly, what it does NOT — so the suite asserts the right thing):
- **`separateOverlaps` (groupPushCore)** — the HARD backstop: after it, no non-baseline pair
  overlaps. 300 dense fixtures + 200 with a computed baseline of pre-existing overlaps (asserts
  it leaves user overlaps alone but clears the rest) + monotonic (only down/right shifts). This
  is THE no-overlap guarantee the group-expand pipeline leans on.
- **`computeExpandPush` → `separateOverlaps` (the app pipeline, groupPush.ts order)** — 200
  fixtures: push output is finite (no NaN), and the composed result has no non-baseline overlap.
  NOTE `computeExpandPush` ALONE is heuristic and CAN leave overlaps by design (its own header
  says so) — separateOverlaps is what makes it safe, so the suite only asserts no-overlap on the
  COMPOSED result, never on the raw push.
- **`distributeDeltas` (selectionOps)** — ≥ `DISTRIBUTE_GAP` between neighbours ALONG the
  distributed axis (overlap-free on that axis; the cross axis is intentionally untouched). 400
  fixtures (both axes).
- **`alignDeltas` (selectionOps)** — asserts the ALIGNMENT contract (align-left → shared min-x,
  etc.), NOT no-overlap: align is a manual gesture and is DELIBERATELY allowed to overlap (like
  every design tool), per its own doc + the 2026-07-05 decision to decline a separateOverlaps
  backstop for it. Testing no-overlap here would be wrong.
- **`solveStandoffs` (standoffSolver)** — the band holds: 400 single-standoff fixtures (pinned
  end + free end, random anchors/bands/lock) assert the axis projection lands in [min,max] and a
  locked/forced standoff zeroes the perpendicular; plus 150 east-anchored CHAIN clusters asserting
  every link's band holds. Uses satisfiable fixtures (a free end always converges) so a bounded
  best-effort solver isn't asserted past what it promises.
- **Outcome:** the pure cores hold the invariant under fuzzing — no bug to report. The suite is
  the deliverable (a regression guard that reproduces any future violation from its fixed seeds).
  Not covered (out of scope — not a pure core): ELK Tidy (async), and the standoff+separate
  integration in `settleStandoffs`.

### Popup "Go to node" action (2026-07-05, overnight)
The Pin follow-up from the backlog's "+ more" list: every value popup header
(Table/Frame/List, Chart, Cube root level, Formula) gains a crosshair button beside
Pin — closes the popup and `flyToNodeAndFlash`es the host node (the same camera fly +
flash ring as the error click-to-jump). `PopupGoToButton` lives with `PopupPinButton`;
the Formula popup routes through `commitAndClose` so a mid-edit formula commits before
the fly. Export/copy-as variants stay un-built ("do if wanted"). Author eyeball: the
crosshair glyph next to Pin (16px in the same even button).

### Per-doc autosave keys (2026-07-05, overnight)
The library no longer persists as one whole-library blob: each document gets its own
two-slot pair (`solenoid.docs.doc.<id>.a/.b`) plus a light two-slot INDEX
(`solenoid.docs.index.a/.b` — currentId + [{id, name, updatedAt, filePath}], no
graphs). An edit autosaves only the changed doc; a bloated doc exhausts only its own
quota headroom; deleting a doc removes its keys (its quota actually frees now).
- **The change-detection is OBJECT IDENTITY**, not stringify-compare:
  documentStoreCore's transforms are immutable (a changed doc is a new object), so
  `persist()` keeps a `_lastPersisted` map and writes only docs whose object differs —
  an unchanged doc costs ZERO serialization per autosave.
- **Slot seq is a strictly-monotonic counter** seeded from the clock — two
  same-millisecond `Date.now()` writes tied, making the newer-slot read ambiguous
  (surfaced instantly under test pacing; latent in the old whole-library code too).
- Slot seq is read via a `^\{"seq":(\d+)` prefix regex so picking the write slot never
  re-parses a large graph blob.
- No migration (D3): the old `solenoid.docs.lib.a/b` keys are deleted on startup. A
  corrupt/missing doc slot is skipped on restore (the rest of the library loads).
- `validateDoc` extracted in documentStoreCore (validateLibrary now uses it). Tests:
  `documentStorePersist.test.ts` (localStorage stub — writes-only-changed, key removal
  on delete, restore round-trip, old-key cleanup, corrupt-slot skip).

### Audit fixes round 3 — reviewers C/D (interaction-feel + timers/sinks) (2026-07-05, overnight)
Second review fan-out; every confirmed finding fixed (tsc clean, vitest 2090 green):
- **Composite drill-in leaked live React roots** (`CompositeEditorOverlay.tsx`): close
  only detached the cached mount's container — the fibers stayed mounted, so a
  Connection node's auto-refresh interval inside a closed (or DELETED) composite kept
  firing full `processGraph()`s forever. The close cleanup now REMOVES every internal
  node/connection view (unmounting each view's React root runs its effect cleanups →
  timers die); views re-backfill idempotently on each open. The mount itself stays
  cached — the internal editor has no `unuse`, so a fresh AreaPlugin per open would
  accumulate dead pipes. Plus `compositeEditorStore.close()` joined `rebuildGraph`'s
  reset list (a drill-in open across a doc switch rendered a node from the dead graph).
- **Scrub unmount mid-drag locked the app cursor** (`inlineInput.tsx`): dragging blurs
  focus, so Delete reaches the canvas and can delete the node UNDER the scrub; the
  unmount cleanup only unbound the Esc listener, leaving `solenoid-scrubbing`
  (ns-resize `!important`) on `<body>` until the next completed scrub anywhere. The
  cleanup now clears the drag state + class, gated on this field owning the live drag.
- **Quick-wire/Add menu survived a document switch** (`Canvas.tsx`): Ctrl+O fires even
  with the menu's search focused; ids regenerate on load, so a pick from the stale menu
  silently added an orphan unwired node into the NEW doc. Any documentStore change now
  closes the menu.
- **Semantic zoom was invisible in the HTML-in-canvas renderer** (`HtmlCanvasLayer.tsx`):
  the store wasn't in the rebuild-trigger list, so big graphs (exactly where that
  renderer activates) kept drawing stale full-detail bitmaps through the whole zoom
  gesture. Subscribed like the other seven trigger stores.
- **Write CSV/JSON double-click raced concurrent writes** (`sink.ts` + `WriteNodes.tsx`):
  the button's disabled state only updated AFTER the awaited write. `run()` now has a
  re-entrancy guard and the component reflects "writing" synchronously.
- **connectionStore.forget was dead code** — defined "call when the node is removed" but
  never registered; deleted connection nodes' status/token entries lived for the tab's
  lifetime. Now self-registers on the nodeStoreRegistry forget seams like every sibling
  store.
- Verified sound by the reviewers (recorded, no change): scrub undo granularity (one
  entry per gesture) + commit-on-release; palette gating incl. the new presenter gate;
  quick-wire leaves no temp node on cancel; manual-mode auto-refresh correctly only
  marks dirty; headless runner spins no timers; sink `enabled` stays unpersisted;
  Session History is bounded + polls at 1s.

### Quick-wire: memoize the per-type socket signature (2026-07-05)
`filterByCompatibleSocket` (`catalogSearch.ts`) was calling `leaf.create()` for EVERY catalog
leaf on EVERY quick-wire cable drop — instantiating a full throwaway node just to read its
socket types. A node type's INITIAL sockets are deterministic per catalog `type`, so the
input/output socket-type sets are now memoized in a module-level `_sigCache` keyed by
`leaf.type`: the first drop instantiates each leaf once, later drops reuse the cached set and
only re-run the cheap per-origin `canConnect` check (the origin varies per drop; the signature
doesn't). Behaviour is identical — verified by a test that the 2nd filter pass triggers zero
new `create()` calls, plus a real-catalog narrowing check. The cache is never invalidated (a
type's socket shape is constant for the app's life). `firstCompatibleSocketKey` stays as-is —
it runs once on the actually-picked node and needs the concrete socket KEY, not a type set.

### cargo-audit runs in CI (2026-07-05)
Approved 2026-07-02, built overnight. `.github/workflows/cargo-audit.yml` runs `cargo
audit` against `src-tauri/Cargo.lock` on every push to `develop` that touches the
lockfile, the workflow itself, or `src-tauri/audit.toml` (plus a manual
`workflow_dispatch`), separate from `test.yml` (JS-only) and `windows-portable.yml`
(full Tauri build) since it needs neither. `audit.toml`'s ignore list starts empty —
add an advisory ID with a one-line reason when triage noise comes up, never a
blanket crate ignore.

### Reconcile: blank-key rows + errored PVM cells no longer silently swallowed (2026-07-05)
Two confirmed audit findings in `reconcileFrames` (`frameVerbs.ts`), both about the node
quietly making data disappear.
- **(a) Blank/invalid-key rows were dropped from BOTH the output frame and the counts.**
  `keyIndex` skips a row whose key is null/error (correct — it can't join), and `allKeys`
  was built only from those indexes, so such a row never appeared anywhere. Now: after the
  match loop, left/right rows with a null/error key are appended as their own `"skipped"`-
  status rows (a new `ReconcileStatus` value — left rows carry before-values, right rows
  after-values) and counted in `summary.skipped`. Refactored the row emission into a
  `pushRow` closure so matched and skipped rows build identically. A keyless row is NOT
  miscounted as added/removed (it has no key to match on — "skipped" is the honest label).
- **(b) PVM read an errored/missing price or qty as 0** (`bn ?? 0`), fabricating a bogus
  swing (an errored after-price → a huge negative price variance) with no flag. Fixed by
  distinguishing a **structural** absence from an **unknown** cell: `pvmFactor(present, raw)`
  returns `0` only when the row is ABSENT on that side (a new/removed row genuinely had 0
  before/after) but `null` when a PRESENT cell is errored/non-numeric. Any row with a null
  factor is excluded from the decomposition and tallied in `pvm.excluded`; the surviving
  rows keep the exact identity price+volume+mix = delta (now the delta of the decomposable
  rows only). `summarizeReconcile` (`nodes/frame.ts`) surfaces both counts ("N skipped
  (blank/invalid key)", "PVM excludes N rows (blank/errored price or qty)") only when > 0,
  so clean reconciliations read unchanged.
- **Gotcha for future work:** the PVM `delta` is now the decomposable-rows delta, NOT the
  whole-population change when `excluded > 0` — that's deliberate (the excluded rows' change
  is genuinely unknowable) and the summary says so. Tests: new `reconcile.test.ts` (8 cases).
  tsc clean, full vitest 2083 green. Pure engine + summary string — no UI, no eyeball needed.

### Audit fixes round 2 — overlay state, Expect frames, fuzz side effects, Problems relapse, textForm quoting (2026-07-05, overnight)
Two parallel review agents swept the newest overlay/state subsystems + the trust/quality
bundle; every confirmed finding fixed the same night (tsc clean, vitest 2076 green):
- **Presenter mode left ALL canvas shortcuts live** (`Canvas.tsx`): the keydown handler
  gated on `compositeEditorStore.isOpen()` but not `presentationStore.isActive()` — the
  overlay's own → advance ALSO nudged the still-selected Presentation node 24px per
  slide on the hidden canvas, and every bare-letter/Ctrl shortcut mutated the graph
  mid-show. Added the mirror gate.
- **A docked Report's canvas squeeze was orphaned forever** if its node was deleted or
  the document switched while docked (`html.sol-report-docked` stayed on the root; the
  only undock button lived inside the unrenderable panel). Fixed twice over: Canvas's
  `noderemoved` pipe closes `reportStore`/stops `presentationStore` when their node id
  is removed (also covers doc switches — rebuilds remove nodes one at a time), and
  `rebuildGraph`'s bulk-reset now closes both stores explicitly (belt-and-braces, the
  store-list convention).
- **Expect was blind to frames** (`nodes/quality.ts`): a FrameValue fell into the scalar
  arm, so all four checks silently no-opped on the app's core data shape (a total false
  negative for the data-quality gate). Now checks CELLS (not-null/range/regex flatten
  all columns) and unique means unique ROWS. A lazy ref is already materialized by
  coerceInputs (Expect isn't a lazy verb node). Tests in `quality.test.ts`.
- **Model fuzzing was a silent no-op in manual calc mode** (processGraph short-circuited
  every sampled recompute → the sweep inspected stale values and reported "no problems
  found") **and fired real Alert toasts** off synthetic samples. One fix for both: the
  sweep now runs inside `beginGraphRebuild`/`endGraphRebuild` (the manual gate exempts
  rebuilds; AlertNode/Expect suppress fires during them — violations still record, so
  `inspectNode` sees everything). Also try/finally around the per-leaf loop so a throw
  can't leave a synthetic sample in the user's graph.
- **Problems panel suppressed a relapse forever** (`problemsStore`): `_lastLiveCode` was
  never reset when a node computed clean, so fix-then-recur of the same code was
  swallowed. The error-sink seam now reports `null` on a clean pass (`errorValue.ts`
  `reportOut`) and the store clears its edge-detect (history stays). Tests in
  `problemsStore.test.ts`.
- **textForm: a frontmatter output key with a SPACE broke saving** (probe-confirmed:
  `unit price: 5` wired → `in<-Note_1.unit price` → reader threw 'malformed field
  "price"', and serializeGraph routes every JSON save through the writer). The writer
  now JSON-quotes a non-bare source-output key (space/quote/backslash; a DOT stays bare
  — first-dot split is safe since names are NAME_RE-clean), the reader decodes it, the
  tokenizer already carried quoted spans whole. Existing seeds byte-identical (bare
  stays bare). Adversarial round-trip tests added.
- Still open from the review pass (queued to Agent 2, their files): `reconcileFrames`
  drops null/error-keyed rows silently; PVM zeroes errored price/qty cells.

### Frame Lookup gains a Cube half — by-key read into a cube (2026-07-05)
The cube half of the future unified XLOOKUP (v1.1-plan WS-D). Frame Lookup now looks a key
up in a **Cube**'s top-level column and returns the matched cell WHOLE — a nested frame/cube
comes out intact (drill in with INDEX). Scope stayed narrow: just the net-new cube case, NOT
the full list+frame+cube node merge (that has open input-surface/migration questions needing
the author).
- **Engine (`frameVerbs.ts`):** `lookupCubeCell(cube, inCol, retCol, lookup, matchMode)` mirrors
  `lookupFrameCell` — first-match-wins, null/error key never matches, `#REF!` on a missing
  column, approximate `nextSmaller`/`nextLarger` on a numeric key. Operates on the cube's OWN
  flat top-level columns only; it never descends into nested cells (the "a verb works on the
  level it's handed" rule). **Gotcha:** a cube column has NO per-column type (heterogeneous
  cells), so the key type is INFERRED from the flat scalar cells (`inferCubeKeyType`:
  all-number → number, all-boolean → logical, else string). Consequence — a cube stores a date
  as its serial NUMBER, so a cube date key matches by SERIAL, not by an ISO string the way a
  typed frame date column does (documented in the catalog entry; Unnest to a frame for ISO
  date lookups). A nested frame/cube/list cell can never be a lookup key.
- **Node (`nodes/frame.ts` FrameLookupNode):** the source input changed `frameIn` → `anyIn`
  ("Frame / Cube"), because a cube can't narrow into a frame socket (sockets.ts). This is the
  INDEX precedent (`anyIn`/`anyOut`, branch on `isCubeValue`) and the sanctioned unified-XLOOKUP
  direction. **Why `any` and not `cubeIn`:** a `cube` socket auto-widens a frame to a typeless
  cube via `coerceValue`'s cube case (dropping the frame's column types → date-column regressions);
  an `any` socket passes a frame through UNTOUCHED (full type-aware `lookupFrameCell` preserved) and
  a cube through as a cube. Lazy `FrameRef` materialization is not socket-typed (`wrapNodeData`
  collects any ref for a non-lazy node), so refs still resolve at an `any` socket. `asLookupSource`
  keeps the old frame-widening for a bare list/matrix/scalar so nothing regresses. Existing
  frame→lookup cables stay valid (`any` accepts a frame). Result box now uses the cube-aware
  `ResultDisplay` (Frame→FrameDisplay, Cube→CubeDisplay, else ValueDisplay) instead of ValueDisplay,
  so a returned nested table renders as a drillable chip.
- **Author eyeball:** wire a Nest Join cube into Frame Lookup, look a parent key up, confirm the
  returned nested sub-frame renders as a drillable chip and the source socket reads sensibly as
  `any`. Tests: `frameLookup.test.ts` +12 cube cases (scalar/nested-whole/null/logical/no-match/
  non-key-column/#REF!/approximate/#VALUE!). tsc clean, full vitest 2062 green.

### Audit: calc-mode / sketch / lazy-flush surfaces (2026-07-05, overnight)
Walked the manual/auto/sketch + fusion machinery end-to-end. One real defect,
fixed; the rest verified sound.
- **FIXED — sketch bookkeeping leak in `clearCollectMemo` (frameBackend.ts):** the
  per-pass memo sweep dropped every flushed handle via `be.drop(h)` but left the
  handle's `_sampleFactor`/`_sketchInfo` entries in their strong Maps — the exact
  leak the sibling path `dropFrameRef` guards with its "else a sketch-mode entry
  outlives its handle forever" comment. In sketch mode every live-edit pass leaked
  up to one entry per flushed chain, unbounded over a long session (sketch's whole
  use case). Handles are monotonic on both backends (`jsf:${++seq}` / Rust
  AtomicU64), so it was a pure leak, never wrong scaling. Now the sweep deletes
  both entries alongside the drop.
- **Verified sound:** `requestRecalc`'s force-exact bracket is depth-counted and
  `finally`-guarded; the manual-mode short-circuit exempts graph rebuilds and marks
  dirty on every suppressed path; flush/collect memos are per-pass and fan-out
  flushes once; `maybeSketchSample` samples once per chain (sample-derived handles
  skip re-sampling); scaling touches ONLY sum/count aggregate columns; sketch is
  fully surfaced (File→Calculate menu + StatusBar "≈ approximate" chip + palette —
  not palette-only).
- **Deliberate-looking behavior, recorded not changed:** `runFrameJoin`/
  `runFrameAppend` never sample their inputs in sketch mode — the join itself runs
  full-cost and only the downstream unary chain samples the join's OUTPUT. That's
  the statistically safer choice (independently sampling both key sets would
  destroy the match rate), at the cost of sketch not accelerating the join step
  itself. If join cost ever needs sketching, sample the LEFT side only.

### Composite drill-in follow-ups: dropped-cable notice DONE; toolbar reroute is its own session (2026-07-05)
Two flagged drill-in follow-ups (backlog "Drill-in editor v2 niceties").

**(b) DONE — surface the outer-cable drop on close.** When a boundary marker (CompositeInput/
OutputNode) is deleted INSIDE the subgraph, closing/drilling-up drops its exposed port and any
OUTER cables wired into it. That's correct (the port is gone) but was silent. `leaveLevel`
(`CompositeEditorOverlay.tsx`) now tallies the parent connections it severs and fires a `warn`
`pushNotice` ("Removed N cable(s) connected to <name> — a port was deleted inside."). Both close
paths (full close + breadcrumb drill-up) go through `leaveLevel`, so both are covered. Counts only
ports that actually had outer cables (a deleted-but-unwired port is invisible, no notice). Not
unit-tested — the reconcile is component-internal and vitest's env is node (no jsdom); **author
eyeball:** delete a wired boundary input inside a composite, close, confirm the toast reads right
and fires once.

**(a) DEFERRED — reroute the real toolbar / mobile bar to the active subgraph.** This is the
author's ask but it is a genuine cross-cutting refactor, NOT something to land blind overnight, so
I scoped it instead of half-wiring it. Why it's big:
- Every main-chrome op is bound to the MAIN editor/area: `autoArrange`/`cleanup`/`deleteSelected`
  are `process.ts` singletons Canvas registers against its own editor; add-node is
  `addMenuRequest`; undo/redo is Canvas's `HistoryPlugin`. TopBar/MobileControls/MenuBar all call
  those.
- Canvas's window keydown **fully stands down** while a drill-in is open (`Canvas.tsx:691`
  `if (compositeEditorStore.isOpen()) return;`), so the single-key shortcuts (A/T/G/…) already do
  nothing inside a drill-in — they'd need rerouting too.
- There is **no drill-in Tidy** — `arrangeFn` is ~500 lines of Canvas-specific ELK/group/standoff
  logic reading the main `getArea()/getEditor()` throughout; a subgraph arrange is its own build.
- `getEditor()/getArea()` are assumed == MAIN in hundreds of call sites (persistence,
  serialization, recompute-retargeting to `stack[0]`), so a global swap is out — the reroute must
  be surgical to the ACTION layer only.

**Proposed architecture (for the scoped session):** add an "active graph context" to `process.ts`
— `{ editor, area, history, arrange, cleanup, deleteSelected, addNodeAt, fit }`, default = main.
The drill-in overlay registers ITS context on open and restores main on close (like the existing
`setAutoArrange`/`setDeleteSelected` hooks, but as one swappable bundle). The toolbar action
wrappers (`autoArrange()`, `deleteSelected()`, add-node, undo/redo) resolve through the active
context; **data/persistence keeps calling the main `getEditor()` directly** (unchanged). Canvas's
keydown, instead of `return`-ing when a drill-in is open, dispatches the same actions against the
active context (or the drill-in installs its own keydown — it already handles Del/undo/redo/Esc).
Then the drill-in's private header toolbar collapses to just the breadcrumb + "+ Input/Output"
(the two subgraph-only actions), and the app chrome drives the rest. Wants live eyeballing; best
done author-present. Backlog item updated to reflect the split.

### Coalesce is full N-ary — FillNode extensible Else rows (2026-07-05)
Closed the last array-semantics polish item (subsystem-invariants "Error values" listed
it since 2026-06-22). The Fill node's coalesce mode now takes ANY number of fallback
lists in priority order: the fixed `else` input became extensible rows keyed `e0, e1, …`
(CableSwitch's `addValueInput`/`nextInputId` machinery, CHOOSE's valueKeys-filter
convention on reload — `extractInit` snapshots ALL input keys, the constructor keeps only
`/^e\d+$/`). Semantics per position: first present of List, then each Else in row order;
errors are PRESENT (pass through at their priority slot); a wired longer Else still
EXTENDS the output (the old 2-source behavior, kept). New: a typed number literal on an
UNWIRED Else row acts as a broadcast last-resort constant (`COALESCE(x, 0)` in one node)
and does NOT extend the output.
- Component: coalesce mode renders through the shared `ExtensibleInputs` (add/remove,
  collapse pill); other modes keep plain `InlineInputs` BUT now hold a **wired**
  value/Else row visible (the Expect-node "a wired socket must never disappear" rule —
  previously switching op away from constant/coalesce dangled the cable endpoint).
- Old saves wiring `else` drop that cable on load (pre-alpha, no alias — D3); the
  null-and-logical seed retargeted to `e0`.
- Author eyeball: the Else rows + "+ Add" under the op dropdown on a coalesce Fill card.

### Frame Filter text matching is case-insensitive; "Match case" opt-out (2026-07-05)
The D12 build (backlog "Frame Filter text matching", audit 28's reversed half): string
eq/neq + contains/startsWith/endsWith on the Filter node now match case-INsensitively —
Excel's `=` / FILTER / AutoFilter semantics, and the app's one text-equality rule. A
**Match case** checkbox (shown only while the op is one of the five text ops) restores
exact matching; it persists via `matchCase` in `INIT_FIELD_ORDER` and rides the wire as
an optional flag on the filter op (serde `default`, so old saves/plans deserialize fine).
Join / Group By / Distinct stay case-SENSITIVE (keys are identity — D12); their catalog
descriptions now say so.
- **The fold is a plain Unicode lowercase** (JS `toLowerCase` = Rust `to_lowercase`),
  deliberately NOT locale-aware — the one spec both engines implement identically
  (José/JOSÉ parity-tested on both). String `<`/`>` ordering untouched (separate P3).
- **Rust routing:** a case-insensitive string eq/neq can't stay a pure Polars expr
  (no `strings` feature), so it joins the text predicates' in-engine row-scan.
  `filter_needs_text_scan` is the ONE predicate shared by `verb_filter` and the fused
  `apply_step` so the standalone and lazy paths can't drift — mid-chain it collects that
  step and resumes lazily, same as contains (guarded by
  `apply_ops_case_insensitive_string_eq_mid_chain`).
- Tests: frameVerbs.test.ts (CI default, matchCase, accents, applyVerb flag) + 2 new /
  updated cargo tests. Author eyeball: the checkbox row on the Filter card (13px box,
  ExpectNode's CheckRow styling).

### ELK auto-arrange split out of the main bundle (2026-07-05)
recharts + KaTeX were already lazy; ELK (`rete-auto-arrange-plugin` + its elkjs dependency,
~1.49 MB uncompressed) was the last eager heavy chunk — `AutoArrangePlugin` was statically
imported and `area.use`d at Canvas init even though only Tidy needs it. Now lazy:
- `Canvas.tsx` imports `AutoArrangePlugin` as `import type` (fully erased at build — no
  runtime pull). An `ensureArrange()` closure `await import("rete-auto-arrange-plugin")`s the
  plugin on the FIRST Tidy, builds it, adds the symmetric-port preset, `area.use`s it, and
  memoizes (`arrange` / `arrangeLoading`); later Tidies resolve instantly. `arrangeFn`
  resolves it right before `arrange.layout(...)` and bails if null.
- **Gotcha:** the dynamic import is async, so a doc-switch/unmount can destroy the area
  mid-load — `ensureArrange` re-checks the existing `destroyed` flag after the import and
  returns null (arrangeFn then returns without laying out). The eager `area.use(arrange)` at
  init was removed; registration now happens inside `ensureArrange` (registering a plugin on
  the area after init is fine — auto-arrange only acts on explicit `.layout()` calls).
- Verified: `rete-auto-arrange-plugin.esm-*.js` is now its own ~1.49 MB chunk in the build
  output (was folded into `index`); tsc + full vitest green (2047 passed). No behaviour
  change to Tidy itself.

### Align/distribute UI affordance — the selection action bar (2026-07-05)
The six aligns + two distributes existed only in the Command Palette; author's standing
rule is nothing reachable solely via the palette. Added `components/SelectionActionsBar.tsx`
(+ `selectionActions.css`, mounted in `App.tsx`): a floating overlay pill at the
**bottom-centre** of the canvas that appears whenever **≥2 top-level nodes are selected**,
carrying the six align buttons + a divider + the two distribute buttons. Pure surface —
every click calls the existing `alignSelection`/`distributeSelection` in `selectionOps.ts`,
no logic added there.
- **Why fixed position, not anchored to the selection bbox:** a bbox-anchored bar would
  have to track the area transform and would lag/jitter behind a live multi-drag. The
  selection is already highlighted on the canvas, so a stable contextual bar is enough and
  never fights `area.translate`. Reuses the overlay-pill tokens (`--panel-bg`,
  `--panel-border`, `--shadow-pop`, `--btn-hover`) so it reads as the same family as the
  nav/zoom pills.
- **Visibility gate:** polls the graph every 150ms (selection has no push store — same
  approach `OutlinePanel` uses) counting selected nodes that have a rendered `nodeView`
  (the "measurable" set the ops actually act on). Hidden entirely when the canvas is
  **locked** (nodes can't move) and when <2 selected. Distribute buttons **disable** at
  exactly 2 (needs ≥3 to have anything between the extremes; matches `distributeDeltas`
  returning `[]`).
- **Gotchas honoured:** `onPointerDown` stopPropagation on the pill so clicking a button
  doesn't reach the canvas selection-clear (same guard the mobile bar uses); 16px (even)
  icon glyphs in 26px (even) buttons per the even-icon centring rule; the group divider is
  its own 1px element, NOT a button border (a border would shrink the adjacent button's
  content-box to an odd width and blur its icon). Align-center titles name the END EFFECT,
  matching the palette ("Align center (vertical)" = `center-h`). On touch the bar lifts to
  `bottom: 84px` to clear the mobile action bar.
- **Author eyeball:** confirm the pill's placement/opacity reads right, the icons are
  legible at 16px, and it doesn't collide with the StatusBar or (on a narrow window) the
  mobile bar. tsc + full vitest green (2044 passed); no render test (vitest env is node).

### Layout: node-size unification + align/distribute root-cause (2026-07-05)
Author flagged buggy align/distribute + fragile Tidy + overlapping authored seeds as
likely one root cause. Investigation (Explore agent) confirmed: **no canonical node-size
accessor** — every layout feature re-derived a box with its own
`offsetWidth || node.width || <const>`, fallbacks inconsistent (100×50 / 180×160 / 0 /
none). `offsetWidth` is 0 until a card paints, so unpainted nodes read zero-size or a
stale design-time estimate.
- **`nodeSize.ts` `measuredBox(area, id, editor?)`** — the ONE accessor: live DOM →
  stored size → single default (`FALLBACK_NODE_W/H` 180×100). Fallback is **collapse-aware**
  (`COLLAPSED_NODE_H` 52 for a collapsed-but-unpainted node); a painted node's
  `offsetHeight` already reflects collapse, so that's the truth for anything on screen.
  Routed `selectionOps`, `groupLogic.nodeBox`, `compositeLogic.nodeBox` through it (the
  last two read raw offsetWidth with NO fallback → collapsed the wrapped bbox to a corner).
- **align/distribute were NOT primarily a measurement bug** — two real defects: (1) the
  selector's group-follow (rete `selectableNodes` moves the whole selection when one
  selected node is translated) corrupted every per-node move → "2 of 3 align, random;
  distribute does nothing". Fixed by clearing the selection during `applyMoves` then
  restoring it (same guard Tidy's arrangeFn uses). (2) distribute spaced CENTERS
  (overlaps mixed-height nodes) → rewrote to equal **edge gaps** with a guaranteed
  `DISTRIBUTE_GAP` (40, ~Tidy's ELK nodeNode 38): fits → ends fixed, interior evened;
  stacked → anchor leftmost, push out at min gap (rightmost moves). Also deduped the move
  set so a node under two seeds (group+member, cluster) isn't translated twice. Pure
  `alignDeltas`/`distributeDeltas` extracted + unit-tested (`selectionOps.test.ts`).
  Align-center palette labels name the END EFFECT (author): `center-h` aligns the
  horizontal centres → nodes stack VERTICALLY, so it's labelled "Align center
  (vertical)", and vice versa. `separateOverlaps` backstop declined (author 2026-07-05):
  align/distribute/Tidy own overlap, no standalone command/load-hook.
- **Still TODO (the reshuffling piece):** a top-level `separateOverlaps` backstop after
  global Tidy / on load, so authored seeds + tidy output can't overlap (author's "no
  overlaps ever"). The pure de-overlap (`groupPushCore.separateOverlaps`) exists and is
  wired only into group-push; a top-level pass needs the same unit-boxing groupPush.ts
  does (group/standoff-cluster as one box, members moved rigidly, docked FCs excluded) —
  real correctness surface, reshuffles the canvas, so gated on author eyeball.
- **Flagged:** align/distribute live only in the Command Palette; author wants a visible
  UI affordance (backlog, tied to #57). Bundle-split recharts + KaTeX out of the main
  chunk this session too (main 4.0→3.53MB); alert chips lost their per-kind icon (label
  coloured by kind instead), Problems/Alerts icons swapped (triangle vs bell).

### 1.0-tail readInput sweep — RESOLVED (not a blanket sweep) (2026-07-05)
The item's "sweep the scalar nodes' data()" was applied to scalar.ts (element-wise math). Task #7
tracked "the remaining data() files" — but a per-file scan (list/matrix/complex/date/stats/finance/dist)
showed every remaining `inputs.x?.[0] ?? this.literals.x` site is a CONFIG or SEARCH parameter, not a
flowing data operand: generator params (count/start/step/ratio/window/fill/min/max), sizes/orders (n,
wrapCount), date parts (month/minute/basis/weekend_code), option codes, lookup values. The swallow-a-
wired-null bug (`[null]+10 → 10`) only ever bit element-wise ARITHMETIC over data — those are the
scalar.ts nodes, already done. stats.ts routes its data LISTS through `forAggregate` (null-safe), and
its scalars are config (k/p/q/sig-figs). Applying readInput to a config input would be WRONG — a blank
config should DEFAULT (the DATA-vs-CONFIG rule, same one #4 uses), not propagate null. So there's no
blanket sweep to do; the meaningful scope is complete. Also fixed this session (NaN follow-ups): the
FrameDisplay/TableDisplay/TablePopup cell formatters still said "N/A" for a NaN cell (a lie) — now
"NaN" + a per-cell tint (`.solenoid-nan-cell` / `.table-popup__cell--nan`); and formulaToLatex's string
literal used the unsupported `\textquotedbl` → garbled KaTeX, now literal quotes + escaped specials.

### 1.0-tail #4 — input defaults as muted placeholders (2026-07-05)
`(default X)` in a socket label documented a default as parenthetical prose (Captain-Obvious). Now
`InlineInputs` GENERICALLY parses it (`splitDefaultLabel`, exported from inlineInput.tsx): a label
matching `/^(.*?)\s*\(default\s+(.+?)\)\s*$/` renders the bare label + `X` (surrounding quotes
stripped) as the field's MUTED placeholder. No per-node display code — it self-maintains for any future
`(default X)` label. `placeholder` was threaded through `InlineNumberField` (already had it) and
`InlineTextField` → `QuotedTextInput` → `QuotedInlineInput`. For the placeholder to actually SHOW, the
pure-default configs ship their literal UNSET: RANDARRAY min/max, SEQUENCE start/step, TEXT/FIXED
decimals (removed from `literals`; data() still defaults via `?? X`), and NumberValue's decimal/group
seps (ship empty, data() switched `??`→`||` since "" isn't nullish). Finance redemption KEEPS its
worked-example value (it's part of a bond-pricing demo, not a bare default) — its label still cleans up
via the parse, the value just stays visible. **This supersedes the "config inputs keep defaulting"
half of #1's read-idiom rule for these fields — but they're CONFIG, so the default still applies; only
the DISPLAY changed (value→placeholder), the semantics are identical.** No test (pure regex + UI —
author eyeballs); tsc + 2015 tests green, no churn. STATUS: all 6 queued tail items done.

### 1.0-tail #6 — NaN display affordance (2026-07-05)
`formatScalar`/`listPreview` rendered a residual NaN as "N/A" — a LIE post-finding-13, where `#N/A` is
a real, catchable tagged error and NaN is merely dirty data (an undefined value in the source). Now
they render the literal "NaN", and `ValueDisplay` gives a SCALAR NaN a quiet affordance:
`.solenoid-node__nan` — neutral muted tint (`--text-dim` @ 10% over `--surface-sunken`), mono + italic
so it reads as a state not a number, deliberately NOT the error red badge nor an ArrayChip — plus the
structural tooltip "Not a number — an undefined value in the data". The NaN branch sits before the
FC-annotation/`render`/`fmtScalar` fallback so it wins even with a Format Controller docked. Follow-up:
per-cell NaN tint inside a list ArrayChip / popup grid (the scalar box is done; list cells show the
plain "NaN" text). Author eyeballs the styling. Tests: format.test.ts updated. No churn.

### 1.0-tail #5 — numberToText at 15 sig digits for text contexts (2026-07-05)
`numberToText(x)` (excelFunctions.ts) = `parseFloat(x.toPrecision(15)).toString()` — 15 clean decimal
digits, trailing zeros stripped, so `(0.1+0.2) & " kg"` prints "0.3 kg" not the 17-digit float noise.
Rationale is IEEE (a double carries ~15 clean digits; 16–17 are representation garbage), not
Excel-mimicry. Routed through `toStr` (so LEN + every internal text fn get it) and the `&` operator
(applyOp); internal CONCAT/CONCATENATE/TEXTJOIN now own the join via `toStr` (was Formula.js's raw
String). CONCAT/TEXTJOIN are range functions (whole arrays, `flat`-tened); CONCATENATE is element-wise.
Sci-notation thresholds deliberately not chased (`.toString()`'s own e-notation is fine). Non-finite
falls back to String (guardFinite tags those first). Tests: excelFormula + excelFunctions. No churn.

### 1.0-tail #3 — IFS/SWITCH no-match → #N/A, CHOOSE out-of-range → #VALUE! (2026-07-05)
An uncovered IFS/SWITCH case with NO fallback is a logic hole, not missing data — so it's a loud,
catchable `#N/A` (matches XLOOKUP not-found), not a silent `null` aggregators skip. `isSet(inputs,
literals, key)` (logic.ts) distinguishes an UNSET fallback (no cable AND no literal) from one
deliberately SET to a value (incl. null/0, which is returned as-is). CHOOSE out-of-range index →
`#VALUE!` (Excel's code). Fresh SWITCH ships the Default EMPTY (changed `expr` literal 0→1 so it
matches when0 and still shows a real result); IFS fresh already matches cond0. Muted **"N/A"
placeholder**: `InlineNumberField` gained a `placeholder` prop (default "0"), and
`PairedExtensibleInputs` renders the trailing fallback box via its `field()` helper with
`placeholder="N/A"` — a state cue, not a typed value (blank→#N/A, type a value→that value, clear→#N/A).
Formula IFS/SWITCH inherit #N/A for free (Formula.js no-match → Error → Expression `tagResult` →
SolError). Tests: logic.test.ts (Choose #VALUE!, IFS/SWITCH unset→#N/A, set→value). No churn.

### 1.0-tail #2 — non-finite guard + #RANGE! → #OVERFLOW! rename (2026-07-05)
The settled model: a COMPUTATION never yields a bare NaN/Infinity — they're classified into tagged
errors, so a residual NaN can only be dirty DATA. `guardFinite(result, ...inputs)` in `valueKinds.ts`:
NaN → `#DOMAIN!`; ±Inf from all-FINITE inputs → `#OVERFLOW!`; ±Inf when an INPUT was already infinite
PASSES (the Constant node's ∞ is first-class). Wired at the producing op — `shared.ts`
broadcast/broadcastErr, `excelFormula.ts` `applyOp` (operators) + `broadcastCall` (functions like
EXP/POWER) — with input awareness, so Expression's `tagResult` no longer blanket-tags ∞; it trusts the
op guard and passes a surviving (definable) ∞, netting only a stray NaN. `0^0 = 1` (JS/Polars; Excel
#NUM! — parity:false note on the pow leaf).
- **`#RANGE!` → `#OVERFLOW!` rename (author call).** `#RANGE!` only shadowed Excel #NUM!'s vague naming;
  `#OVERFLOW!` says what happened, and Solenoid's taxonomy is deliberately more descriptive than Excel's.
  It's a RENAME, not an addition — inventory stays 14. Both prior meanings (magnitude overflow AND the
  RANDARRAY/SEQUENCE count-limit) fit "exceeded a ceiling." Pre-alpha, no alias (errors aren't
  serialized). `ERROR_TYPE_NUM` gained `#OVERFLOW!`/`#CONV!` → 6 (they split #NUM! like `#DOMAIN!`; were
  falling to the #VALUE!=3 default — a latent bug fixed here).
- **Gotcha:** `guardFinite` must run at the OP (input-aware), not at a node's final output — a top-level
  output guard can't tell a passed-through definable ∞ (∞ input) from an overflow ∞ (finite inputs), so
  it would wrongly tag ∞+5 (∞ wired in) as #OVERFLOW!. That's why `tagResult` was demoted to a NaN
  safety-net once the op-level guards landed.
- Tests: `broadcastContract.test.ts` guardFinite unit + Arithmetic 10^400 / ∞+5 / 0^0 + formula 2^5000.
  No test churn (existing tests didn't exercise ∞-producing computations). Commit: this session.

### 1.0-tail #1 — per-cell error/null broadcaster contract + readInput (2026-07-04)
Item #1 of the tail. The rule was in `applyOp` (operator path) but not the broadcasters, so a per-cell
error/null in a FUNCTION or a numeric NODE decayed (`ABS([1,#DIV/0!,3])` morphed the error; `[1,null,3]+10`
→ `[11,10,13]`). Factored ONE rule — per output cell, before the op: SolError operand → that error
UNMORPHED (first in arg order); else missing → `null`; else compute — into `shared.ts`
broadcast/broadcastErr, `excelFormula.ts` broadcastCall + unary/percent, and `logic.ts` broadcastEl.
- Shared helpers `cellShortCircuit` (full) / `cellError` (error-only) in `valueKinds.ts` + `COMPUTE` sentinel.
- **broadcastEl gotcha:** the logic family keeps feeding `null` to its own fn (Kleene: `null AND FALSE =
  FALSE`), so it uses `cellError` (error half only), NOT `cellShortCircuit`. The IS-test family (ISERROR/
  ISNA) is unaffected — it has its own `deepTest`/`deepNull` maps, doesn't touch broadcastEl. IF's per-cell
  now propagates an error in ANY branch (matches its scalar behavior, where the node guard already poisons
  on any-branch error — not a regression, a unification).
- **broadcastCall gotcha:** a `NULL_INSPECTING` set (ISBLANK/ISNUMBER/ISTEXT/ISNONTEXT/ISLOGICAL/ISREF/N/T/
  TYPE) is EXCLUDED from the null short-circuit — those predicates must SEE the blank (ISBLANK(null)=TRUE).
  Error still short-circuits for all (matches the scalar call-level `argv.find(isSolError)` guard).
- **readInput** (`shared.ts`): `inputs.x?.[0] ?? this.literals.x` let `??` swallow a WIRED null into the
  literal — a blank cell silently became the box number. `readInput(wired, literal)` returns the literal
  ONLY when unwired (`undefined`); a wired value (incl. `null`) wins. Broadcaster arg types widened to
  accept a scalar `null`. Applied to scalar.ts's broadcast-based DATA inputs (Arithmetic/MathFn/Clamp
  value/MRound/RoundN value/GCD/ATAN2-LOG/Hypotenuse). **DATA vs CONFIG:** config inputs (RoundN digits,
  Base from/to, combinatorics n/k, Bessel order) KEEP defaulting — a blank config means "use the default,"
  not "propagate missing." So the remaining data() sweep is per-input judgment, NOT a blind swap; a few
  direct-math scalar nodes (BaseConvert/Combinatorics/Bessel) also need an explicit null guard.
- Tests: `broadcastContract.test.ts` (all four broadcasters + readInput + wired-null-through-Arithmetic),
  `valueKinds.test.ts` (the two helpers). Commits `8b76754` (contract) + `3f9fb8d` (readInput).

### Report + Image live-update fixes (2026-07-04)
Author-reported while testing Reports:
- **Preview jumped on every keystroke:** `InlineRefBody` rebuilds the whole preview DOM via
  `root.innerHTML = bodyHtml` (loses scroll, re-mounts every chart/frame/diagram portal). It fired per
  keystroke AND on every re-render (its `renderEmbed` dep had a fresh identity each render). Fix: the
  preview derives from a 250ms-DEBOUNCED copy of the draft (textarea stays live), and the innerHTML rebuild
  depends on `[bodyHtml]` ONLY (renderEmbed read from a ref). `ReportOverlay.tsx` + `inlineRefDisplay.tsx`.
- **A newly-wired ref (Image) didn't refresh the preview:** `InlineRefValue` read `refValue()` but
  subscribed only to the annotation store. Subscribed it to `cableValueStore` (bumped by every
  `processGraph`), so a recompute refreshes it.
- **Canvas ref row showed "[object Object]" for an image:** `refPreview` had no `isImageValue` case → fell
  to `String(value)`. Added it.
- **Changing an Image's title didn't propagate to a wired Report:** the Image node bakes `this.label` into
  its emitted `ImageValue` (title/alt), and its URL/attachment/height ride the value too — but its edit
  handlers only `scheduleAutosave()`d, never recomputed (the old docstring's "carries no data" was stale).
  Now label/URL commit on blur/Enter, file-attach + height draft-commit immediately, each with
  `processGraph(data.id)`. **The point re: NodeShell:** ordinary nodes get "commit label → processGraph"
  FREE from NodeShell's label field (`nodeKit.tsx` labelField apply calls processGraph); Chart/Mermaid use
  NodeShell so their title renames already propagate. The Image is fully custom (its own header, like
  Note/Group/Report) so it never had that — hence the manual wiring. Doesn't need de-customizing.

### 1.0-tail compute-semantics build pass — STARTED (8/14) + interleaved features (2026-07-04)
Author gave the go on the decision-recorded 1.0-tail queue (`backlog.md` "1.0-TAIL WALKTHROUGH
BOOKMARK"). Regrounded the whole list against code FIRST (an Explore sweep confirmed NONE were
pre-built — the "some are done" turned out to be false). **8 of 14 shipped to develop**, each its own
commit + tests:
- **#4 MRound direction ops** — direction is an op (nearest/up/down = round/ceil/floor of value/multiple,
  toward ±∞ like the .MATH variants), shape is the node. CEILING/FLOOR are catalog entries creating
  MRound pre-set to up/down (multiple defaults 1 → unary); header label tracks the op. MathFn ceil/floor
  DELETED. `nodeExcel` math-floor-ceil → math-ceiling/math-floor. `MRoundOp`/`MROUND_OP_META` in scalar.ts.
- **#5 classic-lookup redirects** — VLOOKUP/HLOOKUP/LOOKUP → #NAME? "Use XLOOKUP", MATCH → "Use XMATCH".
  Registered as internals (`registerInternal`) so they win over Formula.js; the working impls + now-dead
  helpers (flatLookup/approxIndex/lookupLe) deleted; INDEX stays.
- **#6 dates** — DateConstruct numeric year is literal, range 1–9999 else #DOMAIN!; Date.UTC's 0–99→1900s
  remap undone with setUTCFullYear (preserving overflow carry). parseDateToSerial rejects a numeric
  slash/dash date with a 1–3 digit year token ("1/15/26"→NaN→#VALUE!). **Gotcha:** `Date.UTC(26,…)`
  itself remaps to 1926 — build a year-26 reference with `setUTCFullYear`, which does NOT remap.
- **#8 NUMBERVALUE** strict `Number()` full-string parse (not parseFloat greedy); trailing % each ÷100;
  all whitespace incl. embedded stripped. **Gotcha:** `Number("")` is 0 — guard an emptied/all-% string.
- **#10 logical bridge** numsToBools NaN→null (Kleene unknown), not `v!==0`'s TRUE.
- **#11 list UNIQUE** dedupes values (nulls→one) but EVERY error cell survives.
- **#12** deleted the seed-writeback dev scaffolding (devRebuildSeeds.ts + main.tsx import + vite plugin).
- **#13** stale catalog descriptions (divide→#DIV/0!, XMatch→#N/A, FIND/SEARCH→#VALUE!, CHOOSE extensible).

**REMAINING — RESUME HERE (order + risk in backlog's RESUME-HERE marker):** (1) broadcaster per-cell
error/null contract [broadcasters DONE — see the next entry; readInput helper built + applied to
scalar.ts; the list/date/text/finance/dist/stats data() sweep is the open tail]; (2) non-finite
`#OVERFLOW!`/`#DOMAIN!` guard; (3) IFS/SWITCH no-match → #N/A + placeholder; (4) input-default muted
placeholders; (5) numberToText 15 sig-digits; (6) NaN display affordance. (1)+(2) are the risky
foundation (every element-wise node) — do them first, as the RESUME order says.

**Interleaved feature requests (all shipped this session):**
- **Report dock-to-right (desktop)** — a dock button pins the report to a fixed right column between the
  top chrome and footer (both stay put); the canvas area squeezes left. Root class `html.sol-report-docked`
  + `--report-dock-*` vars do the shift: canvas wrapper `width: calc(100% - dock)` carries the minimap /
  socket legend / add-menu; the nav pill + HUD column (viewport-fixed) offset their `right`; the LEFT
  navigator, header and StatusBar are untouched. Docked forces the 2-tab (Draft/Preview) layout; no
  backdrop so the canvas stays live; opening another report replaces it; closing undocks. `reportStore`
  gained `isDocked`/`toggleDock`. Dock geometry (top 66px / bottom 19px) is in vars — nudge if chrome
  heights change.
- **Image node → chart-family output** — `ImageNode` emits an `ImageValue` (`imageValue.ts`: src + height,
  extensible for future transforms) on a `chart` socket, so an image wires into a Report and renders inline
  where its `=name` ref sits (`inlineRefDisplay.tsx` figureFor). The socket lives on the always-visible,
  non-overflow-clipped header bar so it straddles the right edge and survives collapse. **Note:** the
  custom `.solenoid-image` card renders the socket itself via `<NodeSocket>` in a positioning-context row
  (same pattern as NoteNode's FieldRow), with `--node-socket-x: -6.5px` on the card.
- **Note + Image collapse chevron** unified to the standard 10×10 round-capped glyph (they used a 12×12
  square-capped one; Group already matched).


### Fullscreen — F11 (desktop) + mobile pill button (2026-07-04)
- **Rust**: new `toggle_fullscreen` window command (`src-tauri/src/lib.rs`, registered in
  `generate_handler`) — `set_fullscreen(!is_fullscreen())`. Mirrors `open_devtools`/`set_window_border`.
- **F11**: `initFullscreenHotkey` (`src/graph/fullscreen.ts`, called from `main.tsx`) binds F11 →
  invoke the command, **Tauri desktop only** — web desktop keeps Chrome's own native F11, so binding
  there (with preventDefault) would break it.
- **Mobile button**: added to the NavMenu pill (the fit/lock cluster; on mobile the pill hides
  zoom/flourish so it's exactly fit·lock — now fit·lock·fullscreen). Uses the browser Fullscreen API
  (`toggleFullscreen`), Lucide maximize-2 redrawn on the pill's 16-grid / 1.5 stroke. Gated by
  `fullscreenSupported()` (Tauri OR `document.documentElement.requestFullscreen` present) so it hides
  on iOS Safari (no element fullscreen) rather than being a dead key. `showFullscreen = IS_MOBILE &&
  fullscreenSupported()` — desktop never renders it (it has F11). NOTE: Rust half not compiled here
  (no cargo cache; Tauri+Polars build is heavy) — verify on the next desktop build.
- **Icon state (follow-ups):** the mobile fullscreen button swaps glyph by state — Lucide maximize-2
  windowed, minimize-2 fullscreen (tracked via a `fullscreenchange` listener). The expand/collapse-all
  buttons (TopBar pill + Navigator) switched to Lucide **list-chevrons**, and the glyph shows the
  ACTION: converging (down-up) when it will collapse, diverging (up-down) when it will expand —
  replacing the old single-glyph-with-180°-rotation. All redrawn on each button's own 16-grid to match
  sibling stroke weight.

### Canvas regression sweep — minimap, semantic zoom, quick-wire (2026-07-04)
Four author-reported bugs, all root-caused rather than patched-over:
- **Minimap z-order** — `.solenoid-minimap` had no `z-index` (auto/0), so positioned node cards
  painted later in DOM order rendered over it. Its sibling `.solenoid-legend` uses `z-index: 100`
  and is never covered; matched it. (`Minimap.css`)
- **Minimap jumpy under drag** — `rete-minimap-plugin` fires `render()` SYNCHRONOUSLY on every
  translated/zoomed/nodetranslated event. During a continuous drag those arrive in bursts not
  aligned to paint frames, each re-reading layout (our `collapsedAwareNodesRect` touches
  `offsetWidth/Height` for collapsed groups) and re-normalizing every node against a bounding box
  that shifts as the dragged node moves → per-event jitter. rAF-coalesced its `render` to ≤1 per
  frame (guarded by the effect's `destroyed` flag so a pending frame can't fire into a torn-down
  area). (`Canvas.tsx`, at the `getNodesRect` override.)
- **Semantic zoom did nothing** — `syncSemanticZoomFor` gated on `computeIdealMipLevel(scale·dpr) ≥ 4`,
  i.e. `scale·dpr ≤ 1/16`: only fired below ~6% zoom on dpr-1 and ~3% on a dpr-2 laptop — so far out
  the node body is already sub-pixel and hiding it (`.solenoid-node__body { visibility: hidden }`) is
  imperceptible. Also folded dpr in, so it triggered at a *different apparent zoom* per display.
  Rewrote to gate on the RAW CSS scale (`SEMANTIC_ZOOM_SCALE = 0.3`, dpr-independent): a card drawn
  at ≤~30% has unreadable body text but is still a clear block — conservative (far-overview only) but
  actually reachable and visible. Dropped the now-unused `computeIdealMipLevel` import. **Gotcha for
  next time:** semantic zoom is an APPARENT-size concept — never gate it on anything containing `dpr`
  (that's a texture-resolution concern owned by the mip renderer). **Second half of the feature (the
  original intent — Sonnet had only built the hide):** the hidden body is now REPLACED by a legible
  stand-in. `NodeShell` renders a `.solenoid-node__semantic` overlay (the node name, large + centered,
  transparent so socket dots show, `pointer-events:none`, `-webkit-line-clamp:3`), shown only under
  the `html.solenoid-semantic-zoom` class. So a far-zoom card reads as an identifiable named block
  instead of a blank rectangle. Group/Note cards keep their own content (they're already labeled
  blocks); this is standard-node-only. Note: it's a DOM-renderer feature — the HTML-in-canvas renderer
  draws cached bitmaps, so it wouldn't reflect the class toggle without a recapture (pre-existing).
- **Quick-wire ignored the drop location** — the new node landed near the ORIGIN socket, not where
  the cable was released. Cause: `screenMouseRef` tracked `mousemove` ONLY, but rete-area-plugin's
  `Drag.move` calls `e.preventDefault()` on pointermove (area plugin, line ~193), which SUPPRESSES
  the compatibility mousemove events for the duration of any drag — so the ref froze at the drag's
  start point (near the origin), and both the quick-wire menu and the created node used that stale
  point. Fix: also track `pointermove` (it keeps firing through the drag; `preventDefault` stops
  default actions, not other listeners). **Gotcha:** any cursor-position ref used at the END of a
  drag must be fed by pointermove, not mousemove. **Side-aware placement (follow-up):** the drop
  point should meet the new node's WIRED socket. Dragging from an output → downstream node, its INPUT
  (left edge) at the drop (top-left placement, unchanged). Dragging from an input → upstream node, its
  OUTPUT (right edge) at the drop → shift left by the card width. Width isn't known until the card
  renders, so measure `element.offsetWidth` if already laid out (no jump), else place naive and nudge
  left on the next rAF. (`handleMenuSelect` in `Canvas.tsx`.)
- **Dropped the ENTIRE pan-time quality/paint-cut system** (`canvas.css` + `Canvas.tsx`). First just
  the AA reduction, then (author) all of it: the `.solenoid-canvas--panning` rules (flow-bead pause,
  box-shadow drop, conduit drop-shadow + toolbar backdrop-filter removal, AA) are gone and the class
  is no longer applied — `onPanStart/onPanEnd` keep only the `fpsProbe` bracket. Rationale: the
  HTML-in-canvas renderer is the performance path when a graph is heavy; DOM mode no longer trades
  fidelity for pan smoothness. Flow beads now keep animating through a pan (they used to freeze —
  that's the intended behavior now, not a regression).
- **Quick-wire menu: gray out incompatible nodes in the FULL Add menu instead of a flat filtered
  list.** Before, dropping a cable opened the menu narrowed to a flat list of compatible leaves (no
  categories) — lost the familiar layout. Now it opens the SAME catalog tree as a normal add and
  passes a `compatibleTypes: Set<string>`; `AddNodeMenu` grays + disables (`--incompatible`) every
  leaf not in the set, in both the tree and search views. One `select()` gate ignores dimmed leaves
  so neither click nor keyboard can pick them. `filterByCompatibleSocket` still does the live-socket
  compatibility test (instantiate each leaf, check `canConnectTo`); it just feeds a type-set now
  rather than replacing the entries. Menu still only opens if ≥1 node is compatible.

### Top-bar control-size consistency + navigator bottom clearance (2026-07-04)
- **Desktop + mobile:** the `.solenoid-topbar__group` pill had `padding: 3px`, making it 36px tall
  while the apptools pill (no padding) is 30px and buttons are 28px (DESIGN.md's standard) — so it
  read as a bigger control. Dropped the padding → 30px, so every top-bar pill is one size. On
  mobile the surfaced layout-group buttons were 32px vs the apptools' 34px; bumped to 34 so all Row
  B controls are 34px buttons / 36px pills. (This is about total SIZE, not corner radius — both
  families already use 50% / 999px.)
- **Navigator overflowed the bottom bar on-device (vh vs dvh, THE real cause).** `.solenoid-app`
  (the outline's absolute containing block) was `height: 100vh` — the LAYOUT viewport, which
  includes the strip behind the mobile URL bar. The bottom action bar is `position: fixed;
  bottom: 0` → anchored to the VISUAL viewport bottom. So the outline (anchored to the 100vh
  bottom) sat *below* the fixed bar by exactly the URL-bar height, overflowing it on ANY doc.
  A URL-bar-less emulator has vh == dvh, so it never reproduced (chased a red-herring FAB-margin
  bump first). Fix: `html.is-mobile .solenoid-app { height: 100dvh }` so the container tracks the
  visual viewport, matching the fixed bar. The outline's own `bottom` is 84px (clears the bar + the
  raised + FAB, which sticks ~8px proud with a shadow). Lesson: any absolute overlay meant to sit
  above a `position: fixed` mobile bar must anchor to a `dvh`-sized box, or it drifts by the URL bar.

### Mobile chrome redesign — two-row top, roles split by zone (2026-07-04, SUPERSEDES the accent-app-bar notes below)
Reorganized mobile chrome to mirror desktop's separation of concerns, into three zones:
- **Top = TWO rows.** Row A is the **menu bar** repurposed as a thin ACCENT strip carrying ONLY
  the document name + caret (centered); it also carries the notch/safe-area inset. Row B is the
  **app bar** as a NEUTRAL tools row: app-menu icon (☰ → the hamburger sheet) + Navigator toggle
  on the left, accent/theme pill + Reference + Settings on the right. This kills the washed-out
  accent-button problem entirely — the accent row has no buttons, and Row B uses normal chrome
  styling. The separator is Row B's mode-keyed bottom border.
- **Bottom bar = edit/select.** Command palette (icon swapped ⌘→ Obsidian-style `>_` terminal) ·
  Undo · Redo · ⊕ Add · Select · Delete · **Group** (new — replaces Fit; fires the same `KeyG`
  shortcut Canvas handles, like undo/redo dispatch it, so no editor plumbing in MobileControls).
- **Floating pill = canvas view.** Zoom in/out dropped (pinch does it); now just **Fit + Lock**,
  upper-right below the two-row top.
- New: `toggleChrome(key)` in chromeToggle.ts (targeted single-panel toggle) drives the Navigator
  button. NavMenu zoom buttons got `--zoomin`/`--zoomout` classes so mobile can hide them.
- **Gotcha:** `.solenoid-menubar__center` (the doctitle slot) is `position: absolute` on desktop
  (absolutely centered). Reusing it as Row A's in-flow content required overriding to
  `position: static` — else it's out of flow and the menu bar collapses to height 0 (the accent
  row vanished; caught via a computed-style probe under mobile emulation). The doctitle's default
  name/caret color is already `--accent-ink`, so it reads on the accent row with no override.
- Sheet/panel offsets updated for the taller top chrome: hamburger sheet `top: 74px + safe-area`
  (below both rows), outline panel `top: 80px + safe-area`, floating pill `top: 84px + safe-area`.
- Verified in mobile-emulated Chromium (both themes): two rows render, Navigator toggles the
  outline, the sheet opens at y=74, Group creates a group (6→7), Fit/Lock present, `>_` bottom-left.
- **Follow-up polish (2026-07-04):** Row B is OPAQUE (`--surface`, not the translucent
  `--panel-bg`) so the canvas never bleeds through; doc title LEFT-aligned; Navigator reuses the
  desktop panel-left glyph; the layout GROUP (Tidy/Cleanup/collapse-all/snap — tagged
  `__group--layout`) is surfaced on Row B (file ops stay in the sheet via `__group--file`);
  gaps tightened (topbar 4px, apptools/pill 2px); apptools stroke 2.6→2.0 (2.6 was extra-thick at
  14px); Fit/Lock pill trimmed (30px buttons, scoped `.solenoid-nav .solenoid-nav__btn` so the
  Row B layout buttons keep their own 32px). Row B **height 52px** (up from the desktop 44px) so
  the separator reads as a bar not a tint and the buttons center cleanly; the **separator is the
  DESKTOP accent underline** again (hairline + `box-shadow: 0 2px 0 0 var(--accent)`, from the base
  rule — no mobile override) now that Row B is neutral, which also brackets the tools row with
  accent (Row A above, underline below). Sheet/outline/pill offsets rebumped to 82/88/92px. **Android status bar** now tints to the accent via a
  dynamic `<meta name="theme-color">` written in `appTheme.apply()` (bottom system nav bar isn't
  web-controllable in a normal tab — only an installed PWA follows the page). **Command palette
  input** got `autoComplete/autoCorrect/autoCapitalize=off` + `inputMode=search` + `data-1p-ignore`
  so Android/iOS stop offering password/card/address autofill on a plain search box.

### Mobile app bar is accent-based (2026-07-04)
- On mobile the single top bar (`.solenoid-topbar`) now uses the ACCENT as its base color
  (like the desktop menu-bar row), not `--panel-bg`. The whole treatment rides `--accent-ink`
  — the accent's auto-computed contrast color (`contrastInk`, white on a dark accent, near-
  black on a light one) — so it reads correctly for ANY accent in BOTH light and dark with a
  single rule set (no mode-specific branches). Chrome vocabulary mirrors the accent MenuBar:
  ink-wash button fills (`color-mix(var(--accent-ink) 12–24%, transparent)`), ink borders,
  accent-ink icon/text, ink-wash press states. Covered: the app-menu icon button + its glyph,
  the doc title name/caret, and the apptools cluster (paint pill, Reference, Settings) + the
  accent-swatch dot's ring. The doc-rename input stays a surface pill (legible as-is on accent).
- **Buttons are GHOST** (revised — the first pass used a low-opacity ink FILL that read as
  washed-out): transparent at rest, just the accent-ink glyph, a soft ink wash only on `:active`
  (matches the desktop accent MenuBar). Covers the app-menu icon + the apptools cluster; the
  base `:hover` (which flips to the accent, invisible on an accent bar, and lingers on touch) is
  neutralized to the ghost state.
- **Separator to the canvas is MODE-KEYED + 2px** (revised — an accent-ink hairline was too
  faint, and 1px too thin vs the desktop bar's 2px accent underline). The edge must contrast the
  CANVAS, whose lightness tracks the THEME, not the accent — so: light mode → `rgba(0,0,0,0.32)`
  2px line + soft shadow; dark mode (`&[data-theme="dark"] .solenoid-topbar`) →
  `rgba(255,255,255,0.2)` 2px line + a deeper shadow. The notch/safe-area inset is filled by the
  accent (padding-top on the bar), matching the desktop accent MenuBar's notch behavior.
- **Icon stroke thickened to match the touch bar** (revised): the apptools glyphs are authored at
  14px / stroke 1.4 (~0.82px effective — fine for the small desktop bar) but read half as thick as
  the bottom bar / overlay pills. Mobile-only override `.solenoid-apptools__btn svg { stroke-width:
  2.6 }` (CSS wins over the SVG attribute) lands ~1.5px WITHOUT enlarging the glyphs — they stay at
  14px (an earlier pass scaled them to 20px too, which was too big). The app-menu mark is a masked
  logo, not a stroked icon, so it's left alone.

### Mobile select-mode: pinch/pan/lasso + the off-canvas-tap selection wipe (2026-07-04, root-caused with browser automation)
- **Root causes (verified by driving a mobile-emulated Chromium via CDP, not by reading):**
  1. rete's Zoom handler (`rete-area-plugin`) pinch-zooms only when it has ≥2 pointers, and it
     collects them from CONTAINER pointerdowns. The lasso `stopPropagation`'d finger 1 (capture
     phase), so the Zoom handler never saw it → a second finger gave it only 1 pointer → no
     zoom. rete's Drag (1-finger pan) is the OTHER half: it's what fought the lasso.
  2. rete's `selectableNodes` clears the whole selection on a **window-level** pointerup while
     its `twitch` counter (armed on a CONTAINER pointerdown, `<4` moves = a "tap") is still set.
     An OFF-canvas tap — a mobile-bar button — fires a window pointerup but no container
     pointerdown, so `twitch` stays armed from the earlier canvas tap-select and the tap wipes
     the selection. That's why tapping **Delete** deselected-and-did-nothing (`deleteSelected`
     then found nothing, and its `processGraph` refreshed the stale `--selected` class), and why
     deactivating select mode "cleared" (the deactivate button tap is off-canvas too).
- **Fixes:** (a) 1 finger = lasso, 2 = pinch/pan. In mobile select mode the lasso NO LONGER
  stopPropagations (so the Zoom handler sees both fingers); instead rete's Drag handler is
  disabled for the duration (`area.area.setDragHandler(null)` on select-mode-on, `new Drag()`
  off — `Drag` is exported). A second finger still cancels the in-flight lasso (`cancelLasso`).
  Desktop shift-lasso keeps its stopPropagation (drag stays enabled there). (b) The area pipe
  swallows a `pointerup` whose gesture started OFF-canvas (`tapOnCanvasRef`, set in the
  window-capture pointer tracker from `containerRef.contains(target)`), so off-canvas taps can
  never reach `selectableNodes`' clear. This fixes BOTH the Delete wipe and deactivate-keeps.
- Mobile Delete button no longer hard-`disabled` on the 200ms selection poll (a quick tap read
  as dead); always tappable, dimmed via `.solenoid-mobile-bar__btn--dim`; `deleteSelected()`
  no-ops if empty. **Gotcha for future testing:** Playwright mobile emulation (hasTouch +
  isMobile + iPhone UA) faithfully reproduces IS_MOBILE and the coarse pointer; CDP
  `Input.dispatchTouchEvent` with 2 touchPoints drives real pinch/pan. The DOM `--selected`
  class LAGS `node.selected` until the next area.update — read real state after a re-render.

### Mermaid diagrams use the app palette (2026-07-04)
- Mermaid rendered in its stock blue/purple, ignoring our theme. Switched `MermaidView`
  from `theme: "dark"|"default"` to `theme: "base"` + a `themeVariables` object built at
  render time from the live CSS vars the rest of the chrome reads (`--surface`, `--surface-sunken`,
  `--text`, `--text-muted`, `--border`, `--accent`) plus the palette's 12-way categorical set
  (`resolveColor(slot)` → `themeAccent`) mapped onto `pie1..pie12` for pie/series diagrams.
  Nodes get a surface fill + accent border, edges a muted line — unmistakably our palette.
  Over-specifying `themeVariables` is safe (mermaid ignores ones a diagram type doesn't use).
- Two gotchas fixed along the way: (1) the re-init on a theme change was **fire-and-forget**
  (`void promise.then(mm => mm.initialize(...))`) — not awaited before `render()`, so a theme
  switch could render with the old config; now `loadMermaid(config)` returns a promise that
  resolves AFTER `initialize` (synchronous). (2) The render effect keyed on `mode` alone, so a
  palette switch (mode unchanged) wouldn't re-run it — now it keys on the `appThemeStore`
  version tick, which bumps on mode/accent/palette alike (palette changes notify appTheme,
  appTheme.ts:65). No chart-options socket for Mermaid — author's call, keep it simple.

### Note = SOURCE, Report = SINK — made opposites, not convertible (2026-07-04)
- The Note had grown two-sided: frontmatter YAML → typed OUTPUT sockets AND `` `=name` ``
  inline refs → `any` INPUT sockets. That put an input strip right above the output strip
  (with its type-switch glyphs) — confusing — and the Note's ref inputs didn't even accept
  wires cleanly. Author's call: make the two nodes deliberate opposites. **Note is now
  output-only** (frontmatter fields; it no longer parses `` `=name` `` or mints inputs — a
  `` `=name` `` span is just literal inline code, body renders as plain markdown). **Report
  stays input-only** (`` `=name` `` refs + `![[Note]]` embeds, no outputs). Not convertible
  (they're opposite directions). Removed from `NoteNode`: `extractInlineRefs`, `_refKeys`/
  `_refValues`, `refKeys()`/`refValue()`, the input half of `syncFields` (+ its `removedInputs`
  return), and `data(inputs)` → `data()`. NoteNode.tsx drops the refs strip + `InlineRefBody`
  (renders sanitized markdown via `dangerouslySetInnerHTML` — no portals now, so it's safe).
  `reportExport.ts` renders an embedded Note's markdown as-is (no ref-freeze). `noteInlineRefs.ts`
  + `inlineRefDisplay.tsx` stay — Report still uses them.
- **Socket dots landed a couple px too far inside on both cards.** Their strip rows sit inside
  the card's **2px** border, so the `-5` default (calibrated for a normal node's 1px inset,
  which uses `-6.5px`) pulled the dot too little. Fix: `--node-socket-x: -7.5px` on
  `.solenoid-note` and `.solenoid-report` (= `-6.5` − 1px for the extra border), so the dot
  centers ~0.5px inside the OUTER edge, matching every other node.

### Presentation steps persist across reload (node-id remap) (2026-07-04)
- **The Presentation node "stopped working after reload."** A step carries a node-id SET
  (the camera target), stored as live rete ids on the instance. The `steps` array itself
  round-tripped fine (it's in `INIT_FIELD_ORDER`, JSON-serializable), but its `nodeIds` were
  never translated at the two addressable boundaries the way group `members` / FC
  `hostNodeId` are — so after a reload every id inside a step was a stale rete id matching no
  live node, and `flyToNodes` flew nowhere. Fix mirrors `members` exactly: `writeTextForm`
  translates step `nodeIds` id→name (so they become addressable and match saved node ids),
  `rebuildGraph` remaps them name→fresh-id (dropping vanished nodes), and `pasteClipboard`
  remaps them through `oldToNew`. Lesson: ANY node field that references OTHER nodes' ids
  needs handling at BOTH the text-form boundary (id↔name) AND the rebuild/paste boundary
  (id→id) — capturing the field in `extractInit` alone isn't enough, the ids inside it rot.

### Two crash/data-integrity fixes: Display-on-object, and cable-drag committing text (2026-07-04)
- **Display node crashed the canvas on a Chart/Mermaid/lambda input.** `DisplayComponent`
  routed any value that wasn't error/frame/cube/table to `ValueDisplay`'s number formatter
  (`fmt` → `formatWithUnit` → `.toFixed`). An OBJECT value (a `ChartValue` etc.) threw
  "toFixed is not a function" DURING React render — which unmounted the Display node AND,
  because it threw inside the shared rete React root, broke rendering for OTHER nodes on the
  canvas (a sibling wired Text→Mermaid then showed nothing — two reported symptoms, one
  cause). Fix: `DisplayComponent` now branches on chart/mermaid/lambda like frame/cube/table
  (renders the figure / signature); `fmt` also guards non-numbers. Lesson: a throw in ANY
  node component during render corrupts the whole rete React root — every value box must be
  crash-proof against an unexpected kind.
- **A cable drag now commits the focused text field first** (`Canvas` `connectionpick` →
  `document.activeElement.blur()`). The multi-line Text field commits on blur (Enter inserts
  a newline), but a socket's pointerdown starts the drag and `preventDefault`s the focus
  change, so the field never blurred — wiring it delivered the STALE (empty) value (an empty
  Mermaid source → a blank diagram, no error). General fix: any mid-edit field reflects what
  you see when you wire it.

### Session polish batch — report/chart/note/popup (2026-07-03/04)
Small, verified fixes, grouped: charts + Mermaid figures are `user-select: none` (a drag no
longer grabs recharts/mermaid SVG text as several partial highlights); the value popup
overlay z-index went 300→9500 so a frame chip opened INSIDE a full-screen overlay (Report /
Composite / Reference, all 9000) lands ON TOP, not behind — and Frame/Array/Cube chips fall
back to their TYPE colour for the header when opened with no node context; a Report chart is
sized to its container (ResizeObserver, cap 640) instead of a fixed 360 that scrolled a
narrow report; a Note's first heading/para no longer floats below a phantom blank line
(`InlineRefBody` wraps content in a bare `<div>`, so the `> :first-child` margin reset had to
reach `> * > :first-child`); markdown emphasis with `*` now renders italic app-wide — the
Atkinson variable font ships only an upright axis and `font-synthesis: none` (App.css,
deliberate no-faux-bold) ALSO barred synthetic italic, so the real `wght-italic` face is now
imported in `main.tsx` (this also repairs the FC italic-text option). Seeds use `*` for
emphasis, not `_`.

### Presenter mode — the Presentation node actually presents now (2026-07-04)
The Presentation node's steps only flew the camera to a node set, but the controls
lived on the node card — which flew off-screen on the first step, making it useless.
Added a real full-screen presenter: a "▶ Present" button starts it (`presentationStore`,
a singleton like reportStore), and `PresentationOverlay` (mounted in App) runs the
slideshow. It **hides the app chrome** (toggles `html.solenoid-presenting`, which CSS
`display:none`s header / nav / statusbar / outline / legend / minimap / mobile bar /
HUD — restored on exit/unmount), flies the camera to each step's nodes, and drives
navigation: click anywhere or Space/→/↓/PageDown/Enter advance, ←/↑/PageUp step back,
Home/End jump to ends, Esc exits. The canvas IS the slide; the overlay is a transparent
click-catcher with a bottom-center control bar (‹ · title/counter · › · ✕) that
stopPropagations so its buttons don't also advance. Verified live end to end.

### Text node is multi-line; Mermaid template dropdown (2026-07-04)
- **Text node scales + preserves newlines.** `QuotedTextInput`'s `value` variant was a
  single-line `<input type="text">` — which strips newlines on paste and grows
  horizontally off the card via `size={draft.length}`. Split into `QuotedInlineInput`
  (unchanged single-line, for the per-row inline literals) and `QuotedValueTextarea`
  (a `<textarea>` that auto-grows to content, caps at 200px then scrolls, wraps long
  lines, commits on blur / reverts on Escape / Enter = newline). This ALSO fixes the
  reported bug: pasting multi-line Mermaid into a Text node and wiring it as `source`
  produced a diagram error because the `<input>` had flattened the newlines to one line
  (Mermaid needs statement breaks). Dropped the field resize grip — auto-grow replaces it.
- **Mermaid template dropdown.** `MermaidNode.tsx` `MERMAID_TEMPLATES` (Flowchart /
  Sequence / Class / State / ER / Gantt / Pie / Mindmap / Journey / Git) — a
  `<select>` above the source (hidden when the source socket is wired) drops a minimal
  valid skeleton of that diagram type in, so you start from a working shape. Verified
  live: pick → source set → renders.

### Report embeds: taller scrollable tables + collapsible (2026-07-04)
Two Report-embed asks. (1) An inline frame ref (`=table`) was capped at the node
hero box's 3 rows; a document can afford more. `FrameDisplay` gained `previewRows`/
`previewCols`/`scroll` props — the Report renders up to 25 rows / 12 cols in a
`max-height:260 overflow:auto` box (keeps the chip → full popup). A Note card still
gets the compact 3×3. (2) Every Report embed folds under a titled bar: new
`CollapsibleFigure` (`inlineRefDisplay.tsx`) wraps chart/table/diagram/cube refs AND
`![[note]]` embeds. Threaded via `InlineRefBody`'s `collapsibleEmbeds` flag →
`InlineRefValue`'s `collapsible` (Report passes it, Note doesn't). Figure branches were
refactored into a `figureFor()` descriptor (`{title, caption, body}`) so the same body
renders either captioned-inline (Note) or under a collapse bar (Report); `ChartBody`
is the caption-less measured plot. The embedded note renders BARE (no own header —
the bar's title is the note name). Portaled into inline `=name` slots so it's all
span-based but `display:block`. Verified live: 10-row scrollable table + note both
fold/unfold.

### Composite boundary values render by kind (frame/cube/chart/lambda) (2026-07-04)
Closed the documented gap: a Composite output port (and the drill-in's input/output
boundary markers) bound to a FRAME or CUBE stringified as `[object Object]` through
`ValueDisplay`. New `CompositeBoundaryValue` (`CompositeNode.tsx`) branches on kind —
frame/cube → the compact `FrameDisplay`/`CubeDisplay` table preview, chart/mermaid →
its figure, lambda → `formatLambda`, everything else → the hero `ValueDisplay` box.
Output markers materialize through `coerceInputs` (internal editor has it installed),
so `cachedOutputs` holds a real `FrameValue`, not a lazy ref — `FrameDisplay` renders
it directly. Verified live: a FrameInput→output-marker composite shows the City/Pop
table on its card. This makes frame-transforming composites (Join/Group By → frame
out) actually usable, which is the relational north-star's reuse story.

### Composite editor — unpack crash, vertical output stack, full-bleed multi-layer drill-in (2026-07-04)
- **Unpack crash fixed.** After the drill-in editor had been OPENED, unpack threw
  `Error("node")` from rete-history-plugin. Opening the drill-in attaches a History
  plugin to the composite's internal editor, but the internal nodes predate it
  (hydrated at collapse/load), so it never `nodecreated`-tracked them — and
  `trackNodes` throws on `noderemoved` for any node it didn't see created. Unpack was
  calling `internalEditor.removeNode` per node → crash. Fix: unpack no longer mutates
  the internal editor at all — it moves the shared node INSTANCES onto the outer
  editor and lets the whole internal editor (plugin included) be discarded with the
  composite (`compositeLogic.ts`).
- **Composite output rows stack vertically** (label above its hero ValueDisplay box).
  A full-height box beside a label in the 22px io-row got pushed off the card; now the
  measured row wraps only the box (`.solenoid-composite__output`, `nodeCard.css`).
- **Drill-in is now full-bleed + multi-layer with a breadcrumb.** `compositeEditorStore`
  is a BREADCRUMB STACK of `CompositeNode` instances (not one id): entry 0 is a
  main-canvas composite, each deeper entry a composite nested in the previous one's
  internal graph. The overlay layers full-bleed over the canvas (opaque, no
  bleed-through) with a top-left `Canvas ▸ A ▸ B` trail (Cube-popup pattern) — a
  composite card inside drills deeper (`drillInto`), a crumb/Esc drills up (`backTo`).
  The stack gives recompute + reconcile for free: edits at any depth retarget
  `stack[0]` (the main-editor ancestor) via `processGraph`; a level reconciles its
  ports against `stack[i-1].internalEditor` (its parent) on leave. NOT yet done: the
  user's ask to reroute the REAL app top toolbar / mobile bottom bar to the active
  subgraph — the drill-in keeps its own header toolbar for now (a follow-up).

### Mermaid node + lambda→KaTeX in Reports; the "figures are node outputs" standing rule (2026-07-03)
Two Report-adjacent additions, both built on the SAME principle the author set here as a
**standing rule**: *rich visual/typeset content is produced by a NODE and flows as a
chart-family value through the green `chart` "Special" socket, embedding into a Report like
any chart. A Report stays plain text + embeds and is NEVER made first-class for a content
type.* So neither of these widened the Report's markdown parser.

- **Lambda → KaTeX.** A LAMBDA value wired into a Report/Note inline ref now typesets as a
  centered equation `f(params) = body` via `katex` + `formulaToLatex` (the formula-field
  path), falling back to plain `λ(x) = expr` when the body doesn't parse. Carried the source
  body on the lambda VALUE (`LambdaValue.expr`) so the consumer renders it without reaching
  back into the graph — the one `__lambda: true` construction site sets it. Rendered in
  `inlineRefDisplay.tsx` (`LambdaFormula` + the `refPreview` text form).
- **Mermaid node** (`mermaid` dep, v11; `nodes/visual.ts` `MermaidNode`). Source text in
  (typed on the card or wired via the `source` socket) → a `MermaidValue`
  (`mermaidValue.ts`, a sibling brand to `ChartValue`) out the `chart` socket. Renders via
  `MermaidView.tsx`, which **dynamically imports** mermaid (heavy — d3/dagre) only when a
  diagram is on screen, keeping it off the main bundle. Theme-aware (mermaid `dark`/`default`
  re-init on `appThemeStore` flip); `mermaid.parse` first so a syntax error is our own quiet
  "Diagram error", not mermaid's injected red graphic. Registered everywhere the Chart node
  is (catalog "Visuals", `nodeRegistry`, `kind` display+wide, `components/index`). Persists
  free via `stringLiterals.source`. Static HTML export picks up the card SVG through the
  existing `captureChartSvgs` (visual-node SVG capture) — same path charts use. Verified live:
  the flowchart renders on the card AND inline in a Report, green cable = chart socket.
- **`report-showcase.json` upgraded to a complete Report demo.** Now exercises EVERY distinct
  inline render path in one narrative: a scalar (`=total`), an inline frame table (`=table`),
  a chart figure (`=fig`), a lambda→KaTeX equation (`=model`, `f(t)=base·(1+growth)^t`), a
  Mermaid diagram (`=flow`), and a note embed (`![[Methodology]]`). Rewired frame-first
  (FrameInput → Get Column → Chart/Aggregate) so it also demos the real table→column pipeline,
  not a bare ListInput. `reportShowcaseSeed.test.ts` asserts each path resolves to the right
  value kind. Keep this seed's "one of every render path" property when the Report changes.

### Bundle 05 (units) — dimensional-algebra foundation landed (2026-07-03)
Started the flagship units bundle. Only the parts NOT gated on the FC function-model truth
table (which the author will red-line later): Phase C was already fixed (the `dockSelf`
rebuild guard is present), and Phase D's **core** is built. `dimension.ts` models a unit as
an exponent vector over base dims (SI seven + angle/currency/information) plus a linear SI
scale and an affine offset (temperature). Full algebra + commensurability + conversion +
a unit-expression parser (`m/s`, `kg*m/s^2`, `m2`, prefix `km`/`ms`) + derived-unit
formatting (N/J/W/Pa/Hz). `#UNIT!` error added (right type, wrong DIMENSION — distinct from
`#TYPE!`). Made it load-bearing immediately: the **Convert node** now delegates its math to
`dimension.ts` — each unit's SI scale = its factor × its category base's SI scale (mass base
gram = 0.001 kg, volume base litre = 0.001 m³, etc.), temperatures carry an affine `dim`
unit, and cross-family is now a real commensurability check (m² vs m). All 22 original
convert assertions still pass — the regression net proving the core matches the node's
long-tested factors.
**Deliberately NOT built (gated on Phase A / the truth table):** units in the VALUE model
(author's call: **tagged cells** for lists — a list is a row, mixed units must be
representable — per-column for frames), deleting `unitFlow.ts` and re-expressing the FC
lock/carry/break on the new layer, the Expression/LAMBDA dimensional interpretation, and the
aggregator/socket-lattice pass. Those consume the core; do them after sign-off. See
`docs/v2.0/05-units-format-controller.md`'s PROGRESS header.

### Report upgrade — charts inline, embeds as tokens, and the inline-ref rendering bug (2026-07-03)
Author: "the Report needs a big upgrade — sockets don't work at all; it's the main
destination for charts; embed-note is really bad (no placement control)."

- **Inline refs never rendered their value** (the root of "sockets don't work"). Two
  separate bugs stacked:
  - The overlay's draft-reset effect listed `node.body` in its deps; `onBody` writes
    `node.body` per keystroke for autosave, so every keystroke re-ran the effect and
    reset `lastSyncRef`, making `commitBody`'s change-guard always short-circuit — so
    `syncRefs()` never ran and the `=name` INPUT sockets were never minted. Fix: key
    the reset effect on `nodeId` only.
  - `InlineRefBody` set the rendered HTML via `dangerouslySetInnerHTML`, then the
    code→value swap mutated that React-owned DOM; the `setSlots` re-render re-applied
    the prop, restored the raw `<code>=name</code>`, and orphaned the value portals.
    Net: NO ref (Note OR Report) ever showed its wired value. Fix: set `innerHTML`
    IMPERATIVELY in the layout effect so React never owns/re-stomps those children.
    **General rule: never portal-swap into DOM that a `dangerouslySetInnerHTML` prop
    controls — set it imperatively, or React wipes the mutation on the next render.**
- **Charts are a first-class value now.** The `chart` socket already existed as an
  identity-only object socket alongside `lambda` (sockets.ts, machine-checked in
  socketConnect.test.ts) — only the node wiring was missing. `ChartNode` emits a
  `ChartValue` (`chartValue.ts`: `{__chart, op, values, options, title}`) on a real
  `chart` output, REPLACING its unused numlist pass-through (a chart is terminal — no
  seed consumed it). Wire Chart → a Report `` `=fig` `` ref and the actual styled chart
  draws inline where the ref sits (reuses `ChartView`/`toSeries`). The chart socket got
  its own 3-bar glyph on the node (SocketComponent) and in the Socket Legend, distinct
  like lambda's λ.
- **Embeds are inline markdown tokens.** `![[Note Name]]` (Obsidian-style) places the
  named Note's block exactly where the token sits, replacing the fixed bottom strip
  (`reportEmbeds.ts`: `preprocessEmbeds` → a `data-embed` marker span before markdown;
  `InlineRefBody` portals the embed block into each marker via an opt-in `renderEmbed`).
  The "Embed a Note" button inserts a token at the caret; `node.embeds` is re-synced
  from the body's tokens on commit (the export reads it); the static export inlines each
  embed where its token sits too (splits the frozen body at the token). A token naming
  no live note shows a quiet inline hint.
- **Report Showcase seed** (`report-showcase.json` + `reportShowcaseSeed.test.ts`): a
  scalar ref (=total=113), a chart ref (=fig column chart), and an embed
  (![[Methodology]]) — all three paths in one document, asserted headlessly. Verified
  in-browser end to end.

### Follow-up UX pass — where-used pill, palette selection, mobile palette (2026-07-03)
Author follow-ups off the live deploy:

- **Cable Inspector collapse**: the X now folds the panel to a 34px chip in the same
  corner (drawn with the shared `CableShapeIcon`, extracted from CableShapeSelector's
  segmented control) instead of deselecting — the selection is untouched; click to
  unfold. Collapse state is sticky across cable picks.
- **Footer clearance audit**: bottom-anchored overlays must clear the 19px StatusBar on
  desktop AND the ~74px bottom action bar on mobile (`html.is-mobile` lift to
  `calc(96px + env(safe-area-inset-bottom))`, the docked-conduit-toolbar precedent).
  Fixed NoticeToasts (was 16px — under the desktop footer, behind the mobile bar) and
  gave the Cable Inspector its mobile lift. Verified clear: command palette (desktop
  40px; mobile is top-anchored), minimap (30px, hidden on mobile), socket legend,
  docked conduit toolbar, HudStack/IsolatePill (top-anchored).

- **Where used vs Isolate chain**: functionally distinct (downstream-only closure vs the
  bidirectional chain), but the shared isolate/dim visual made them read as duplicates —
  especially when right-clicking a source node, where the sets coincide. `isolateStore.set`
  now takes a mode label; the IsolatePill shows "Where used · N downstream" vs
  "Isolated · N nodes", and both context-menu items carry direction tooltips.
- **Command palette selection model**: it opened with row 0 pre-highlighted AND
  `onMouseEnter` let the browser's synthetic mouseover (fired when the list mounts under a
  parked pointer) move that highlight — so blind Enter-Enter ran a pointer-position-dependent
  action. Two fixes: the EMPTY-query palette now opens with NO active row (Enter is a no-op
  until you type/arrow/really-move-the-mouse; typing still auto-selects the top result so
  type→Enter stays one motion), and rows highlight on `onMouseMove` (real movement), never
  `onMouseEnter`. **The mount-under-cursor mouseenter trap applies to any future
  list-under-a-hotkey UI.**
- **Command palette is first-class on mobile**: palette open/close moved from Canvas
  useState to `paletteStore` (module toggle store) so the mobile bottom bar can drive it;
  the bar's Search button became the ⌘ Commands button (the palette's typed search jumps to
  nodes, subsuming it). `html.is-mobile` CSS anchors the palette to the TOP with the input
  first — the on-screen keyboard owns the bottom half — with touch-sized rows and shortcut
  hints hidden.

### v2.0 build regression sweep + the Composite drill-in editor (2026-07-03)
The "stronger review pass" the backlog asked for — six parallel review agents over every
unwalked v2.0 bundle plus root-cause work on the author-reported breakage. Fixes:

- **Expect/Tornado missing input sockets.** Same failure class as Write CSV/JSON (f988db8):
  the node CLASS declares `addInput(...)`, but the custom component never renders a socket for
  it — and NodeShell only auto-renders OUTPUTS, so a forgotten input is simply invisible. Expect
  additionally hid its min/max/pattern rows when their checkbox was off, which strands a wired
  cable; the rows now stay while connected (`useConnectedInputs`). **When adding a node with a
  custom component, every `addInput` needs a matching render** (`InlineInputs` keys / `leading`
  socket / `MeasuredSocketRow`) — the full-registry audit found no other offenders.
- **Cycle → RangeError instead of #CIRC!** (`process.ts`). rete-engine's `reset(nodeId)` walks
  outgoing connections recursively with NO visited set; the audit-40 targeted topology pass
  (`processGraph(cable.target, …, {topology:true})`) hits it the moment a cable closes a cycle —
  stack overflow BEFORE the Tarjan #CIRC! seeding runs. Fix: iterative `cache.delete` over the
  already-computed `downstreamClosure` cone (identical set, cycle-safe). `circularReset.test.ts`
  guards it. Never call `_engine.reset(id)` with an argument.
- **Composite drill-in editor** (`CompositeEditorOverlay.tsx` + `compositeEditorStore.ts`): the
  container shipped with NO way to open its internal graph. The overlay mounts `internalEditor`
  into a real rete area (same classic-preset customize + `getGuardedSocketPosition` identity
  offset as Canvas). Non-obvious gotchas, learned the hard way:
  - **Scope.use() can't be undone** → the plugin stack (area/connection/react) is created ONCE
    per composite and cached on the node instance (`__drillMount`); the container div is
    re-parented into the overlay per open.
  - **The area only creates views from `nodecreated` events** — the internal nodes predate the
    plugin, so back-fill with `area.addNodeView`/`addConnectionView` once at mount creation, or
    the overlay opens onto an empty grid.
  - **Do NOT re-export the overlay from `components/index.ts`** — it imports `nodeRegistry`
    (for the render preset), which imports the barrel back: a module-init cycle that TDZ-crashed
    the whole app at startup ("Cannot access X before initialization").
  - Literal edits inside the drill-in call `processGraph(internalNodeId)` — an id the outer
    editor doesn't know. `runGraphPass` now retargets an unknown id at the OWNING composite card
    (duck-typed `internalEditor` walk, `findCompositeOwner`), whose `data()` re-runs the whole
    internal graph. An open overlay refreshes its node views off `compositePassStore` (notified
    at the end of every pass).
  - Canvas's window keydown stands down entirely while the overlay is open (its guard list),
    and the overlay's own keydown is window-level (focus lands on `<body>` after canvas clicks).
  - Positions: the collapse gesture records each member's bbox-relative x/y into
    `composite.internalPositions`; they ride the internal snapshot (per-node `x`/`y`) through
    save/load/paste; the overlay writes them back on close.
  - Ports are edited THROUGH markers: header "+ Input/+ Output" adds a marker + exposed port;
    deleting a marker (only via port reconcile on close — Delete skips markers mid-session)
    drops the port and its outer cables.
- **Unpack composite** (`compositeLogic.ts unpackComposite`): exact inverse of collapse —
  members restored at card position + relative layout, boundary ports flattened to direct
  cables, markers dissolve, card removed. Context menu: Edit contents / Unpack composite.
- **Composite Workbench seed** (`composite-workbench.json` + `compositeSeed.test.ts`): a
  single-run container, a Simulation container with a real wired feedback loop, and a
  deliberate open-canvas #CIRC! pair — the author's three repro cases, loadable from the
  seed menu and asserted headlessly.
- Smoke-tested in a real browser this time (Playwright against the dev server): seed load,
  drill-in render, cable/port edits, unpack, #CIRC! badges. That's what caught the view
  back-fill and barrel-cycle bugs — tsc + vitest were green through both.

### Addressable model + text projection BUILT (Bet 2, `docs/v2.0/01-addressable-model.md`) (2026-07-03)
Every node now has a stable, user-editable `name` (`nodeNameStore.ts` — module store like
collapseStore/nodeSizeStore, keyed by rete's ephemeral `id`; defaults via a type-scoped counter,
`Filter_2`; validated identifier + unique-per-document on rename). `nodeNaming.ts` holds the pure
prefix/counter algorithm shared by the live store and the text-form writer.

`textForm.ts` is a pure `SavedGraph <-> text` conversion (no rete/DOM — the persistenceCore.ts/
groupPushCore.ts "pure core" pattern): one node per line in topological (dependency) order, ties
broken alphabetically by name; each line's fields in the canonical order — type, name, `init`
fields in `INIT_FIELD_ORDER`/`INIT_EXTRA_FIELD_ORDER` (extracted out of copyPaste.ts's
`extractInit` so both consumers share one list), then inline literal/string-literal fields and
connections sorted alphabetically (no single "declared" order exists for a class's dynamic
input-row keys); connections and `hostNodeId`/`members` are name-addressed, translated both
directions. Values are JSON-encoded per field so a multi-line string (a Note body) stays on one
line. Position/size/collapse + standoffs/pins/seedId/palette/packs live in a trailing JSON
sidecar after a bare `---` line, not inline. A real dependency cycle (error-codes.json
demonstrates `#CIRC!` on purpose) can't have a total topological order — Kahn's algorithm with
cycle remnants appended alphabetically, so the writer never hangs or throws.

`serializeGraph` (persistence.ts) now builds the raw SavedGraph from the live editor, then
returns `readTextForm(writeTextForm(raw))` — the JSON save is GENERATED from the text form, not
hand-maintained in parallel. Side effect: `SavedNode.id` becomes the name after this round-trip
(rebuildGraph already remaps every saved id to a fresh live id regardless of its shape on load,
so this loses nothing and makes the saved JSON itself more addressable/diffable).

Round-trip losslessness is machine-checked in `textForm.test.ts`, mirroring `seeds.test.ts`'s
load-every-seed structure: write text, re-read, re-write, assert the second write is
byte-identical, for every seed. Full suite (113 files / 1728 tests) + `tsc` stay green.

**Zero-bytes investigation (step zero):** `git grep -lP '\x00'` finds only genuine binary assets
(pngs, icons, logo) — no source file. Already fixed in an earlier commit (`bf9bbce`, `.gitattributes`
`* text=auto eol=lf` + a permanent `sourceHygiene.test.ts` regression guard). Not reproducible now;
no new fix needed.

**Left for later (not in this session's build order):** no dedicated UI control for renaming a
node (the store's `rename()` is fully validated and ready — the affordance itself, e.g. a
double-click-header or a Navigator field, is a follow-up UI task, not part of Bet 2's data-model
build order). The text form itself is not yet exposed anywhere in the app UI (no "View as text" /
paste-to-edit surface) — this session built the conversion + wired it as the JSON generator, per
the build order; a user-facing text view/editor is future work (gates bundles 07/08/09/13 per the
plan doc, which can now build on this).

### As-Of Join/Lookup BUILT — scope-features #22 (2026-07-03)
Bundle 12 §22 (`docs/v2.0/12-value-model-extensions.md`) implemented in full; the other two
items in that bundle (#21 uncertain values, #43 money mode) are untouched — both still need
an author representation call before code starts.
- **Join gains `"asof"` as a fifth `JoinHow`** (`frameVerbs.ts`): every LEFT row is kept
  (never fans out), matched to the nearest RIGHT row by an orderable (number/date) key —
  `asofDirection` ("backward"/"forward"/"nearest", default backward) + an optional
  `asofTolerance` cap the match. JS oracle (`asofPairs`/`asofNearest`) is a sorted binary
  search; the join's output-layout assembly was extracted to `assembleJoinOutput` so every
  `how` (asof included) shares it. `JoinNode` (`nodes/frame.ts`) gained an `asofDirection`
  field + a `tolerance` numeric input; `JoinComponent` shows a second SegToggle only when
  `how === "asof"`.
- **Rust engine**: `polars` gained the `asof_join` Cargo feature (was entirely absent, not
  just disabled). `verb_join` dispatches `"asof"` to `verb_join_asof`, which uses
  `LazyFrame::join_builder().how(JoinType::AsOf(AsOfOptions{..}))` — Polars' `join_asof`
  requires BOTH sides pre-sorted ascending by the key and returns rows in SORTED-left order,
  so a row-index column is added before sorting and restored after (parity with the oracle,
  which preserves the caller's original left-row order). `assemble_join_layout` is the Rust
  twin of `assembleJoinOutput` (equi-join's column-by-name layout logic factored out, reused
  by both paths).
- **Frame Lookup gains an approximate-match `matchMode`** (`LookupMatchMode`:
  `"exact"` | `"nextSmaller"` | `"nextLarger"`, mirroring Excel XLOOKUP's `match_mode`
  0/-1/1 — an exact hit always wins first, the approximate fallback only engages on a miss).
  Restricted to a number/date column (`#VALUE!` otherwise), same restriction as asof's key.
  Stays eager JS-only (`lookupFrameCell` in `frameVerbs.ts`) — never touches the Rust engine,
  per its existing "materialization-boundary op" doc comment.
- Gotcha: `AsOfOptions` in polars 0.46 has MORE fields than the upstream docs snippet I
  found implied (`allow_eq`, `check_sortedness` alongside `strategy`/`tolerance`/
  `tolerance_str`/`left_by`/`right_by`) — construct it with `..Default::default()`, don't
  enumerate every field.
- Tests: 5 new cargo tests (`engine/tests.rs`, backward/forward/nearest-tie/tolerance/
  rejects-non-orderable-key) + JS oracle tests (`frameVerbs.test.ts`) for both the asof join
  and the approximate lookup, + a `polarsBackend.test.ts` wire-shape check. New seed
  `seedGraphs/asof-join-lookup.json` ("As-Of Join & Lookup") demos both on a prices/trades +
  volume-discount example.
### Bundle 07 v1: headless CLI, Write CSV/JSON sinks, live-data refresh (2026-07-03)
Built the "in → through → out → unattended" arc per `docs/v2.0/07-headless-write-live.md`.

- **`scripts/run-graph.ts`** (`npx tsx scripts/run-graph.ts <graph.json>`, also `npm run
  run-graph`) — loads a saved graph, builds a real editor + `DataflowEngine` exactly like
  `framesSeed.test.ts`'s pattern, fetches every node keyed by label (dedup via `#n`), and
  prints JSON. Deliberately never calls `initFrameBackend()` — `frameBackend()` stays on
  `JsFrameBackend` since `engineAvailable()` is false under Node, so Polars-shaped verb
  nodes (Join, Group By, …) route through the JS oracle transparently; confirmed via
  `run-graph.test.ts` against the `table-verbs` seed (Group By + Join both resolve real
  values). A verb chain's live output is a lazy `FrameRef` — the CLI walks the whole result
  tree and resolves any ref through `frameBackend.ts`'s `readFrame` before printing, so
  output is real data, not opaque `"jsf:9"` handles. **Windows gotcha:** the "am I the CLI
  entry point" check must use `pathToFileURL(process.argv[1]).href === import.meta.url`,
  not a hand-built `` `file://${process.argv[1]}` `` template — the latter silently never
  matches on a backslashed Windows path (main() just never ran, no error).
- **`WriteCsvNode` / `WriteJsonNode`** (new `nodes/sink.ts`) — the write-side mirror of
  `CsvConnectionNode`. `data()` ONLY caches the incoming frame for the preview (never
  touches disk); the write happens in `run()`, called only from the node's Run button.
  CSV serializes via `formatFrameCell` (Excel-style TRUE/FALSE, `#CODE!` for an error
  cell — no native types in CSV anyway); JSON keeps native number/boolean/null (a
  dedicated `cellToJsonValue`, NOT `formatFrameCell` — collapsing a real `true` to the
  string `"TRUE"` would be a JSON-interchange regression, discovered by the sink.test.ts
  round-trip). **`enabled` (the arm/disarm flag) is deliberately absent from
  `copyPaste.ts`'s `extractInit` whitelist — it can NEVER round-trip through save/load/
  paste, so every construction starts disarmed.** There's no real "my file vs. a shared
  one" signal anywhere in the codebase (the packs/placeholder breadcrumb in
  `persistence.ts` is a compatibility signal, not a trust one), so rather than invent a
  fake one, EVERY load counts as "elsewhere" — strictly safer than the letter of the ask.
  Needed a capability change: `src-tauri/capabilities/default.json`'s `fs:allow-write-
  text-file`/`fs:allow-rename` only granted `*.json` — added the `*.csv`/`*.csv.tmp`
  entries or `WriteCsvNode` would hit a Tauri permission wall on every write.
  `fileBridge.ts` gained `pickSaveFilePath` (Save-dialog picker with NO write — the
  node's "…" Browse button; `saveTextFileDialog` couldn't be reused, it always writes).
- **Tier 1 refresh was already fully wired** — `ConnectionStatusRow` (`ConnectionNodes.tsx`)
  already had a per-node Refresh button calling `refreshConnection(id)`, and MenuBar
  already had "Refresh all connections" → `refreshAllConnections()`. Nothing to add there;
  the plan doc's uncertainty ("confirm one doesn't already exist... if not, add it") 
  resolved to "already exists."
  **Tier 2 (new):** `refreshMinutes` on `WebSourceNode`/`CsvConnectionNode` (persisted,
  0 = off), a `useAutoRefresh` hook (`setInterval` → the exact same `refreshConnection(id)`
  a manual click calls) and a `RefreshIntervalField` (commit-on-blur, both connection
  components). Verified `AlertNode.detectAndFire` fires correctly off a refresh-triggered
  recompute — added `connectionStore.test.ts`: a real `WebSourceNode → GetColumnNode →
  AlertNode` graph, mocked `fetch`, `refreshConnection` changes the cache key and the
  new value's rising edge fires the alert. The only thing that could have silently broken
  this is `refreshConnection` running inside `isGraphRebuilding()` scope (the ONE gate
  `detectAndFire` checks) the way `loadGraph` does — it doesn't; asserted directly.
- Cut from the plan's "polish pass": the fuller CLI (`--set rate=0.05 --out results.json`)
  — needs bundle 01's stable names to be worth building well; the plan itself flags this
  as non-blocking. `scripts/run-graph.ts` is the load-bearing v1 half.
- `vitest.config.ts`'s `include` widened to `["src/**/*.test.ts", "scripts/**/*.test.ts"]`
  — the CLI's test lives next to it in `scripts/`, matching `parity.ts`'s sibling location.
### Execution substrate: sketch calc mode + native CSV reader (2026-07-03, bundle 06 / #24)
Built per `docs/v2.0/06-execution-substrate.md`. #23 (persistent compute cache) is
explicitly OUT OF SCOPE — deferred, needs a fresh author decision.

- **Sketch calc mode** — a third `CalcMode` (`calcModeStore.ts`): `"sketch"`. While
  selected, `frameBackend.ts`'s verb runners cap a source frame's working set to a
  deterministic (never random) stride sample (`sampleFrame` in `frameVerbs.ts`,
  `SKETCH_SAMPLE_ROWS = 10_000`) before applying a unary verb — the sample factor
  (`trueRows/sampleRows`) propagates down a verb chain via a `_sampleFactor` map
  keyed by handle. F9 / Calculate Now (`requestRecalc`) brackets the pass with
  `calcModeStore.beginForceExact()`/`endForceExact()` (depth-counted), so
  `sketchActive()` reads false for that one pass — sketch mode NEVER intercepts a
  forced recompute. A **required** footer affordance ships with it: a "≈
  approximate" StatusBar chip, sibling to the existing manual-mode Calculate chip.
- **Extrapolated aggregates, not silent sample numbers** — a groupBy's sum/count
  aggregate columns are scaled by the sample factor and the result frame is marked
  `FrameValue.__approx = { factor }` (frame.ts); `FrameChip` shows a "≈" prefix and
  an "extrapolated from a sketch-mode sample" tooltip. avg/min/max/median/mode/
  stdev/var/percentof are deliberately left UNSCALED — extrapolating those would be
  wrong, not just approximate. The marking propagates through a non-aggregating
  verb chained after a groupBy (select/sort/filter/…) but resets at the NEXT
  groupBy. Scaling is applied at `readFrame`/`collectPreview` MATERIALIZATION time
  (`applySketchScaling`), never baked into the backend-stored data — re-sourcing a
  scaled frame back into Polars would round-trip through `engine_source`/
  `engine_collect`, which carry only plain columns, silently dropping `__approx`.
- **Latent bug fixed along the way**: `setFrameBackend`/`resetFrameBackendToJs`
  only cleared `_sourceCache`. Each `JsFrameBackend` instance's handle counter
  restarts at 0, so a bare string like `"jsf:2"` is NOT globally unique across
  backend swaps — a stale `_collectMemo`/`_sampleFactor`/`_sketchInfo` entry from a
  PREVIOUS backend instance could leak onto a colliding handle in a new one (hit
  writing tests: a suite calling `resetFrameBackendToJs()` between cases got
  another case's stale cached frame back). Fixed by clearing all four
  handle-keyed caches together on every backend swap (`clearHandleKeyedCaches`).
- **Native CSV→Polars reader** (WS-E) — `engine_read_csv` (`engine.rs`) reads a
  CSV file straight off disk through Polars' own reader (multi-threaded, SIMD),
  bypassing `csv.ts`'s Papa Parse + `frame.ts`'s `frameFromCells` type inference
  entirely; wired into `CsvConnectionNode` as the desktop path (`readCsvFrame` in
  `frameBackend.ts`), gated on `engineAvailable()` — web keeps the JS path. Known
  gap: the native reader infers number/string/logical columns only (Polars
  dtypes), not DATE — `frame.ts`'s conservative unambiguous-ISO check has no
  Rust-side equivalent yet, so a date column arrives as text; an explicit Get
  Column "read as Date" still converts it. Full inference parity is a follow-up,
  not a blocker for the perf win.
- **Cut from this bundle**: full FAMILY_BACKING formulajs-seam node hygiene
  (item 5 of the build) was scoped conservatively — see the commit for exactly
  which node ops were routed through `resolveExcelFunction` vs. left hand-rolled
  (anything with array-broadcast or error-tagging complexity was left alone
  rather than risk a behavior change).
### Trust & data-quality bundle BUILT — all 7 items (docs/v2.0/11-trust-quality-nodes.md, 2026-07-03)
Expect (opt-in not-null/unique/range/regex, pass-through, red badge + `fireAlert` on a NEW
failure signature), Problems panel (new `HudStack` child; hooks a new `registerErrorSink` seam
in `errorValue.ts`'s `installErrorGuards` — fires on a throw, the input-propagation short-
circuit, AND a producer's own SolError return with no throw at all), where-used (right-click →
`downstreamClosure` fed into the existing `isolateStore`), Reconcile (`reconcileFrames` in
`frameVerbs.ts`, reuses `joinFrames`' key-index machinery; classifies added/removed/changed/
unchanged with per-column before/after/Δ + an optional price/volume/mix variance breakdown),
model fuzzing (`modelFuzz.ts` — ~120 valid-shaped samples per leaf Number/Slider/Text source,
deterministic PRNG, drives the existing targeted-recompute path, scans the downstream cone for
a SolError/NaN/Infinity/failing Expect; Data → "Run model check"), Tornado (genuinely new node,
confirmed NOT an extension of `DecisionSensitivityNode`; `tornadoRun.ts` walks upstream leaves,
perturbs ±10%/declared range one at a time, ranks by swing, floating-bar chart via recharts),
node-anchored comments (`commentStore.ts`, new `CommentsPanel` HudStack child, `{author, text,
resolved}` persisted as `SavedGraph.comments?`; every node gets a corner indicator for free —
mounted once inside `NodeShell` in `nodeKit.tsx`, not touched per node component).

Two corrections the plan doc flagged up front, both true: `HudStack` is a hardcoded
`<PinLayer/><AlertLayer/>` stack, not a generic panel API — Problems and Comments are their own
bespoke component files (own state, own `registerChrome` call), added as new JSX children. And
no "jump and flash" gesture existed anywhere — built from scratch (`flyToNode.ts`'s new
`flashNode`/`flyToNodeAndFlash` + a CSS keyframe on `nodeCard.css`, `.solenoid-node-flash`,
applied via `area.nodeViews` containment so it works on every node root type).

Also built (not in the original 7 but load-bearing for #44's "not just a passive log" ask):
`insertClampBefore` (`modelFuzz.ts`) — a minimal mid-cable node-insertion primitive (add node →
remove the old connection → rewire through it) since no such API exists yet (bundle 14
"quick-wire" is still future work). The Problems panel's "+ Clamp" button on a mechanical fuzz
finding is a real one-click fix, not a stub.

Gotcha for later: `problemsStore`'s live entries are edge-detected per node (same `code` repeat
across recomputes isn't re-logged), same idea as `AlertNode`'s `lastStatusKey` — but there's no
"this node stopped erroring" clear yet, so a fixed node's last error row lingers until dismissed
or the node is deleted. Matches the log-not-live-state model `alertStore` already uses; revisit
if that reads as stale in practice. Model fuzzing only scans each node's own cache fields +
one level into arrays — it does NOT walk into Frame/Cube cell values, so a fuzz-induced error
buried inside a Frame column won't surface (scoped cut, noted in the commit).
### v2.0 Bet 1 — compile/fuse execution: group_by rewrite + verb-chain fusion (2026-07-03)
Implemented `docs/v2.0/03-compile-fuse.md` build order items 1–4, 6 (item 5, scalar fusion via
`compileFormula`, DEFERRED — see below). `cargo test` (32/32) + `npx tsc --noEmit` + `npx vitest
run` (1614/1614) all green.

- **`verb_group_by` rewritten onto native Polars lazy `.group_by_stable().agg()`** (`engine.rs`),
  replacing the hand-rolled HashMap bucketing — the one verb that couldn't join a fused plan
  before. `group_by_stable` preserves first-seen key order (matches the oracle exactly). Every op
  (sum/avg/min/max/product/median/mode/stdev/stdevp/var/varp/count) is a Polars expr
  (`group_agg_expr`) except MODE, which needs a custom per-group closure for first-occurrence
  tie-break (`mode_expr`, `Expr::function_with_options` with `FunctionFlags::RETURNS_SCALAR` set
  explicitly — **gotcha: `Expr::apply()`'s default options DON'T set that flag, and the result
  silently comes back `null`** for a scalar-per-group UDF; had to reverse-engineer this by
  comparing against `.product()`'s own definition, which sets it). `FunctionOptions`/
  `ApplyOptions`/`FunctionFlags` aren't re-exported through `polars::prelude` — added `polars-plan`
  as a direct dependency (Cargo unifies it to the same 0.46.x already pulled in via `polars-lazy`,
  no second copy). Also needed the `"product"` Polars cargo feature — without it `.product()`
  panics at runtime ("activate 'product' feature"), not a compile error.
- **Every verb now builds onto a shared `LazyFrame` instead of collecting per call** — `engine.rs`'s
  `Plan` struct (a `LazyFrame` + tracked names/types) and `apply_step`/`apply_ops`, exposed via a
  new `engine_apply_many(handle, ops: Vec<WireOp>)` IPC command (`engine_apply` is now the N=1
  degenerate case). Select/drop/rename/sort/head/a comparison filter/group-by chain purely lazily;
  distinct/unpivot/a text-predicate filter are hand-rolled (row-order/row-string ops no Polars expr
  can express) — they collect just THEIR OWN step and resume the plan lazily afterward, so a chain
  around them still fuses on both sides.
- **The JS seam accumulates the plan too** (`frameBackend.ts`) — this is what actually cuts IPC
  round trips, not just Rust-internal laziness (Rust collecting lazily doesn't help if JS still
  calls `engine_apply` once per verb node). `FrameRef` gained `__plan: readonly FrameOp[]`;
  `runFrameUnary` chaining onto an existing ref just extends `__plan` (`extendRef`) — zero backend
  calls. A materialization boundary (`readFrame`) or a card's own preview (`collectPreview`) FLUSHES
  the whole queued plan in ONE `applyMany` round trip (`flushRef`, memoized per pass by the REF
  OBJECT — not the handle string, since two refs can share a base handle with DIFFERENT pending
  plans after a fan-out). Measured directly in `polarsBackend.test.ts`'s new fusion describe block:
  a 3-verb chain now makes ONE `engine_apply_many` call, not three.
- **Ownership/GC gotcha this forced:** before, every verb node's ref uniquely owned a freshly
  `engine_apply`'d handle, so `dropFrameRef` dropping it on supersession was always correct. Now a
  chained ref's `__frameRef` is a BORROWED base (the upstream ref's, ultimately a source-cache
  handle) — `dropFrameRef` had to change to a no-op unless `__plan.length === 0` (a join/append
  result, or an already-flushed handle), or it would sever a handle other consumers still need.
  Flushed handles are owned by `_flushMemo` instead — `clearCollectMemo()` (called at the top of
  every `processGraph` pass) now also drops every handle the JUST-FINISHED pass flushed, since by
  then every consumer has already read the plain-JS-object `cachedResult`/preview values.
  `GetColumnNode` read `f.__frameRef` directly (bypassing the flush) — fixed to `flushRef(f)` first;
  grepped the whole `src/graph` tree for other direct `.__frameRef` reads and found none.
- **Deferred: item 5 (scalar fusion via `compileFormula`).** Read `excelFormula.ts` before trying
  this — the dormant `compileFormula`/`js()` codegen path (`excelFormula.ts:272`) is EXPLICITLY
  documented (comments at :478,594,608) as DIVERGING from `evalAst`, the production formula
  evaluator: no null propagation, no #DIV/0! (raw JS `Infinity`), no type-strict comparisons, no
  logical↔number bridge the same way. Wiring graph nodes through it as-is would ship silently wrong
  results. Doing this right needs either (a) reconciling `js()`'s semantics with `evalAst`'s first
  (a sub-project on its own), or (b) building a graph-region-to-AST extractor that reuses `evalAst`
  semantics directly instead of the codegen path — either way a separate, sizable follow-up, not a
  quick wire-up. Left `compileFormula` dormant; did not touch `nodes/expression.ts` or `evalAst`.
- **Also: this session's worktree was stale** (pinned at the pre-2.0-docs commit, 58 commits behind
  `develop`) — had zero unique commits vs. `develop`, so fast-forwarded it rather than working from
  a stale tree. If a worktree session can't find a doc/file that should exist on `develop`, check
  `git log`/`git merge-base` before assuming it's missing.
### Bundle 14 canvas/interaction polish — 4 of 5 items, #37-40 + #57(b) (2026-07-03)
Built everything in `docs/v2.0/14-canvas-interaction-polish.md` except #41 (conditional
formatting — needs its own author design session, untouched). One commit per item on
`develop`.
- **#37 Quick-wire** (Settings toggle, default off): `Canvas.tsx`'s `connectiondrop` pipe
  now reads `ctx.data.{initial,socket,created}` directly (the plugin already hands you the
  origin socket + whether the drop landed on empty canvas — no coordinate math needed) and
  opens the Add menu pre-filtered via `catalogSearch.ts`'s new `filterByCompatibleSocket`/
  `firstCompatibleSocketKey` (instantiate-and-discard each leaf via `create()` since no
  static socket-type metadata exists on a catalog entry). Picking a leaf wires the dragged
  cable into the first compatible socket. `socket.css` gets a `.solenoid-canvas--cabling`
  hit-target bump (conduit lanes excluded, stay tight) + a `cell` cursor over sockets mid-drag.
- **#38 Command palette**: bare Enter (not Ctrl+K), gated by the exact `editable` check
  Canvas's single-key shortcuts use, plus a check that no other modal (Add menu, Function
  Reference, Settings, Shortcuts) is already open. New `CommandPalette.tsx` — one box, four
  merged/ranked result kinds (run a command via the same synthetic-keydown dispatch
  MenuBar's Edit menu uses; add a node via `catalogSearch.ts`'s `scoreLeaf`, created
  directly at the viewport center; jump to a node by name, reusing `OutlinePanel.tsx`'s
  `focusNode` — now exported; toggle a setting from `SETTINGS_SCHEMA`'s boolean fields).
- **#39 Scrubbing**: `InlineNumberField` (`inlineInput.tsx`) gets a parallel pointer-capture
  drag path alongside `useDraftCommit` (not replacing it) — a 4px move threshold so a plain
  click still focuses/carets normally, continuous **draft-only** updates during the drag
  (no live graph writes — matches the project's commit-on-blur/Enter rule, just with
  pointerup as the trigger instead), one `apply`+`pushHistory` commit on release. Shift =
  10x step, Alt = 0.1x. Escape reverts via an imperative keydown listener (the field is
  blurred the instant a drag engages, so it can't rely on its own onKeyDown).
- **#40 Semantic zoom** (Settings toggle, default off, deliberately conservative trigger):
  extracted `htmlCanvasRenderer.ts`'s inline mip-level formula into an exported pure
  `computeIdealMipLevel(scale, quality, dpr)` (the renderer's own `drawFrame` now calls it
  too — one formula, not two that could drift) so it works in DOM mode, where no renderer
  instance exists. `semanticZoomStore` recomputes on every "zoomed" pipe event + on the
  setting toggling, gated at `idealI >= 4` (~6% scale, whole-graph-overview range), and
  self-toggles a root `html.solenoid-semantic-zoom` class. CSS hides `.solenoid-node__body`
  via `visibility` (not `display`) so socket-row measurements / cable endpoints are
  untouched — only the header + socket dots (siblings of `__body`) stay as the simplified
  card.
- **#57(b) Align/distribute + batch collapse**: new `selectionOps.ts`
  (`alignSelection`/`distributeSelection`/`collapseSelection`), reading the selection via
  `editor.getNodes().filter(n => n.selected)` like `nudgeSelection`/
  `createGroupFromSelection` already do, exposed as ten command-palette entries (no new
  toolbar chrome). Align is to the selection's own bounding box (Figma semantics) — a
  deliberate manual gesture, so unlike an automated layout pass it is NOT guaranteed
  overlap-free (two selected nodes sharing the other axis will land on top of each other,
  same as every other design tool's align does — flagging since the project's usual
  no-overlaps invariant is about automated layout ops, not a manual multi-select command).
  Batch collapse skips non-collapsible nodes by checking the rendered `.solenoid-node--no-
  chevron` class directly — there's no central collapsibility registry outside the render
  tree. Factored `expandMoveSet` (group members + standoff cluster expansion) out of
  Canvas's `nudgeSelection` into `selectionOps.ts` so the arrow-key nudge and align/
  distribute share one "what actually has to move" answer.
- **Not built**: #41 conditional formatting for tables — explicitly needs its own author
  design session before any code (per the plan). Nothing toward it was written.

### Ragged-list pad BUILT (audit finding 25) + list SORT nulls-last + TEXT TZ fix (2026-07-02)
The pad-to-longest-with-null policy (settled 2026-06-22 with the array-semantics build, unbuilt
since) is now implemented — **behavior change:** `[1,2,3]+[10,20]` → `[11,22,null]`, no more
silent tail-drop. Where and how, because the null rule differs per family:
- **Numeric broadcasters** (`excelFormula.ts` `broadcast2`/`broadcastCall`, `nodes/shared.ts`
  `broadcast`/`broadcastErr`): a padded position emits `null` DIRECTLY without calling the fn
  (missing in → missing out, matching applyOp's operator null-propagation).
- **Logic broadcaster** (`logic.ts` `broadcastEl`): the padded `null` goes INTO the fn — Kleene
  decides the cell (`FALSE AND pad-null` = FALSE, not null). Don't "simplify" these to one rule.
- **Paired family** (SUMPRODUCT/CORREL/…, formula `RANGE_PAIRED` + node-side stats/finance/
  SumProduct zips): min-length zip KEPT deliberately — padding would create rows the pairwise
  null-drop immediately removes, so truncation there IS the pad policy minus the detour.
- **SortBy/Interleave** pad to longest; a null/error SORT/SortBy key sends its row to the TAIL,
  stably, in both directions — list SORT now matches the frame sort's blanks-last policy
  (`frameVerbs.sortByColumn` / `engine.rs` `with_nulls_last`; the old bare `a-b` compare coerced
  null to 0, scattering blanks mid-list — the audit's "SORT nulls first" P3 is thereby fixed too).
- **TEXT(serial, "yyyy-mm-dd") TZ bug in the fix-pass's own finding-29 code:** FX.TEXT formats
  via UTC getters (probed), so the local-wall-clock rebuild double-shifted the day on any
  non-UTC machine — green in the UTC cloud CI, red locally (UTC+2). Now hands FX the
  `serialToJsDate` UTC Date directly. FX limit: time tokens render the date part only.

### v1.0 audit fix pass — every P0/P1, frame parity, perf, hygiene (2026-07-02)
Implemented `docs/v1.0-audit.md` top to bottom in the §9 order (one commit per batch on
`develop`; the audit doc now carries a ✅ status header). Highlights + non-obvious gotchas:
- **Date TZ (P0-1):** `parseDateToSerial` now rebuilds the wall-clock via `Date.UTC` from
  whichever getters match the parse interpretation. Gotcha: a bare trailing `[+-]\d{4}` is
  indistinguishable from a "-2026" year — a zone designator only counts AFTER a time component.
  TIMEVALUE parses time text directly (+AM/PM); EDATE clamps month-end.
- **Formula range policy (P0-2):** array args honor error-propagate/null-skip BEFORE Formula.js,
  with three shape carve-outs — COUNT-family raw, index-ALIGNED ranges drop null rows pairwise
  (per-array dropping would shear SUMIF/CORREL pairings), positional lookups keep nulls (MATCH
  answers in indices). IFERROR family handled in the call branch (it must SEE the error).
  VLOOKUP/HLOOKUP/LOOKUP/MATCH/INDEX got internal 1-D impls; lookups are case-insensitive.
- **Desktop GroupBy (P0-3) + RIGHT JOIN (4):** the 7 missing agg ops mirrored from the oracle.
  The join finding was pinned with a failing cargo test first — Polars right-join with coalesce
  emits `[left-non-key…, key(named after the RIGHT key), right-non-key(_right-suffixed)…]`, so
  the positional rename mislabeled columns. Fix selects BY NAME into the oracle layout;
  `maintain_order` set per driving side. Cargo parity tests 19 → 27.
- **Undo-clear-on-load (P0-5):** `loadGraph`'s finally calls a new `clearHistory()` hook
  (plugin `.clear()` + a 200-entry limit poked into the plugin's private field — the ctor
  doesn't expose it). Kills the corruption AND the biggest memory leak in one move.
- **XSS (P0-6):** DOMPurify over Note markdown + a real CSP + `withGlobalTauri` off +
  `--enable-unsafe-webgpu` dropped + fs scope narrowed to `$HOME/**/*.{json,csv}` (+`.json.tmp`
  for the new atomic temp+rename saves — dialog-picked paths outside still work via runtime
  grants, with a direct-write fallback for a `.tmp` outside a grant).
- **emitFrame race (19):** `beginPass(this)` passed as an ARGUMENT (`emitFrame(this,
  beginPass(this), await …)`) — JS argument order evaluates it before the verb await, so no
  per-node data() restructuring was needed. A stale pass drops its orphan handle, never the ref.
- **Filter coercion (16):** ONE value-coercion spec both engines implement; the Filter node
  passes through on an EMPTY value (it used to compare numeric columns against `Number("")`=0
  in JS and NaN in Rust). Unparseable → matches NO rows on both.
- **Perf (24/40-43):** per-pass collect memo (`clearCollectMemo` at pass start); Get Column
  is lazy via `backend.column()`; cable connect/disconnect runs a TARGETED pass (`topology`
  flag refreshes the Tarjan loop cache — the one global a cable touches); annotation resolvers
  shared per MICROTASK (can't cache across passes — selector branches change per pass) with
  connections indexed per build; HTML-canvas re-captures per changed node id (the render pipe
  carries it; the cableValueStore subscription was the thing forcing full rebuilds every pass).
- **NUL bytes (quality):** the four files were cleaned (\u0000 escapes), `.gitattributes`
  added, and a vitest guard now sweeps src+src-tauri+docs — it caught its OWN comment on the
  first run, and the audit doc itself carried one of the NULs it described.
- **Hard catalog↔registry test** immediately found 5 stale NODE_EXCEL keys (`logic-*`,
  orphaned by the BooleanOp split) — exactly the drift the dev-only console warn missed.
  NA node now emits the tagged `#N/A` (was one of THREE different not-really-N/A producers);
  the NaN "Not Available" constant is gone.
- **P6 operator table implemented** (settled 2026-06-22, had shipped unbuilt): case-insensitive
  `=`, cross-type ordering `#TYPE!`, `&` renders TRUE/FALSE, null propagates, booleans bridge.
  Formula hosts now pass booleans through (P7 for formulas). NOTE: P3 ragged-pad is still
  decided-but-UNBUILT — docs corrected to say so (finding 25).
- New coverage: calcModeStore matrix, httpBridge CORS classification, the catalog-wide
  persistence fixed-point sweep (finding 38), pagehide autosave flush (36).

### Unified XLOOKUP decided (2026-07-01, author) — design note, not built
Merge the three lookups into ONE node, keep the name **XLOOKUP**, "just be able to handle
everything." Folds in the v1.0-shipped **list** XLOOKUP (`XLookupNode`, match/search modes) and
**frame** XLOOKUP (`FrameLookupNode`/`lookupFrameCell`), plus a net-new **cube** lookup — one
class replaces both. Core rule (author): **return the matched value WHOLE, no drill-down** — the
node finds the position and passes back whatever sits there (scalar / list / 2-D frame). Key new
constraint: if the returned 2-D value has **nested cells, XLOOKUP itself outputs a CUBE** — so the
output stays `any` (cube-capable in the lattice) and cube-vs-frame is a runtime `isCubeValue` check
on the pulled value. Drilling into a returned cube is the downstream CubePopup / positional INDEX's
job, not XLOOKUP's. Open questions (in `v1.1-plan.md` WS-D): the input surface (duck-type an `any`
source into list-pair vs frame/cube-plus-column-names, vs a mode selector); what "return" means for
a frame (one column vs whole row = the 2-D case); pre-alpha migration (break both old nodes, one
`xlookup` catalog entry, drop `frame-lookup`); approximate-match + typed read-as fold in here. Full
note in `v1.1-plan.md` WS-D + `cube-node-scope.md` follow-ups.

### v1.1 execution plan written (2026-07-01)
- **`docs/v1.1-plan.md`** — expanded the archived `roadmap.md` "v1.1 — post-v1 deferred tail"
  bullet list into a sequenced, file-level plan mirroring `v1.0-plan.md`. Consolidates the
  v1.1 scope that was scattered across `backlog.md`, the FC/units author notes (2026-06-25),
  and the milestone split (2026-06-24). Structure: 5 independent workstreams (**WS-A Format
  Controller & Units** = the flagship, **WS-B Packs & extensibility**, **WS-C Canvas &
  interaction**, **WS-D Data & integration**, **WS-E engine scale niceties**) + an always-on
  bug lane (the navigator-group-row + FC-mis-dock regressions). **Two hard gates called out:**
  (1) WS-A's units-by-dimensionality depends on the FC function model landing first; (2) no
  *code* pack ships before dormant-pack persistence (WS-B1). Suggested cut: bug lane → WS-A
  (function model, then redesign) → first code pack → WS-C/D/E fill-in. **1.0 is released, so
  v1.1 is now the active milestone** (work on `develop`).
- **Grounded every plan item against the code** (5 parallel read-only sweeps) because the source
  checklists had rotted. Six items were mis-marked and are now corrected in `v1.1-plan.md` with
  file:line evidence: **already DONE** — Bug 1 (navigator group rows, translucent tint landed on
  develop), **dormant-pack persistence** (placeholders unknown types + preserves cables +
  `SavedGraph.packs` provenance, `persistence.ts:345-371`), **pinch-zoom** (`CappedZoom`,
  `Canvas.tsx:123`), **multi-level Nest Join** (`NestJoinNode` cube parent), **formula re-audit**
  (2026-06-25, deletion still pending). **PARTIAL, not net-new** — docked-FC movement (drag/group/
  tidy covered; push/expand/collapse not), hideable chrome (per-panel hide + Tab done; no minimap-
  corner/resize), Timesavers pack (shell re-tags core nodes; proposed idioms unbuilt). The FC
  function model, SegToggle unification, units-by-dimensionality, grid system, cable avoidance,
  new core nodes, Obsidian sync, image bundling, finance connection, cube-cell XLOOKUP, lazy-plan
  fusion, and Bug 2 (FC mis-dock) are all genuinely not done, as written. The old "no code pack
  before persistence" gate is dropped (persistence is built). Open decisions unchanged.
### Two v2.0 domain verticals: BOM/nested-costing + native Parquet source (2026-07-03)
Built from `docs/v2.0/15-domain-verticals.md` (#16 BOM/costing, #34 Parquet). Skipped
#15 (engineering-calc seat) on purpose — it depends on the units-by-dimensionality
rework, an author design decision not made yet.

- **Cube Rollup** (`CubeRollupNode`, `nodes/cube.ts`) — the one new bit of mechanics
  the BOM vertical needed: aggregate a column INSIDE each row's nested sub-frame,
  flattening a Cube back to a Frame with the roll-up appended ("cost of an assembly
  = SUM of its nested parts"). Reuses `frameVerbs.aggregateGroup` (now exported)
  rather than a bespoke aggregator, so a roll-up agrees with Group By on every op's
  null-skip/error-propagate edge case. Everything else in the BOM pipeline is
  existing machinery: Nest Join (parent/child → cube), Join + Get Column +
  Arithmetic + Add Column (per-line `Quantity × UnitCost`).
- **`bom-costing` seed** — two BOM levels (Parts → Subassemblies → Products), each
  nested via Nest Join and rolled up via Cube Rollup. Bolt is used by both
  subassemblies, so editing its `UnitCost` in the leaf **Parts** table ripples
  through both levels, correctly reweighted by quantity at each level.
  `bomCostingSeed.test.ts` runs the seed through a real editor + DataflowEngine
  (same pattern as `cubesSeed.test.ts`) and asserts the totals AND the ripple —
  no puppeteer, no live-app dependency, still an end-to-end check of the seed JSON.
- **Native Parquet source** — `"parquet"` + `"dtype-date"`/`"dtype-datetime"` Cargo
  features (the latter two needed for a Parquet file's own Date/Datetime columns to
  even read as such — `AnyValue::Date`/`Datetime` don't exist in the build without
  them, unlike `DataType::Date`/`Datetime` which aren't gated). `engine_read_parquet`
  (engine.rs) reads a file straight into a Rust `DataFrame` and registers a handle —
  no sibling direct-CSV-to-Polars reader existed to share a pattern with (checked
  per the task; that item is still open in backlog.md), so this is the first
  native file→engine path. `ParquetConnectionNode` (nodes/connection.ts) mirrors
  CsvConnectionNode's folder+filename/status/refresh shape but wraps the fresh
  handle directly as a lazy `FrameRef` — the file never crosses into JS. No file-
  sink mechanism exists anywhere yet, so Parquet write is deferred until one lands
  (per the task's own fallback instruction).
- Both land as CATALOG_TO_EXCEL-free (Solenoid-native / non-Excel) nodes: no
  `nodeExcel.ts` entry — Excel has no cube/rollup or Parquet-source concept.
### Composite subgraph container — shell + Scenarios + Data Table + Simulation (2026-07-03)

Built the composite/subgraph container `pack-architecture.md` scoped out under "Composite
pack node": a REAL computing subgraph node (`nodes/composite.ts`), explicitly not a `GroupNode`
variant. Landed incrementally, 4 commits:

1. **Shell.** `CompositeNode` holds a private `internalEditor` + `DataflowEngine` (its own
   `NodeEditor<Schemes>`, no AreaPlugin). `createCompositeFromSelection` (`compositeLogic.ts`)
   mirrors `createGroupFromSelection`'s selection-read + bounding-box pattern (`Ctrl+Shift+G`,
   bare `G` stays Group) but PHYSICALLY RELOCATES the selected nodes into the internal editor
   instead of framing them. Every cable crossing the selection boundary becomes a declared port:
   a `CompositeInputNode`/`CompositeOutputNode` marker inside, a real `any`-typed socket on the
   card outside. Persistence: `snapshotInternal()`/`hydrate()` round-trip the internal graph
   independently of the outer save format — `copyPaste.ts`'s `extractInit` gained a
   composite-specific branch, `persistence.ts` needed exactly one added line (`node.hydrate(reg)`
   in `rebuildGraph`) since a Composite serializes through the SAME generic `{type, init}` path
   every other node uses.
   - **Gotcha — module cycle.** `nodeCtorRegistry.ts` (extracted from `persistence.ts`, now
     shared) chains through `catalogUtils → nodeCatalog → rete-nodes → nodes/composite.ts` — so
     `composite.ts` can only `import type` a ctor map, never call the registry itself.
     `copyPaste.ts`'s `pasteClipboard` needed a registered-hook indirection
     (`setCtorRegistryProvider` in `process.ts`, Canvas wires it) to hydrate a pasted composite
     without closing that cycle at runtime.
   - **Gotcha — marker sockets.** Markers originally carried the REAL crossed socket type; that
     broke the generic `new Ctor({...sn.init})` reconstruction (a live `ClassicPreset.Socket`
     isn't JSON-safe, and the marker constructor needs the same `(init?) => Node` shape as every
     other node). Simplified to `anySocket` end-to-end — matches Expression's existing
     "type-agnostic boundary" precedent, and both marker types needed hidden `nodeCatalog.ts`
     entries (`hidden: true`) purely so `FLAT_CATALOG`/`ctorRegistry()` can reconstruct them.
2. **Scenarios.** Named input-override sets; a shared `runPass`/`collectMultiple` pair (inject →
   `engine.reset` → fetch every output marker) any multi-run mode calls N times and transposes
   into one ARRAY per output port — "lay outputs side by side" needed zero new display code
   since `ValueDisplay` already renders a list as a chip.
3. **Data Table.** A full-factorial Cartesian-product driver over any exposed ports that carry a
   CSV sweep list — reuses `collectMultiple` unchanged.
4. **Simulation.** The hard one: a REAL cable cycle wired among the relocated internal nodes,
   resolved as bounded feedback instead of `#CIRC!`. Key realization: because internals live in
   a SEPARATE `internalEditor`, the OUTER engine's `loopMembers` never sees an internal loop at
   all — the plan's "don't seed `#CIRC!` inside an opted-in Simulate container" bypass actually
   has to apply to the INTERNAL engine, which would otherwise deadlock pulling through the cycle.
   So `runPass` (every non-Simulation mode) now pre-seeds `#CIRC!` for `loopMembers(internalEditor)`
   — closing a latent hang bug an accidental internal cycle would previously have caused — and
   `runSimulation` bypasses that seeding, instead running Gauss-Seidel relaxation (same idea as
   Excel's iterative-calc circular-reference resolution): non-cyclic inputs resolve once through
   the normal pull engine, then `simulationSteps` rounds call every loop node's `data()` DIRECTLY
   (never through `engine.fetch`, which would just recurse into the same cycle) with cyclic
   inputs drawn from whichever loop member most recently resolved. Proved on the plan's own bar —
   a two-node population model (`pop ⇄ grow`) — as a `composite.test.ts` test.

**Left for a follow-up session (explicitly lower priority, not started):** Goal-seek (needs a
real numeric solver — bisection/secant against a target output, `#CONV!` on non-convergence,
reusing the existing finance-node error code) and Monte Carlo (driver slot only — distribution
representation is bundle 12, not this one). `CompositeRunMode` only lists modes with a real
`data()` branch; adding either is: extend the union, add the `data()` branch (probably reusing
`collectMultiple` again for Monte Carlo — N random draws is structurally identical to Data
Table's N combos), add the UI panel, add `nodeCatalog.ts`/persistence coverage is already free
(both ride the same generic `extractInit`/ctor-registry path every field on `CompositeNode`
already uses).

46 new tests across `nodes/composite.test.ts` + `compositeLogic.test.ts`. No existing test/file
needed changes beyond the cycle-avoidance plumbing above (`nodeCtorRegistry.ts` extraction,
`process.ts`'s new hook) — persistence.ts, Canvas.tsx, MenuBar.tsx, kind.ts, nodeCatalog.ts,
nodeRegistry.ts, copyPaste.ts all took small additive edits, no rewrites.

### v1.0 doc reconciliation + desktop seed-CSV fix (2026-07-01)
- **`fetchText` relative-URL fix** (`httpBridge.ts`). On desktop, `fetchText` sent EVERY
  url through the Tauri http plugin (Rust reqwest) to bypass CORS — but a RELATIVE url (a
  bundled seed asset like the Personal Finance seed's `/data/personal-finance/*.csv`) has no
  base origin, so reqwest failed. It worked on the web deploy (the browser resolves relative
  against the page origin). Fix: only ABSOLUTE (`^https?://`) urls take the Tauri path; a
  relative/same-origin url uses a normal `fetch`, which the webview resolves against the app
  origin (Tauri serves the bundled `/data/*`). So same-origin assets now work on desktop too.
- **v1.0-plan.md / CLAUDE.md reconciled** for the 1.0 cut: all four workstreams marked done
  (WS1 shell, WS2 Polars + lazy handles, WS3 verbs + Cube bridge, **WS4 landed via the
  HTML-in-Canvas pivot** — the WebGPU/Pixi phases are superseded, kept for the record). The
  two renderer "open decisions" resolved (HTML-in-Canvas, in-webview, ships feature-gated).
  Remaining for 1.0 = release mechanics only (bundled/portable artifact + tagged GitHub
  release → push to `main`), not features. `backlog.md` reconciled in the same pass.

### Manual vs automatic calculation + Pivot field flush + Pivot popup contrast (2026-07-01)
- **Calculation mode** (`calcModeStore`, Excel's Automatic/Manual — the File-menu items were
  stubbed disabled, now live). In MANUAL, `processGraph` short-circuits at the top (before the
  compute-overlay bracket) and just flags the graph DIRTY — a value edit, a new/removed cable,
  none of it propagates. Loads/seeds/paste are EXEMPT (they run inside `isGraphRebuilding()`)
  so an opened doc isn't blank (we don't persist computed values). `requestRecalc()` (Calculate
  Now) passes `{ force: true }` to compute regardless of mode + reroll volatiles + clear dirty;
  a completed pass clears dirty. **F9** is now a real global shortcut (Canvas keydown, works
  while typing) — it was only a menu hint before. The StatusBar shows a muted "Manual" when
  clean and an accent "Calculate" button (→ requestRecalc) when dirty. Mode persists to
  localStorage (like Excel's per-workbook flag). Store is dependency-free (process.ts imports
  it one-way); switching to Automatic triggers the catch-up recompute at the MenuBar call site.
- **Pivot flushes stale fields on frame change** (`PivotNode.pruneFieldsTo`). Repointing a Pivot
  at a different source (built-in frame "Amount" → a CSV with "qty") left the old field names in
  `stringLiterals` (rowFields/colFields/values) + `funcs` + `filterExclude`; a stale name
  aggregates a missing column. `data()` now prunes the resolved spec lists AND self-heals the
  persisted config against the current frame's columns. Idempotent once clean; only rewrites a
  literal when a stale name is actually present (so a wired field isn't churned).
- **Pivot editor popup contrast** (`PivotEditorPopup.css`). The used-field cue was `opacity:
  0.55` — in a configured pivot most fields are used, so most of the list read as washed out.
  Raised to 0.74, and bumped the type-glyph badge + the uppercase section labels from
  `--text-dim` to `--text`.

### Heavy-table strategy: root-cause fixes + a "Computing…" curtain for the residual (2026-07-01)
Author's steer: stop whack-a-mole on individual heavy ops. Two-layer answer.
- **Make the common cases free (root-cause, not per-op):** targeted recompute for value
  edits (see next entry), plus a **source-handle cache** in the frame backend seam
  (`frameBackend.ts` `_sourceCache`, a `WeakMap<FrameValue, Promise<FrameHandle>>`). The
  profiler on the 250k-row desktop build showed `engine_source` dominating — 24 calls /
  ~10s / 34MB — because a fan-out re-uploaded the SAME source frame per consumer and every
  recompute re-sourced from scratch. Now a frame uploads ONCE (keyed by identity) and every
  consumer reuses the handle; a `FinalizationRegistry` drops the Rust handle when the JS
  frame is GC'd; the cache is cleared on backend swap. The connection sources were already
  memoized (stable `cachedResult`), and `FrameInputNode` is now memoized by its text, so the
  handle survives ACROSS passes too — wiring a cable no longer re-uploads an unchanged CSV.
  Adding a node from the Add menu now uses the additive (no-reset) render path instead of a
  full recompute (`handleMenuSelect`).
- **Make the residual heavy ops explicit (`computeOverlayStore` + `ComputeOverlay`):** some
  ops are irreducibly multi-second (refresh a 250k CSV = real re-upload + re-run in Rust).
  `processGraph` brackets every pass with `beginCompute`/`endCompute`; the overlay is
  **deferred** — a pass must run past `REVEAL_DELAY` (150ms) before the curtain shows, and it
  stays `MIN_VISIBLE` (350ms) once shown (standard response-time-limit + anti-flash timing),
  so the now-cheap common edits never show it. When shown it dims the canvas and SWALLOWS
  pointer/wheel events (and Canvas's keydown early-returns on `computeOverlayStore.visible()`),
  so a heavy pass can't be interleaved with a pan/drag/add — the jank the profiler traced to
  overlapping main-thread work. Suppressed while the load overlay owns the screen. Wrapping
  `processGraph` in a thin `beginCompute`/try/`runGraphPass`/finally/`endCompute` keeps the
  counter balanced on every exit (guard, Cancelled, throw).

### Compute-pipeline perf probe + targeted-recompute for standalone inputs (2026-07-01)
Author reported "random" jank on the desktop (Polars) build during zoom/pan and when
adding/refreshing nodes. Pan/zoom itself is a clean render-only path (no `processGraph`);
the jank is a FULL `processGraph()` firing (engine reset → every node's `data()` re-runs →
every frame verb re-materializes a head-N preview over IPC, plus the source boundary
re-`engine_source`s the whole frame) and stealing the main thread while a gesture is live.
Two-part change:
- **Diagnostics — `perfProbe.ts`** (new). Zero-cost when off; turn on with
  `window.__solenoidPerf = true` (same flag process.ts's compute/render log + Canvas's
  pan/zoom fps probe already read). Then: every node's `data()` is timed (hook in
  `installErrorGuards`, sync + promise-settle so an async frame node's IPC is in its own
  row), every engine IPC call is timed/counted/sized (hook in `ipcBridge.ipcInvoke`,
  `estimateCells` peeks `args.frame.columns` cheaply — no stringify), and each
  `processGraph` logs `FULL`/`targeted`, the IPC call count + ms THIS pass, and the 5
  slowest nodes. `window.__solenoidStats()` dumps cumulative node + IPC `console.table`s;
  `__solenoidStatsReset()` clears. Use it to see whether the cost is `engine_source`
  (upload), `engine_collect` (a non-verb consumer pulling a whole frame back), or
  `engine_preview` (card head-N).
- **Smoothing — targeted recompute for the standalone value editors.** The inline-literal
  path (`InlineInputs` set/setStr) already used `processGraph(node.id)`, but the standalone
  input COMPONENTS still called the bare full-reset form: Number, Text, BooleanInput,
  DatePicker, TableInput, the drag widgets (XYPad, AngleDial, ColorPicker), BooleanOp (op),
  Regex (flags), Slicer. All are pure value edits (only the node's own output changes → the
  downstream cone is the complete affected set — the same contract the slider already used),
  so they now pass `data.id`. Editing a scalar that isn't upstream of a frame chain no longer
  wipes + re-materializes every frame node. Deliberately LEFT on the full form: `useNodeField`
  (op selects can retype an output socket), Tvm op change (drops cables — topology), Cast /
  Convert / FC / Note-retype (type changes need the reconcile sweep).
- **Gotcha — `loopMembers` (Tarjan SCC) is now cached** (`process.ts` `_cachedLoop`). It ran
  O(N+E) on EVERY `processGraph`, including per-keystroke targeted edits, though a value edit
  can't change topology. The full path recomputes + stores it; targeted/additive paths reuse
  the store. Safe because every topology change routes through a FULL pass first (Canvas's
  connectioncreated/removed pipe calls the bare form; load/paste settle via bulkSettle), so
  the cached set is fresh by construction. Don't add a targeted-only topology mutation without
  invalidating `_cachedLoop`, or #CIRC! seeding could go stale.

---

## Older entries archived

Entries from 2026-06-30 and earlier (plus the old reference sections) moved to [`archive/dev-notes-history.md`](archive/dev-notes-history.md) — first sweep (through 2026-06-18) on 2026-06-21, second sweep (2026-06-19 through 2026-06-30) on 2026-07-05.
