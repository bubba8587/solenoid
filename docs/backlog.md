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


- [ ] **AI command palette — flesh out the mode behind the UI shell.** The shell shipped
  UI-only: Settings ▸ AI stores a key (`aiKey.ts` → `apiKeyStore`), and its presence
  reveals a sparkle that flips the palette to an accent-filled prompt box
  (`--ai` in `CommandPalette.css`). Nothing calls a service — submitting is inert, with
  the TODO at the send site in `onKeyDown`. Undecided and needed before building:
  which provider(s) and whether the key is per-provider (today it's the single `"ai"`
  slot); what a prompt is allowed to DO (answer about the graph, vs. author/modify nodes
  — the latter needs an action-approval step, not a chat log); where a response renders
  (the suppressed result panel is the obvious slot, but the palette is a launcher, not a
  transcript); whether AI mode should persist across palette opens (today it's local
  state and resets, deliberately). Also unresolved: the key is in localStorage like the
  data-provider keys, which is fine for a key the user pastes, but an OAuth-style
  "connect an account" flow would change that shape.

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
- [ ] **Rigorous multi-column input-socket label syntax** — one consistent grammar for
  what columns a frame/2-D input expects (today: Sankey "From+To+Value" vs charts
  "series (2-D)"). Every frame-consuming node reuses it, per the aligned-columns rule
  (one frame input, not parallel sockets — charts + SUMIFS + the frame verbs).
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
  - The CUBE popup has no overflow menu at all — no Copy, Copy as Markdown or Export
    CSV, all of which TablePopup has. Drill into a cube and there's no way out with
    the data. Predates the sort work.
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
  polish tails, the parked bugs (header seam, note-ring), the only-if-triggered set,
  and the 2.0 flagship ordering (`2.0-plan.md`). Same sitting: ratify or amend
  `out-of-scope.md` (still marked DRAFT).

## Release tail (author-run)

- [ ] **Cut 1.3** when the queue lands: desktop-gated checks (cargo on Windows,
  path-stripped `release:desktop` build, exe smoke), version bump to 1.3.0,
  merge → `main`, tag `v1.3.0`.
