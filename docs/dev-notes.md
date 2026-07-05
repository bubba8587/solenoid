# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems. Per-item entries are
swept to `archive/dev-notes-history.md` once digested — read a digest first;
drill into the archive (or `git log`) only for the mechanics of a specific item.

### DAYTIME SESSION DIGEST (2026-07-05, ~13:00 onward — author review, decisions, FC v1.1-α)
The author reviewed the overnight/extended work (eyeball list passed) and drove decisions
live. Every commit verified tsc + full vitest (now 2184 green); tree clean, nothing pushed.
- **Dev env repair:** node_modules had been gutted by a disk-cache cleanup (app served a
  black screen off a stale Vite) — reinstalled, server recycled. A wiped Rust `target/`
  just rebuilds on the next cargo run.
- **Popup crosshair → "Go to source"** (author catch: flying to the HOST is a no-op — you
  just clicked its chip): `resolveValueOrigin` (`unitFlow.ts`) walks upstream through FCs,
  pure passthroughs, and data-aware selectors (actually-chosen branch) to the producing
  node; stops at transforms (Convert included), indeterminate/ambiguous selectors.
  `2457396`.
- **Image bundling — decision (b), amended:** a plain shared `images/` folder beside the
  saved doc, ORIGINAL filenames (`name (2).ext` only on a true collision, content-hash
  last resort, identical bytes reuse the file). `imageAssets.ts`: bundle on save —
  `saveToDisk` resolves the destination FIRST (`pickSaveGraphPath`) so the JSON written
  after carries the assetPaths; the Image component self-hydrates `dataUrl` on mount
  (covers load/paste/restore with no per-load-path hook). New Tauri fs grants scoped to
  `$HOME/**/images{,/*}` (not dialog-picked → static grants required). Desktop-only; web
  stays session-only. Needs a DESKTOP build to exercise. `fb81d23`.
- **No-century-guessing now covers named-month dates** (author bug report: `20-Mar-26`
  coerced to 2026 in a Frame Input): `parseDateToSerial` requires a 4-digit year run in
  ANY form — bare `Mar 20` (JS guessed 2001!) also rejected; one general guard replaced
  the two numeric-form regexes. `736382c`.
