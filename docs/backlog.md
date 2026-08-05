# Solenoid — Backlog (1.3)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record; this file is the working queue, not a ledger.
Everything the author has deferred/parked/author-gated lives in `deferrals.md` behind
the ONE Deferral-review item below. Ruled-out ideas live in `out-of-scope.md`; settled
rationale in `decisions.md`. v1.2.0 shipped 2026-07-22; this queue is the 1.3 view.

---

## Architecture spec (`docs/rules.md`)

- [ ] **The author ARR pass — READY (author-present).** The intent: walk every rule
  by hand and authorize it as fully permanent. rules.md now carries the rule index
  (the authorization checklist, machine-checked against the headings) and the
  marking procedure (PROV section: heading grade → [ARR] + the ID into
  `AUTHOR_MARKED_ARR` in rules.test.ts, both in the same author-marked change). The
  densest MUSTs were restructured for the read-through 2026-07-29.
- [ ] **Spec-promotion: the remainder queue** — tranches 1+2 landed 2026-07-28;
  the parity corpus landed as FX-12 2026-07-29; FX-13 + SOCK-13 landed 2026-07-31
  (**72 rules**). Still queued:
  - **read-as is coercion-not-assertion** (`applyGetColumnReadAs` pins it) — narrow;
    promote if the class of config-driven coercions grows.
- [ ] **Rules spec — the enforcement tail.** Down to (low value): SOCK-8 partial
  (the un-greppable visual half of the socket-box geometry — the CSS pin landed
  2026-07-28kk) and SOCK-6 unenforced (recorded un-greppable). The semantic half
  closed 2026-07-29: quoted citations are machine-checked, the 19 bare-file
  citations were read and verified (rules.md known-violation 1 has the residual).

## Bugs & verifications

