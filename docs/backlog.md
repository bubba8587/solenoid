# Solenoid — Backlog (1.3)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record; this file is the working queue, not a ledger.
Everything the author has deferred/parked/author-gated lives in `deferrals.md` behind
the ONE Deferral-review item below. Ruled-out ideas live in `out-of-scope.md`; settled
rationale in `decisions.md`. v1.2.0 shipped 2026-07-22; this queue is the 1.3 view.

---

## Bugs & verifications

- [ ] **Window min/max/close controls missing (desktop)** — `tauri-plugin-decorum`'s
  `create_overlay_titlebar()` isn't rendering the controls. Ruled out: the accent
  border. Needs a live devtools look (F12 — CSP/decorum errors?) or a decorum/tauri
  version check. Fallback: drop the overlay for native OS decorations. Worked before;
  regression cause unknown.
- [ ] **#7 Conduits sometimes unselectable/unmovable except via the Navigator** —
  intermittent, no repro; suspected z-order / hit-area or membership-sync issue tied to
  group membership.
- [ ] **FC complex-family styles — verify code against the format-model truth table** —
  `format-model.md` warns "implementation may lag the spec here; the popup must still
  gate to the reduced style list". Verify, fix or clear the warning.
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
  quick-picks), more providers. Shipped baseline: 3 providers (FRED keyless default /
  Stooq keyless / Alpha Vantage keyed), a plain ticker/series field + FRED common-series
  quick-picks, chart-ready typed output. Widening = a real symbol-search picker beyond
  the free field, and more providers. Stays Excel STOCKHISTORY scope — NOT crypto/FX, no
  real-time/intraday/options/fundamentals.
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

- [ ] **Formula ↔ node parity — the remainder** (D19). Tiers 1–3 + the alias gate,
  the ratchet and the pack seam have landed; 332/646 leaves are formula-callable, gap A
  is the 19 D2-capped names, gap C is 0. Left: **Tier 4** (the D2 dimensionality cap —
  author-present, `deferrals.md`), and three list-family stragglers each parked for a
  stated reason rather than effort:
  - **SHUFFLE** needs a VOLATILITY model. The node holds its permutation stable within
    a recalc pass; a formula call can't. RAND/RANDBETWEEN already reach the formula
    surface from Formula.js without one — decide the model before adding a third.
  - **COUNT DISTINCT / INTERPOLATE / the Lists › Tests pair** — mechanical, just not
    done; each needs its op extracted to `listOps.ts` first.
  - **Frame verbs** stay out of scope for formulas by design (bundle 08's transpiler is
    the answer to "text in, graph out").
  Tiers + rationale in `formula-node-parity.md`; gaps machine-checked by
  `formulaNodeParity.test.ts`, node↔formula equality and formula-name UNIQUENESS by
  `formulaTier3.test.ts`. Residual: distributions are validated only at representative
  points — widen if accuracy is ever in doubt.
- [ ] **Computed Column (table-timesaver Tier 3, design-first)** — row-wise formula whose
  variables are column names, appended in place (PQ Custom Column); wants a design pass
  on sharing the Expression engine.
- [ ] **Rigorous multi-column input-socket label syntax** — one consistent grammar for
  what columns a frame/2-D input expects (today: Sankey "From+To+Value" vs charts
  "series (2-D)"). Every frame-consuming node reuses it, per the aligned-columns rule
  (one frame input, not parallel sockets — charts + SUMIFS + the frame verbs).
- [ ] **Aliasing / hidden-port promotion UI** (composites) — the data model has
  `hidden`/`advanced` per port; no UI to flip exposure or edit a hidden port's baked
  default. Includes the pack-shell "many internal ports → one shell parameter" aliasing.
- [ ] **Extend targeted recompute to topology changes** (D8 open follow-through) — a
  full recompute still fires on every cable connect/disconnect; value edits already
  recompute targeted.
- [ ] **INDEX over a CUBE: resolve the whole-axis slices** — the frame arm now types a
  blank/0 Column as `frame` (the whole-row slice); a cube's slices are likewise always
  cubes (`data()` keeps nested cells whole), so blank Column — or blank Row with a
  Column set — could type as `cube` instead of the placeholder. Only a single CELL is
  genuinely unknowable there.
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
- [ ] **Small mechanical sweep**: trueany adoption runs on the MAIN editor only —
  drill-in composites don't adopt (`trueAnyAdopt.ts`).
- [ ] **Keep `release-notes-features.md` current** — the curated 1.3 selling list +
  What's-New slide source (author writes the final release notes at cut time).

- [ ] **Give the kind-only families their ops lists** — all 98 op-selector families now
  declare a `kind` (machine-checked by `nodeOps.test.ts`), but 77 are kind-only: they
  classify the dropdown without listing its ops, so nothing new is searchable for them.
  That is CORRECT for the ~48 already listed op-by-op (nothing is hidden). It leaves
  real gaps for the collapsed ones, which would each gain `{ }` + search rows from an
  ops list: the 17 distributions (cdf/pdf, and the `.RT` right-tail forms — Excel
  treats `CHISQ.DIST.RT` as its own function, so those arguably want real leaves, not
  just search rows), Percentile / Quartile / Percentrank (inc/exc), and Pivot +
  CubeRollup + GroupByFrame (their `AggOp` table needs identifying first). The DATA
  pickers (Element's 118 entries, PhysicsConstant, Antoine, PipeRoughness, ESeries,
  ResistorCode, Constant) should STAY kind-only — a row per value would bury the menu.
  `scripts/op-exposure.ts` lists the exposure gaps.
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
