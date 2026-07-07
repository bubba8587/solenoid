# Solenoid — Backlog

**OPEN items only.** When an item lands, DELETE its line — git history, the session
digests (`dev-notes.md` → `archive/dev-notes-history.md`), and the archived planning
docs are the record; this file is the working queue, not a ledger. (Policy changed
2026-07-05 by the author; the old flip-to-`[x]`-and-keep convention is retired.)

Where things stand: v1.0 shipped (desktop + Polars + verbs + HTML-in-canvas);
v1.1-α (the FC function model/redesign/movement audit) shipped 2026-07-05. The
v2.0 bundle set lives in `docs/v2.0/` (built: 01-07, 09, 11-15 — reviewed; open
bundles + "verdict pending" items are listed in its README; the shipped v1.1 plan
is archived).

---

## 1.1 release build (committed 2026-07-06 — see `release-plan.md`)

- [ ] **Finance / market-data connection — flesh out in a BIG way.** The `DataFeedNode`
  (fetch/cache/refresh/key-state) + `dataProviders.ts` (FRED/Stooq/Alpha Vantage) +
  `apiKeyStore` Settings UI EXIST and are tested but the node was never registered/
  catalogued/given a component — unreachable. Wire it up, then widen: more providers,
  series/symbol picker, date-range/frequency, chart-ready output, a finance demo seed.
  Scope in `release-plan.md` §3a (a couple of provider/UI-depth questions for the author).
- [ ] **iFrame / embed node** (author 2026-07-06) — a general web-embed node: FRED graph
  direct embeds, YouTube, social (Twitter/X), dashboards. Emits an embed value out the green
  `chart` socket (like Image/Mermaid) so it also embeds in a Report. **SECURITY (author-gated
  decision — this is the can of worms):** the Tauri CSP currently has NO `frame-src`, so it
  falls back to `default-src 'self'` and external iframes are BLOCKED. Enabling this REQUIRES
  loosening `frame-src` — the call is `https:` (any HTTPS embed, broad) vs. a domain allowlist
  (FRED/YouTube/Twitter…, safer but caps "other stuff"). Mitigations regardless: `sandbox`
  (allow-scripts allow-same-origin allow-popups, NO allow-top-navigation), `referrerpolicy=
  no-referrer`, https-only, and **click-to-load** (don't auto-load an embed on file open — a
  saved URL is untrusted; also the main perf lever). **PERF:** each iframe is a full browser
  context — click-to-load + don't render off-screen + cap concurrent. Reality check: most sites
  send `X-Frame-Options: DENY`, so this works for EMBED-friendly content (FRED/video/social),
  not arbitrary pages. Needs the author's CSP-posture call before build.
- [ ] **Massive seed overhaul** — pass on all 27 seeds: loads clean, tells a real 1.1
  story, no deprecated shapes; `seeds.test.ts` stays green. `release-plan.md` §3b. Near the cut.
- [ ] **"What's New" overlay** — short slide series (reuse overlay chrome, not a node),
  shown once per release (localStorage flag), re-openable from Help → What's New. Content
  from `release-notes-features.md`. `release-plan.md` §3c.
- [ ] **Keep `release-notes-features.md` current** — the curated selling list + What's-New
  slide source (author writes the final release notes).
- [ ] **Rigorous Trust-node audit** (author 2026-07-06 — flagged, NOT now): the trust &
  data-quality set (**Expect** not-null/unique/range/regex, **Problems** panel, **Reconcile**
  two-frame compare, **Tornado** sensitivity, **model fuzz**, node-anchored comments; built
  2026-07-03) was never reviewed rigorously. Audit each for correctness + edge cases before
  1.1 ships — "Trust your model" is a headline selling point, so it must actually hold up.

## Needs an author decision / author-present session

- [ ] **First-class composite drill-in — remaining gaps** (the "active graph context"
  arc; author 2026-07-06 said proceed). BUILT: `activeGraph.ts` seam (`getActive*` /
  `getOwningEditor`, `getEditor()` stays MAIN — locked by `activeGraph.test.ts`);
  de-fullscreen so the app frame stays around the subgraph (`z-index:4`, `html.sol-drilled-in`,
  floating breadcrumb strip); chrome on the active graph (NavMenu zoom/fit, a real drill-in
  minimap, lock); keyboard: copy/paste/delete/duplicate/add(A)/nudge/undo-redo/select-all(Ctrl+A)/
  Tidy(T); right-click node menu; propagation fixes (labels/FC/type-default); `areaPresets.ts`
  shared so surfaces can't drift. STILL OPEN: (a) **Group/Cleanup/Autofit/Expand + Isolate**
  in the drill-in — main-pipe subsystems (membership/push/collapse/standoffs, isolate z-order);
  a group there would be a static frame, so folded not half-shipped; needs those subsystems
  taught the active area. (b) **Navigator + lasso** in the drill-in — navigator list/select/jump/
  rename target main (route via a new active-selection hook); lasso is a custom Canvas rebuild.
  Both folded/hidden while drilled in for now. (c) **History routing** — row/socket/label edits +
  Edit-menu undo/redo push to MAIN history, so drill-in Ctrl+Z (buttons) don't undo them.
  (d) **D2 proper** — reroute the real top toolbar / mobile bar to the active subgraph
  (author-present, wants live eyeballing).
