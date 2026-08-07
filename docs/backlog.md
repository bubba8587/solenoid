# Solenoid — Backlog (1.3)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **The 1.3 pivot (author, 2026-08-07):** the app
ships as 1.3 basically as-is; this queue is bugs, small patches, and thorough
small-scope polish sweeps ONLY. Everything feature-shaped moved to `deferrals.md`
"Pushed to 1.4/2.0". Ruled-out ideas: `out-of-scope.md`; settled rationale:
`decisions.md`.

---

## Polish sweeps (the 1.3 working mode — thorough, small-scope, one seam at a time)

- [ ] **Node-by-node sweep** — walk the catalog one node at a time: null/error/empty
  inputs handled per `value-semantics.md`; collapsed card reads right; description
  matches actual behavior; tooltips/labels per DESIGN §7. Record per-family findings
  in the session digest; fix small, file anything big.
- [ ] **Fine-print residue (small, from the completed inventory).** The 45-claim
  sweep is DONE (2026-08-08; digest has the full record — every cluster verified
  agent-assisted, 1 false + 4 imprecise descriptions fixed, `caseContract` +
  `finePrintContract` pin the risky set). Leftovers, all small: (a) **AUTHOR
  SMELL — TEXTJOIN defaults disagree across surfaces**: the node defaults
  include-empties, the formula registration defaults ignore-empties (D11
  harmony; both explicit, but a bare call answers differently). (b) Expect's
  "fires once per new failure" edge-detects on the failing CHECK-NAME set, so a
  different cell failing the same check doesn't re-fire — verify intended,
  then say so. (c) Unpinned-but-verified minor claims if their nodes come up in
  the sweep: add-column pad, build-frame ragged rows, MUNIT blanks-out-of-sums.

## Bugs & verifications

- [ ] **Editing a node header blacks out the app (tablet)** — author-reported
  2026-08-01, NOT REPRODUCED (headless coarse-pointer sweep over 107+ headers,
  5 seeds, clean). The app now has error boundaries (app + per node) — next
  occurrence prints a copyable message; get that text and this is a 5-minute fix.
- [ ] **Window min/max/close controls missing (desktop)** — `tauri-plugin-decorum`
  `create_overlay_titlebar()` not rendering. Ruled out: the accent border. Needs a
  live devtools look or a decorum/tauri version check; fallback = native OS
  decorations. Regression, cause unknown.
- [ ] **#7 Conduits sometimes unselectable/unmovable except via the Navigator** —
  intermittent, no repro; suspected z-order/hit-area or group-membership sync.
- [ ] **Pinch-zoom on a real Mac trackpad** — should work via `e.ctrlKey` wheel;
  verify on hardware.
- [ ] **Settle the OS-dropdown rule** (needs a device/emulated CDP) — the "native
  `<select>` needs a pointerdown swallow" claim has no recorded incident and the
  mobile path suggests it may not hold; 21 sites held on precaution. If false, they
  join the `stopDragStart` sweep; if true, record the repro.
- [ ] **Choppy zoom BAND — run the T1–T8 plan** in dev-notes' open problem. T1 (pin
  the band's `k` via `__solenoidPerf`) and T2 (Performance trace inside vs outside)
  gate the rest — build nothing before those.
- [ ] **AI palette verification tail** — first real-key end-to-end (`ANTHROPIC_API_KEY=…
  npm run ai-prompt`), palette on the preview (author eyeball), Tidy on an all-at-0,0
  generated graph, one desktop CSP smoke test. (Known + accepted: Apply drops undo
  history — autosave keeps the pre-apply doc.)
- [ ] **OUTSIDE REVIEW WANTED: number→text semantics of the text predicates** —
  author defers to a reviewer. Today: text predicates on number/date columns compare
  the JS display string (oracle `String(cell)`; engine mirrors via hand-written
  `js_number_string` — the own-it-forever liability under review). Alternatives:
  (a) status quo; (b) `#TYPE!` + require Cast (most lattice-consistent, deletes the
  Rust formatter); (c) app-format strings (rejected-by-default). Verdict lands as a
  VAL rule + corpus cases.

## Small builds & calls (still 1.3-sized)

- [ ] **AUTHOR CALL — mode-selector inputs on a wired blank**: `text.ts` / `date.ts`
  selector inputs fall back to the literal on a wired blank, diverging from
  value-semantics' "mode selector propagates" row. Decide; reconcile table or code.
- [ ] **Matrix-null round-trip in Table Input** (`TableDisplay.tsx`): blanks should
  round-trip as real null cells instead of collapsing the table.
- [ ] **Settings: Node Packs section** — planned, unbuilt (`Settings.tsx`).
- [ ] **By-Row cap: silent truncation → Problems-panel warning** (`composite.ts`
  `BY_ROW_MAX_ROWS` = 500).

## Architecture spec (`docs/rules.md`)

- [ ] **The author ARR pass — READY (author-present).** Walk every rule and
  authorize as permanent; the rule index + marking procedure are in place.
- [ ] **Spec-promotion remainder** — read-as is coercion-not-assertion
  (`applyGetColumnReadAs` pins it); promote if config-driven coercions grow.
- [ ] **Enforcement tail (low value)** — SOCK-8 partial (un-greppable visual half),
  SOCK-6 unenforced (recorded un-greppable).

## Release tail (author-run)

- [ ] **Deferral review (author-present)** — walk `deferrals.md` (now incl. the
  Pushed-to-1.4/2.0 section) and ratify/amend `out-of-scope.md` (still DRAFT).
- [ ] **Keep `release-notes-features.md` current** — the 1.3 selling list.
- [ ] **Cut 1.3**: desktop-gated checks (cargo on Windows, path-stripped
  `release:desktop`, exe smoke), bump 1.3.0, merge → `main`, tag `v1.3.0`.