- **FC v1.1-α COMPLETE** (WS-A minus A4; see `docs/format-model.md` + the archived v1.1 plan):
  - **A1 — function model.** Spec `docs/format-model.md` (4-stage pipeline, family table,
    ONE precision×style rule) + `formatModel.ts` as the truth table in code, exhaustively
    machine-checked over the whole SocketDataType union (a new socket type won't compile
    until it declares its family). Scientific honors the precision row (was hardcoded
    `toExponential(3)`); logical sockets gained **show-as** (TRUE/FALSE · 1/0 · Yes/No ·
    ✓/✗, honored by value box/clipboard/inspector/Report refs); complex = reduced style
    list; structural sockets a quiet dash. `c9ffd1f` `f59761c`.
  - **A2 — redesign.** Flow arrows re-audited against the v0.9 semantics (the format
    row's backward-only claim was stale — the whole annotation rides forward): one
    three-state language, `← →` authored · `→ →` inherited · `← ←` Convert-dictated.
    SegToggle unified (the FC's private seg CSS deleted; pixi snapshot selector updated).
    Symmetric arrow-or-spacer gutters align all rows. The chip wears the node header's
    accent ring (a body tint was tried and REJECTED). **Advanced tier** behind a small
    mid-chip expander (persisted `advancedOpen`): 1,000-separator toggle, negative styles
    (paren wraps OUTSIDE the unit, accounting style `($1.2M)`; red = render-layer color
    via `annotationRendersNegativeRed` — first cut silently no-op'd by referencing a
    nonexistent `--danger` var; the real token is `--sol-error`), K/M/B scale. Formats
    cluster ABOVE the unit row (formats re-format freely downstream, units lock — never
    interleave the two). `6fa5874` `82eb80b` `9f24060`.
  - **Light-mode state ramp** (author direction): selection ring nerfed 32%→20% toward
    black, hover made a real step (12%), header/body divider accent-dark. Dark untouched.
    `48b60ac`.
  - **A3 — movement audit.** Most ops were ALREADY correct (the plan's "uneven" claim was
    stale): drag/group-move/tidy/autofit/expand-push/tidy-grow/restore/de-overlap/
    standoff-settle/cleanup all carry docked FCs (`translatePushed`), and the push world
    reserves an output-FC footprint. Two REAL gaps fixed: **collapse hid MEMBERS only**
    (an FC docked to a member but never absorbed floated over the collapsed box → docked
    satellites are now VIRTUAL members: hiding, the Display→FC hop, pills, expand settle;
    `groupCollapse.test.ts`), and the **bug-lane FC-mis-dock** (`findDockTarget` compared
    SCREEN px against a fixed 34px radius — zoomed out that spans a huge canvas area; now
    canvas units, `dist ÷ zoom`, zoom-1 unchanged). `6f53e6a`.
- **Header/body border seam: UNSOLVED, parked** — see the standing entry below; two
  cheats tried and reverted same-day, both eliminated paths documented there.
- **Decisions:** D2 (composite toolbar reroute) and D4 (conditional formatting) DEFERRED
  by the author. Next in WS-A when picked up: A4 units-by-dimensionality (v1.1-β,
  design-the-representation-first).
- **Decision walk + the autonomous plan (~17:00):** the author ruled EVERY open
  input item (see backlog for per-item stamps). Headlines: A4 units IN but
  author-present later ("big boy, together"); D2 reroute approved, author-present
  later; D4/seam stay parked; deferred pile collapsed to #23+#35 (rest OUT);
  #48/#54 became an ultra-minimal library-folder opener; COMPLETE RECHARTS is the
  new viz goal ("grab everything recharts has"); AND/OR Filter IN; Go-To-Special
  OUT; Obsidian vault trio IN (folder setting + read-only Import Note + Write
  Note sink); Finance connection IN reshaped (user-supplied keys, FRED, keyless
  Stooq); grid + collision avoidance deferred again. **`docs/build-plan.md`** is
  the ratified autonomous plan (Tiers A–F, per-bundle footprints/seeds/sequencing);
  the coordination board is live with staged queues (A2 → C-1 Recharts, A3 →
  commit duty + Tier A; Lead → Tier B Rust). STANDING ORDER: anything visual
  ships/extends a SEED (cleanup pass last-minute pre-release). Author note taken:
  the overnight "backlog exhausted" call missed the decided-unbuilt queue buried
  in the old ledger — the open-only backlog + this plan exist to kill that
  failure mode.
- **Parity-doc mining (follow-up ask):** swept toolbar-supplementals + the archived
  pain-points for verdicts that never became queue items. New backlog entries: a
  multi-predicate AND/OR Filter (pain-points §1/§14), pie in the Chart node, "Go To
  Special" select-all-errors chrome, grid-dots visibility toggle, doc-level FC
  defaults (into the Document Properties window item) — the first three flagged
  "rule in/out". Everything else in both docs verified shipped/queued/ruled;
  toolbar-supplementals' closing sections reconciled (its 4 open questions are all
  answered now), pain-points stays archived research.
- **Doc consolidation (author-mandated, aggressive):** dev-notes → digests-only (75
  per-item entries swept to archive); **backlog rewritten to OPEN ITEMS ONLY** (1823 →
  ~170 lines; new standing policy: a landed item's line is DELETED, git + digests are
  the record); 8 finished docs moved to `docs/archive/` (scope-features, v1.0-plan,
  v1.0-audit, performance-hardening, future-directions, strategy-threads,
  isolate-pin-multiview-scoping, node-arity-audit) with all live references repointed;
  CLAUDE.md's doc-maintenance section rewritten to the new policy.


### EVENING AUTONOMOUS RUN DIGEST (2026-07-05, ~18:00 onward — 3-agent crew on `docs/build-plan.md`)
Running digest — agents EXTEND this as bundles land. Every commit tsc + full vitest
green (cargo where Rust moved); commits FIFO through A3. Pushed once mid-run on a
direct author order (`f926fa6..aa5ab34`).
- **Tier A (A3):** locale + cable-shape persist + grid-dots toggle (`d630a43`);
  library-folder opener (`fa6080b`); minimap 3-way position (`c5fc842`); the a11y
  verify-and-finish batch — socket titles, reduced motion, focus traps on the 3 real
  modals, Switch aria-label, legend persistence (`c556b84`).
- **Tier B (A1):** B-1(a) Rust row-key = serde_json tagged tuples, byte-identical to
  the JS oracle (`1efa87d`); B-1(b) Infinity first-class in frames — `__nf` wire
  sentinel both directions, `{"__err":code}` upload contract, NaN present-but-dirty,
  aggregate guard in both backends (`aa2a623`); B-4a compileFormula codegen retired
  (`aa5ab34`); B-4b TEXT-family divergence sweep (text fns coerce numbers via
  numberToText; TEXT "@"/General/zero-pad/scientific patched; VALUE strict; NUMBERVALUE
  owned; DOLLAR accounting parens) + Group By totals (totalDepth → no-colFields pivot)
  — queued; B-2 AND/OR multi-predicate Filter COMPLETE — the filterMulti verb in
  both engines (fused lazy when all-comparison; text predicates collect + mask
  with zero-drift shared exprs), then the Filter Rows node rebuilt as extensible
  condition rows (per-row op + Aa match-case, AND/OR SegToggle at 2+ rows,
  pair-row undo, valueKeys/condConfig persistence); B-3 native CSV date
  inference (engine_read_csv applies the JS unambiguous-ISO gate post-read;
  zone-less = wall-clock as UTC; cargo 68/68). **TIER B COMPLETE.**
- **Tier C (A2):** C-1 COMPLETE RECHARTS — op surface (pie/scatter/radar/radial/
  funnel) + Histogram (`09bc120`); KPI/Bullet/Treemap/Sankey payload figures + shared
  ChartFigure (`7315441`); DateRange dual-date control (`5bd7105`); finale (composed +
  bubble multi-series + `chart-showcase.json`) queued. C-3 popup ⋯ overflow scoped.
- **Author EYEBALL list (accumulating — check on the live app):**
  - `table-verbs` seed: the Group By card has a second select (totals); the
    "Group By Rep → SUM(Amount)" node now shows a **Grand Total** row (555).
  - `chart-showcase` seed (once the finale commits): every new chart type renders.
  - Minimap position setting (Bottom / Top / Hide) in Settings.
  - Desktop only: a frame holding Infinity shows `∞`-ish cells (not blanks) — the
    B-1b sentinel; `formatScalar`'s ∞ glyph itself is still the open [decided] detail.
  - Desktop only: importing a CSV with an ISO date column (`2026-03-15`) now
    yields a real DATE column (renders `15-Mar-2026`), not text — B-3.
  - `table-verbs` seed: Filter Rows is now CONDITION ROWS — the original filter
    (one condition, no toggle visible) plus a new "Region = N OR Amount > 150"
    node (4 rows kept; AND/OR SegToggle appears at 2+ conditions; per-condition
    Aa match-case toggle on text ops; + Add condition).

### UNSOLVED: header/body border seam under zoom (2026-07-05 — parked for a human/later pass)
The node header's 2px accent frame abuts the card's 1px border on the same outer edge;
under the canvas zoom transform the two strokes rasterize with different width-phases →
a subpixel crack at the vertical junction and, at some zooms, a whole-pixel jog in the
bottom edge. **Tried and ELIMINATED — don't retread:**
1. Unify both at 1px (`d713900`, reverted `3be29b2`) — fixes the seam but thins the
   accent band; author rejected the look change.
2. Split the 2px accent into a 1px real border + 1px inset box-shadow ring (`ff3a896`,
   reverted `25ff69a`) — WORSE: Blink rasterizes borders (width-snapped) and inset
   shadows (not snapped) differently, so the two accent layers themselves drift apart
   under zoom.
Constraints: keep the exact current look (2px accent header, 1px body border). Leads
NOT yet tried: one SVG overlay child spanning the full card that draws BOTH strokes in
a single paint (one rasterization pass; needs --header-h published unconditionally —
today it's only measured when a corner badge exists, nodeKit.tsx:314); `border-image`
on the card; drawing frames in the HTML-in-canvas renderer only; quantizing the
area-plugin zoom k to device-pixel-friendly steps (would help every 1px hairline
app-wide, but touches feel of zoom).

### EXTENDED SESSION DIGEST (2026-07-05, ~08:40 onward — "keep going" + a 20-min loop)
Continuation of the block below; per-item entries in the archive. Everything verified
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
- **Standby state (superseded by the daytime session above):** the autonomously-
  actionable backlog was EXHAUSTED; the queued author decisions were then resolved
  same-day — image bundling BUILT, FC v1.1-α BUILT, toolbar reroute + conditional
  formatting DEFERRED.

### OVERNIGHT SESSION SUMMARY (2026-07-05, ~03:30–08:30 — 3-agent autonomous crew)
22 commits on develop (NOT pushed — local session). Every commit: tsc clean + full
vitest green (2044 → 2110 tests, +67); cargo 46/46; production build healthy (main
chunk ~2.0 MB after the ELK split); desktop release exe builds. All 26 seeds swept
crash-free through the headless runner. Detailed entries for each item are in the
archive; per-item "author eyeball" notes are inline there (the list passed author
review in the daytime session).

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

**Author decisions (resolved in the daytime session):** image bundling → BUILT (option
b, amended); composite toolbar-reroute → DEFERRED (architecture write-up in the
archived drill-in entry). Eyeball list passed review.

---

## Older entries archived

Per-item entries live in [`archive/dev-notes-history.md`](archive/dev-notes-history.md).
Sweeps: through 2026-06-18 (on 06-21) · 2026-06-19–06-30 (on 07-05) · the
2026-07-01–07-05 per-item entries (on 07-05, the session digests stayed here).
