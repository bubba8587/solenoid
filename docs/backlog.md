# Solenoid — Backlog (1.3)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record; this file is the working queue, not a ledger.
Everything the author has deferred/parked/author-gated lives in `deferrals.md` behind
the ONE Deferral-review item below. Ruled-out ideas live in `out-of-scope.md`; settled
rationale in `decisions.md`. v1.2.0 shipped 2026-07-22; this queue is the 1.3 view.

---

## Bugs & verifications

- [ ] **A wired `null` resurrects the typed literal on the date + text nodes** — the same
  `??`-swallowing bug the List Input audit fixed in `list.ts` (2026-07-25c), still live
  wherever an operand reads `inputs.x?.[0] ?? this.literals.x`. Confirmed: UPPER with a
  blank flowing in and "abc" typed in its box returns `"ABC"`, not the `null` the P6
  SQL-null model calls for. `readInput()` (shared.ts) exists precisely for this — a
  CONNECTED cable wins even when its value is null; only an UNWIRED slot falls back.
  Affects `text.ts`'s `strVal` plus every numeric operand in `date.ts`/`text.ts`
  (DateAdd.months, DateConstruct.year/month/day, LEFT.n, FIXED.decimals…). Left alone
  during the combo sweep on purpose, to keep those passes pure widenings with no
  behavior change; it's a scalar-path bug that predates them. One mechanical sweep:
  route those reads through `readInput` and let the broadcasters short-circuit the null.

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
  events; verify on hardware, intercept manually if not.
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

- [ ] **Formula ↔ node parity program (D19, greenlit — build in a dedicated session)** —
  converge the formula language and the node set; audit + tiers + decisions in
  `formula-node-parity.md` (numbers regenerable via `scripts/formula-node-parity.ts`).
  Build order: ratchet test first (pin the 57 + the blocklist), then Tier 1
  registrations, alias gate, pack seam. Legacy aliases BLOCKED (`#NAME?` + redirect
  hint); Solenoid-native formula names = the node hover hint despaced; packs register
  their own formula functions. NOTE this also closes a standing D10 violation: the
  pre-2010 stats family (NORMDIST…) still dispatches via Formula.js until the alias
  gate lands (classic lookups are already stubbed). Tier 4 is separate (author-present,
  `deferrals.md`). Residual: distributions are validated only at representative points —
  widen if accuracy is ever in doubt.
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
- [ ] **Small mechanical sweep**: trueany adoption runs on the MAIN editor only —
  drill-in composites don't adopt (`trueAnyAdopt.ts`); `readInput` sweep applied across
  `scalar.ts` only — the remaining `data()` files are the follow-up (~144 sites, biggest
  being finance/list/stats; each needs a per-input call on whether a wired null
  propagates or an Excel-style optional arg still defaults).
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