- [ ] **Editing a node header blacks out the app (tablet; other devices unchecked)**
  — author-reported 2026-08-01, **NOT REPRODUCED**. Tried headlessly against the
  real built app with `pointer:coarse` forced before module eval (so `IS_COARSE`/
  `IS_TABLET` are true exactly as on a tablet): tapped the header, typed, and
  committed via a real focus/blur on **every** card of getting-started (34),
  pivot-tables, equation-solver, famous-math and power-features — 107+ headers,
  zero errors, canvas intact. So it is NOT simply "any header commit": it needs
  a node type, doc, or gesture the sweep missed (a real touch sequence, the
  on-screen keyboard's viewport resize, or a node absent from those seeds).
  **Next occurrence now names itself** — the app had no error boundary at all,
  which is why a throw rendered as a black screen; `ErrorBoundary` (app + per
  node) landed with this item. Get the copied text from the boundary panel and
  this becomes a five-minute fix.
- [ ] **OUTSIDE REVIEW WANTED: number→text semantics of the text predicates**
  (flagged 2026-07-29; author explicitly defers this judgment to a reviewer).
  The spec today: a text predicate (contains/startsWith/endsWith, and string-eq
  with a numeric comparison value) on a NUMBER/date column compares the JS
  display string — `String(cell)` in the oracle (`passesFilter`), mirrored in
  the engine by a hand-written ECMA `Number::toString` (`js_number_string`,
  engine.rs; corpus-pinned in filter.json). That Rust reimplementation is the
  cost under review: correct today, but a classic own-it-forever liability.
  The alternatives a reviewer should weigh: (a) keep the JS display form
  (status quo — zero user-visible change, keeps the Rust formatter);
  (b) refuse text predicates on non-string columns with #TYPE! and require
  Cast — most consistent with the socket lattice's "families never
  auto-cross, Cast required" doctrine, deletes `js_number_string`, but
  removes a quiet convenience Excel users may expect from filtering;
  (c) canonical app-format strings (formatScalar) — rejected-by-default
  (locale/format-dependent comparisons). Whatever the verdict, it lands as a
  rules.md VAL rule with corpus cases; today's behavior is pinned either way.
- [ ] **Window min/max/close controls missing (desktop)** — `tauri-plugin-decorum`'s
  `create_overlay_titlebar()` isn't rendering the controls. Ruled out: the accent
  border. Needs a live devtools look (F12 — CSP/decorum errors?) or a decorum/tauri
  version check. Fallback: drop the overlay for native OS decorations. Worked before;
  regression cause unknown.
- [ ] **#7 Conduits sometimes unselectable/unmovable except via the Navigator** —
  intermittent, no repro; suspected z-order / hit-area or membership-sync issue tied to
  group membership.
- [ ] **Multi-row cards resolve no FC annotation** (found 2026-08-01 while wiring
  the complex render). `InlineOutputRows` formats through `formatRowValue` with no
  annotation lookup at all — for ANY type, not just complex — so an FC docked to a
  multi-output card (Quadratic Roots, Equation, Regression…) never reaches those
  rows. `ValueDisplay` resolves per-socket already (`formatAnnotationStore.get(node,
  socketKey)`); the rows carry their socket key, so the lookup is available — it
  just isn't done. Not complex-specific and not a regression.
- [ ] **Pinch-zoom on a real Mac trackpad** — should work via `e.ctrlKey` pinch wheel
  events; verify on hardware, intercept manually if not. (Unrelated to the 2026-07-27
  touch-pinch fix: that was the multi-touch finger count, this is the wheel path.)
- [ ] **Settle the OS-dropdown rule** (needs a device or mobile-emulated CDP, not
  reading) — CLAUDE.md says a native `<select>` inside a node needs a hard pointerdown
  swallow or an area re-render closes the picker mid-pick. It's cited all over the
  codebase but has NO recorded originating incident, and the mobile path suggests it may
  not hold: form controls are already excluded from tap-to-select (`nodeAndControl`),
  `patchDragGuard` returns false for an unselected node before any pick, and mobile
  browsers open the picker on tap-completion rather than pointerdown. 21 sites are held
  on precaution because of it. If it's false, they join the `stopDragStart` sweep; if
  true, record the repro so it stops being folklore. Low value either way — it only
  decides whether a one-finger pan can start on top of a dropdown.
- [ ] **Choppy zoom BAND — run the T1–T8 test plan** in dev-notes' 2026-07-25 open
  problem. An interior range of camera scales is choppier than both very close and very
  far zoom. Already ruled out: the gesture settle (3000ms hold changed nothing), element
  count (far-out paints every card and is the SMOOTH case), the HIC mip curve. T1 (pin
  the band's `k` range via `__solenoidPerf`, which now logs the worst frame's `k`) and
  T2 (a Performance trace inside vs outside the band) gate the rest — don't build
  anything before those two. Note: this supersedes `archive/performance-hardening.md`'s
  ledger, whose ablations may all have been measured outside the band.

## 1.3 punt list (author call, 2026-07-16)

- [ ] **iFrame / embed node** — general web-embed out the `chart` socket (FRED,
  YouTube, social). One author call opens it: Tauri CSP has no `frame-src` today, so
  the posture is `https:` (broad) vs a domain allowlist. Non-negotiables when built:
  `sandbox` without allow-top-navigation, `referrerpolicy=no-referrer`, https-only,
  click-to-load (saved URLs are untrusted; also the perf lever — each iframe is a full
  browser context, so don't render off-screen and cap concurrency). Most sites send
  X-Frame-Options: DENY — this serves embed-friendly content, not arbitrary pages.
- [ ] **Data Feed widening** — a richer series/symbol picker (today a text field +
  quick-picks), more providers. Shipped baseline: 2 providers (FRED keyless default /
  Alpha Vantage keyed — Stooq was cut: its keyless CSV sits behind a JS bot-check,
  `dataProviders.ts`), a plain ticker/series field + FRED common-series quick-picks,
  chart-ready typed output. Widening = a real
  symbol-search picker beyond the free field, and more providers. Stays Excel
  STOCKHISTORY scope — NOT crypto/FX, no real-time/intraday/options/fundamentals.
- [ ] **Composite drill-in — Navigator, lasso, group tools**: (a) Group/Cleanup/Autofit/
  Expand inside a drill-in (needs the group-drag reconcile pipe + push/standoffs/
  GroupNode taught the active area — a real DOM-verified lift); (b) Navigator + lasso
  (folded/hidden while drilled in). The toolbar reroute (D2 proper) is NOT this — it
  stays author-present in `deferrals.md`.
- [ ] **Document-level FC defaults** (default places / number format; the Document
  Properties window ships without them) — a format-pipeline integration, author-present.

## Build queue (decided, unbuilt)

- [ ] **Top-bar decorative art slot** — `TopBar.tsx` holds an empty middle-gap div
  (`.solenoid-topbar__art-svg` slot); drop an SVG (img or inline) into it.
- [ ] **AUTHOR CALL — mode-selector inputs on a wired blank**: `text.ts` selector
  inputs (delimiter/separator/pattern) and `date.ts` `basis`/`return_type`/
  `weekend_code` deliberately fall back to the literal (`?? literal`) on a wired
  blank — a mode blank is genuinely ambiguous (unknown → propagate, vs Excel's
  omitted-optional-argument → default), unlike an operand blank (fixed on its own).
  This DIVERGES from value-semantics.md's "a mode selector … PROPAGATES" row;
  decide which way and reconcile the table or the code.
- [ ] **Settings: Node Packs section** — planned but unbuilt (`Settings.tsx`).
- [ ] **Matrix-null round-trip in Table Input** (`TableDisplay.tsx`, "Inc 6"): blanks
  should round-trip as real null cells instead of collapsing the whole table.
- [ ] **Moveable / resizable / hideable toolbar chrome** (author direction; recorded
  at `CableShapeSelector.tsx`) — a later customisation slice.
- [ ] **WebGPU cable layer follow-ups** (`CableCanvas.tsx`): selected-above z-jump
  and ghost dashes (all cables currently draw behind, solid).
- [ ] **By-Row cap: silent truncation → Problems-panel warning** (`composite.ts`
  `BY_ROW_MAX_ROWS` = 500; each row is a full internal-engine reset, so the cap
  protects the arm-and-run Solve from an accidentally-wired huge frame).
- [ ] **Lazy-handle-on-cable** (`frameBackend.ts`): `collect()` is the transitional
  handle→eager bridge keeping whole frames on cables; once handles flow, the only
  materialization points are `preview` (display) and `column` (the scalar/list
  bridge), and `collect` goes.
- [ ] **WebGPU node-card LOD swap** (`NodeCanvas.tsx`): the current GPU card layer
  is an ALIGNMENT-CHECK overlay (semi-transparent `DEBUG_ALPHA`, drawn above the
  real DOM nodes to confirm size/position/color). The perf win is the unbuilt next
  step: hide the DOM nodes when zoomed out and show opaque GPU cards, shrinking the
  DOM compositing layer tree (where a node-heavy graph's zoom cost is).

- [ ] **AI command palette — the tail.** The full authoring loop is WIRED (2026-08-01;
  author calls: Anthropic only, full authoring first, D27/D28 as designed).
  `aiService.ts` sends the prompt + the document's text form to `claude-opus-5`
  (official SDK, browser opt-in; the ~30k-token grounding spec is a cached system
  block; server-side refusal fallback on). A fenced rewrite is validator-gated with
  up to 2 repair rounds fed back from `graphValidate`; a clean rewrite renders as an
  old→new line diff in the palette (`textDiff.ts`) with Cancel / Apply, and Apply
  loads via the same `loadGraph` path a file open takes. Prose replies render as an
  answer panel. Key: Settings ▸ AI (Anthropic; localStorage). Desktop CSP allowlists
  api.anthropic.com. The validator now also checks op vocabularies (`opVocab.ts`)
  and recurses into composite internals; `npm run ai-prompt` runs the exact palette
  loop from a terminal with a real key. Demo mode: type `demo` as the key — a canned
  staged build through the real pipeline, offline (`aiDemo.ts`); applied additions
  animate in (`aiReveal.ts`). Remaining:
  - **First real-key end-to-end** — cheapest via `ANTHROPIC_API_KEY=… npm run
    ai-prompt -- "make a mortgage calculator"`; then the palette on the preview
    (result panel + diff view + Apply flow, author eyeball).
  - **Apply drops undo history** — it rides the destructive load path; the pre-apply
    doc survives in autosave but Ctrl+Z won't restore it. Acceptable v1; revisit if
    it stings.
  - **Tidy on a cold graph** — verify auto-layout handles an all-at-0,0 generated
    graph.
  - **Desktop check** — the CSP addition needs one desktop build smoke test.
  - Later, if wanted: streamed reply rendering; an OAuth-style connect flow instead
    of a pasted key.

- [ ] **Formula ↔ node parity — the remainder** (D19, all tiers LANDED; the program's
  history lives in `formula-node-parity.md` + the dev-notes archive). Current state
  per `scripts/formula-node-parity.ts` (the truth, SSOT-6 — regenerate, don't trust
  this line): **548/548 IN-SCOPE leaves callable (100%); gap A = 0, gap C = 0**.
  The denominator is `inScope`, never the 646 catalog total — 98 leaves (sources,
  sinks, UI controls, canvas chrome, the verb surface) are non-functions by design
  and were never candidates
  Solenoid-native ops that stay non-formula by design (sources, sinks, UI, the
  frame-verb endpoint — bundle 08's transpiler is the "text in, graph out" answer).
  Packs 167/167 CLOSED. Actually open:
  - Distributions are validated only at representative points — widen if accuracy is
    ever in doubt.
- [ ] **Computed Column — the UX tail** (core LANDED 2026-07-29 through v3:
  inline expr + wired-λ definition, side-input sockets, row/rows, bracket refs
  for unspellable names, addAs output typing, After placement). Remaining,
  author-eyeball or design-tail:
  - **Shared column-picker component** (follow-on to the binding pickers, which
    landed 2026-07-30 as plain per-variable selects): Sort/Get Column/Join name
    columns as free text today and could adopt one shared picker.
  - **Output-column format/unit controls on the CC NODE's card** (author direction):
    the popup half landed 2026-07-31 (TablePopup's per-column format+unit row works
    on computed columns); the Computed Column node's own card still has no
    format/unit control for its output column.
  - λ view-as on the card (lambdaView annotation) once an FC docks to the λ input.
- [ ] **Aliasing / hidden-port promotion UI** (composites) — the data model has
  `hidden`/`advanced` per port; no UI to flip exposure or edit a hidden port's baked
  default. Includes the pack-shell "many internal ports → one shell parameter" aliasing.
- [ ] **Value-popup gaps** (surveyed 2026-07-27 while adding the column sort; author
  parked all five). In rough order of how much each bites:
  - The visual sort only covers the LOADED WINDOW — a grid is truncated to 1,000 rows
    before `sortedOrder` sees it, so sorting 50k rows by Price desc gives the largest
    of the first 1,000. The header says "first 1,000"; nothing says the sort is
    confined to it. The only one here that can quietly mislead.
  - Copy / CSV / Export emit SOURCE order while a sort is showing. Consistent with
    visual-only (the value didn't change), but someone who sorts then copies probably
    wants what they see. Author call, not a bug; one `sortOrder` map either way.
  - `− Row` / `− Col` remove the last row/column of the DATA, which under a sort isn't
    the bottom one on screen. Tooltips are accurate ("Remove last row"), so it's a
    read mismatch rather than a wrong action.
  - The grid is mouse-only: no arrow keys between cells, no Enter-to-move-down, no
    Tab-across, and headers aren't focusable so the sort has no keyboard path. The
    biggest gap against "zero learning curve from Excel", and much the largest job.
- [ ] **Keep `release-notes-features.md` current** — the curated 1.3 selling list +
  What's-New slide source (author writes the final release notes at cut time).


## Packs

- [ ] **Materials & Mechanical pack** — next domain candidate; the INTERPOLATE gate is
  cleared (List + Grid modes shipped). Only the domain content (datasets + presets)
  remains; the beam-deflection preset wants the variant-switch socket reconcile
  (`deferrals.md`). See `pack-composite-plans.md`.
- [ ] **Timesavers remainder**: date idioms carrying a config or judgment call (Fiscal
  Quarter start-month, Age/Tenure with DATEDIF `"MD"` nuance, Nth Weekday), the
  duration trio (wants an elapsed-`[h]:mm` format first), Split Name (multi-output),
  and the list-reducer batch (Conditional Aggregate AND/OR, Multi-Criteria Lookup,
  Last/First Non-Blank, Rank-in-Group…).
- [ ] **Composite pack-node shape** — packs can't ship subgraphs yet; the queued
  composite pack nodes (Wheatstone, pump operating point, psychrometric state point,
  Pareto, % of Total…) are planned in `pack-composite-plans.md`.
- [ ] **Pack distribution + dependency system** — third-party pack DISTRIBUTION; must
  land in tandem with subgraphs. Includes the pack-architecture prerequisites: saves
  don't yet record required packs/versions, and the code-pack story needs the
  pack-provenance work before the first code pack ships. (In-app `dependsOn`
  auto-activation already works — Electromagnetism → Electricity is the live example.)
  **Also owns the ABSENT-pack diagnosis for formula functions** (2026-07-27): the
  pack→formula seam resolves a DEACTIVATED pack's functions, but an ABSENT one has no
  impl to call, and a pack function called from a hand-typed Expression is not a pack
  NODE, so the placeholder path never fires — it reports an unknown function without
  naming the pack. Needs the saved-file pack record to say which. Also wire a
  `initPackFormulas()` re-run to the packs-folder reload once `loadCustomPacks()` stops
  being a stub; the seam is already re-runnable and tested for it.

## Deferral review (the ONE item for everything deferred)

- [ ] **Deferral review (author-present)** — walk `deferrals.md` top to bottom and
  decide, per item: into 1.3, stays parked, or dies to `out-of-scope.md`. Covers the
  author-decision gates (widget nodes, Parity Tier 4, cable pulse…), the author-present
  polish tails, the only-if-triggered set,
  and the 2.0 flagship ordering (`2.0-plan.md`). Same sitting: ratify or amend
  `out-of-scope.md` (still marked DRAFT).

## Release tail (author-run)

- [ ] **Cut 1.3** when the queue lands: desktop-gated checks (cargo on Windows,
  path-stripped `release:desktop` build, exe smoke), version bump to 1.3.0,
  merge → `main`, tag `v1.3.0`.