- [ ] **D4 — conditional formatting for tables** (#41; deferred again 2026-07-05).
  Needs its own design pass: must clear Excel's version by a lot (author's explicit
  dislike), Display-node-only, must not step on FC format/units territory.
- [ ] **FC A4 — units by dimensionality (the flagship).** Author 2026-07-05: IN,
  "big boy — we should go through it together when building" — DEFERRED to a
  dedicated AUTHOR-PRESENT arc (not the autonomous plan). Representation decided
  (tagged cells), `dimension.ts` algebra core landed. THE plan:
  `v2.0/05-units-format-controller.md`.
- [ ] **Header/body border seam under zoom — UNSOLVED, parked for a human/later
  model.** See dev-notes "UNSOLVED" for constraints + the two eliminated approaches.
- [ ] **Deferred pile — RESOLVED 2026-07-05 (author ruled each):** still deferred =
  **#23 persistent compute cache** and **#35 MCP port** only. OUT for good:
  #2 publish-as-form, #6 snapshots/diff, #11 transform-by-example, #46 sealed
  models, Bet 5, list-of-frames ("this is Cube"), Go-To-Special chrome ("we
  already have multiple go-to affordances"). #48/#54 resolved as the ultra-minimal
  library-folder opener (build item below).

## Decided, unbuilt (mechanical — no design session needed)

- [ ] **FC advanced options for TEXT values** (author idea 2026-07-06): put these
  in the Format Controller's advanced tier for a string-typed value —
  **text alignment** (left / center / right; the display-value default stays
  right-aligned, which reads fine for short text and clears the left-side Copy
  button, so this is an override not a default change), **render as source vs
  markdown**, and a **monospace toggle** (the value box is already mono; a text FC
  could opt a prose value OUT of mono). Design-first: fits the A2 advanced-tier
  expander; must respect the format-model truth table (`formatModel.ts` — text
  family currently exposes only `textCase`).

- [ ] **String lt/gt ordering** (byte vs locale) — small P3, decide + pin when touched.
- [ ] **Document Properties — remaining parts** (the window itself shipped 2026-07-06:
  title / author / tags / per-doc palette BASE, via `docMetaStore` + `SavedGraph.meta` +
  sidecar). Still open: (a) **per-slot doc palette overrides** (the window only sets the
  base; overrides stay hand/seed-authored on `SavedGraph.palette.overrides`) — a small
  per-slot editor like F-1's, scoped to the doc; (b) **document-level FC defaults**
  (default places / number format — the date default `DD-MMM-YYYY` already shipped;
  toolbar-supplementals [SETTING] verdict) — a format-pipeline integration (FC reads a
  doc default), best done deliberately / author-present.

## Composite / drill-in

- [ ] **Inside-solve stale dot is uniform** (author 2026-07-06, minor): after an INSIDE Solve
  (runs on marker seeds, ignoring outside wiring) the stale dot reads green though the held result
  is seed-based, not wired — you re-solve outside to use wiring. Distinguishing the two needs a
  drill-state signal in the compute layer (couples `data()` to `compositeEditorStore`); left simple
  on purpose. Revisit only if it reads as misleading.
- [ ] **Solver parameters (advanced tier per heavy mode)** (author 2026-07-06, after
  arm-and-run shipped): goal-seek **max iterations / tolerance / driver bounds**
  (bounds both aid convergence and cap a runaway search — the honest analog of Excel
  Solver constraints); Monte Carlo **sample count + seed** (seed = reproducible draws);
  simulation step count is `simulationSteps` already, just surface it consistently.
  Fits the FC-style advanced-tier chip-foot expander. Arm-and-run + the Solve button /
  amber-ring-vs-green stale dot already shipped (`compositeStaleStore`).
- [ ] **Simulation-container output series renders on the outer card only** — the
  drill-in should show it too.
- [ ] **Monte Carlo run mode** — driver slot exists; blocked on bundle 12's
  distribution representation for the sampling.
- [ ] **Aliasing / hidden-port promotion UI** — the data model has `hidden`/`advanced`
  per port; no UI to flip exposure or edit a hidden port's baked default. Includes the
  pack-shell "many internal ports → one shell parameter" aliasing (the stats
  confidence-level example).

## Nodes / engine

- [ ] **Rigorous multi-column input-socket label syntax** (author 2026-07-06) — a
  frame/2-D input socket should state which columns it expects in ONE consistent
  grammar. Today it's ad hoc: Sankey reads "From+To+Value", standard charts read
  "series (2-D)" — unhelpful, inconsistent. Design a rigorous convention (named,
  ordered, positional columns) that every node feeding a frame reuses, so the label
  itself documents the expected shape. Ties to the 2026-07-06 standing rule (aligned
  columns → one frame input, not parallel sockets).
- [ ] **Lossless frame→cube (typed `CubeColumn`)** (author-flagged 2026-07-06, bigger
  project) — the ladder is "a Frame IS a Cube with all-flat cells," but `toCube(frame)`
  (`frameToCube`) drops column types because `CubeColumn` is `{name, cells}` with NO
  per-column `type`. Give it an optional `type` so frame→cube preserves it: cubes could
  render dates as dates, XLOOKUP's cube path could match ISO dates, and the whole class of
  "cube socket eats frame types" bugs disappears (the XLOOKUP `rawInputs` bypass could then
  retire). Touches cube representation + `CubeDisplay`/`CubePopup` + the cube verbs + unit
  flow. Do it only if typed cube columns pull weight beyond this one node.
- [ ] **Error UX on restriction violation** — typed error out the socket vs the node
  flagging the offending input locally. Pending a call.
- [ ] **Formula re-audit remainder** — `formulaDivergence.test.ts` guards the known
  overrides (incl. the 2026-07-05 TEXT-family sweep); NOT yet swept: node `data()`
  paths that don't share the registered impl; distributions validated only at
  representative points — widen if accuracy is ever in doubt.

## Notes / documents

- [ ] **Obsidian vault trio** (IN, author-specced 2026-07-05): (1) a **vault
  folder selector** Setting (the `csvFolder` pattern); (2) **Import Note** node —
  picks a `.md` from the vault, renders like an existing Note but READ-ONLY,
  frontmatter → typed output sockets, refreshable; (3) **Write Note** node — a
  sink writing a Note/record back to the vault as `.md` with frontmatter
  (arm/disarm Run-button pattern, like Write CSV). Parse/serialize halves exist
  (`noteFrontmatter.ts`); desktop-only via `fileBridge`.

## Packs

- [ ] **More domain packs** — post-v1 polish (framework + Geometry worked example
  done). Don't build unprompted.
- [ ] **Pack variant-switch reconciles the socket set** — a simple pack's variant
  dropdown must add/remove sockets like Cast/read-as do (retype + reconcile), not
  leave stale ones.
- [ ] **Excel Timesavers pack additions** (proposal: `archive/timesavers-pack-proposal.md`)
  — ~25 formula-data presets + ~8 custom-logic + ~3 composites.
- [ ] **Pack distribution + dependency system** — LAST for 1.1 and a "maybe"; must
  land in tandem with subgraphs (`archive/v1.1-plan.md` B1 remainder).

## Desktop shell

- [ ] **Window min/max/close controls missing** (2026-07-06, dev + release): the app replaces the
  native titlebar with `tauri-plugin-decorum`'s `create_overlay_titlebar()` (`lib.rs` setup), and
  the controls aren't rendering. RULED OUT: the accent border (`set_window_border`/DWMWA_BORDER_COLOR)
  — disabling it did NOT restore them. Needs a live devtools look (F12 console — CSP/decorum errors?)
  or a decorum/tauri version check. Fallback if unfixable: drop the overlay for native OS decorations
  (guaranteed controls, loses the themed titlebar). Worked before; regression cause unknown.

## Cables / canvas / chrome

- [ ] **Cable collision avoidance** — DEFERRED for later (author 2026-07-05).
  Spec: `archive/cable-routing.md` §2 (avoid nodes; parallel runs + bridge hops;
  per-cable overrides).
- [ ] **Grid system** — DEFERRED for later (author 2026-07-05). Spec: `grid-system.md`.
- [ ] **Moveable / hideable UI chrome** (standing author principle): honor for
  every new panel; the decided piece (minimap 3-way) is queued above.
- [ ] **Optically center the last asymmetric icons** — canvas-lock toggle (reads
  low) + the cable-flourish sparkle (author's eye needed). Ink-centroid method in
  the archived dev-notes (2026-06-20).
- [ ] **Pinch-zoom on a real Mac trackpad** — should work via `e.ctrlKey` pinch
  wheel events; verify on hardware, intercept manually if not.

## Parked (superseded levers / far-future — revisit only if their trigger returns)

- [ ] **UI-scale toggle (Default / Larger)** — deferred to 1.2 (2026-07-01); subsumes
  all per-panel resize asks. Don't build per-panel resize.
- [ ] **Uncertain values (#21) + money mode (#43)** — IN but VERY LATE, sequenced dead
  last; each needs an author representation call first. Design context:
  `v2.0/12-value-model-extensions.md`.

- [ ] **WebGPU/wgpu renderer + the LOD swap** — superseded by HTML-in-Canvas as the
  zoom-at-scale lever. The WGSL/Pixi spikes are BUILT and parked (console-only
  `"canvas"` mode); the LOD hide is blocked on rete's ResizeObserver loop. Records:
  `archive/renderer-plan.md`, `archive/performance-hardening.md`. Reopen only if
  `drawElementImage` never reaches stable or a native-GPU need appears.
