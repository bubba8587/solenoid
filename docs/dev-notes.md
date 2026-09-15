# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-15b — rules and decisions become the DTE tree)

Owner-approved, unmonitored run; all on `develop`, not pushed. Governing node: B8 "Solenoid's
decisions and rules live only as DTE nodes; rules.md and decisions.md retire".

- **Core ring set by the owner.** A1 reworded (scratchpad math to data tables) and RATIFIED; the
  old A2 parity, A3 type/unit honesty and A4 pre-alpha moved to B5/B6/B7 ("A is the delivered
  product's goals; means are B"). DTE's ADOPTING.md is now vendored in `dte-rules/`.
- **The tree is the one home.** 152 nodes: every rules.md rule (MUST → Decision, Why/Origin →
  Why, Enforced by/Exceptions → Consequences) and every decisions.md entry, placed under new B
  strategy nodes (B9 agent-built rules, B10 reactFlowView, B11 maximalMerge, B12 lossless saves,
  B13 aiInScope, B14 design system). Merged duplicates: capabilityParity → shareImpl,
  tableRefSemantics → rowFormulaRefs, wildcardLadder → wildcardsKeepRank, unitGranularity →
  unitByGranularity, formatCarryPerOp → formatFlowsDownstream, noFramesInFormulas →
  matricesInFormulas, noBackCompat → B7. Both documents deleted.
- **Names survive as title prefixes** (`shareImpl: …`); citations read `dte:<ID> name`.
  `rules.test.ts` now reads the nodes: MUSTs label enforcement, cited suites exist (packages
  included; it found a stale `engine.test.ts` gap and a shadowed `rules.test.ts`), quoted test
  names appear, owner ratifications match `OWNER_RATIFIED`, and `dte:ID name` pairs match titles.
- **Citations.** Every rules.md/decisions.md pointer across code, tests and docs rewritten to
  `dte:<ID> name`; file-level `dte:` lines on the ~210 modules and suites the nodes name.
  Coverage 0.8% → 14%; no-reach nodes 110 → 4 (the process conventions, which DTE cannot count
  as reached; DTE FEEDBACK K9). A routed file's `dte:` line is the sanctioned exception to "zero
  comment pointers" (C57 commentMinimalism).
- **Overrides of DTE, each logged as feedback** (DTE repo FEEDBACK.md, uncommitted): names as a
  handle (K4), no contest for a lifted rule until new work builds on it (K2). Other findings:
  no bulk import (K1), retire drops the winner's contested mark (K3), enforcement is prose (K5),
  code-span example tokens validate (K6), validate output volume (K7), `cite` merges into
  line-level citations (K8).
- **Open (owner):** ratify the tree (only A1 is); the 12 new B nodes are the ones most worth reading.

### SESSION DIGEST (2026-09-15 — marketing site expansion)

All on `develop`; local dev server, pushed at session end.

- **Shared site chrome (`landing/siteNav.tsx`).** Header, nav, footer, theme toggle and the
  `Feature` row were duplicated across `LandingPage`/`ObsidianPage`; factored into one module.
  Nav = Obsidian/Examples/Packs/Download + GitHub + Open the app, active route marked, wordmark = Home.
  Adding a page is now a route entry + a page file.
- **Two new pages.** `/download` (web vs Windows build, copy lifted from the README) and
  `/examples` (a gallery of the seed library, grouped by the seeds' own labels). `App.tsx` routes
  both by pathname off the Vercel catch-all rewrite.
- **Examples deep-link.** Each tile is `/?seed=<id>`; `FlowCanvas` boot opens it via
  `documentStore.newFromTemplate` (a NEW doc, never clobbering restored ones) then strips the param.
- **`siteChrome.ts`** (reusable): a marketing page suppresses app-only overlay chrome. The Obsidian
  page hides the Report popup's Export + Dock.
- **Design + mobile pass.** In-prose links styled to the accent (were UA blue), `:focus-visible`
  rings on page chrome, `text-wrap-style: pretty` on running prose. Mobile: nav wraps, hero/section
  rhythm tightens, CTAs go full-width, the plan table wraps + the YAML sample scrolls, `overflow-x`
  guarded, touch (`hover: none`) gets the gallery Open hint. `index.html` gained a description +
  OG/Twitter tags (static, SPA has no per-route prerender).
- **Flow-canvas entrance animation (marketing stages).** Restored the load-reveal lost in the
  rete->RF port, opt-in via `FlowRevealContext` + a `sol-flow-reveal` class (the app surface never
  sets them). Cards fade/blur in (opacity + `filter` ONLY — **never a transform/scale on the node**:
  RF measures handle positions off the node box and a per-node scale in flight makes cables meet
  sockets at the top edge, and ResizeObserver ignores transforms so it never self-corrects). Then
  cables draw socket-to-socket at once (linear `stroke-dashoffset` reel via `pathLength=1` spread onto
  BaseEdge in `FlowCableEdge`), then the app's flow beads switch on ~1s in — without persisting
  `cableFlowStore` (shared origin with the app). LandingGraph reveals on mount; SceneStage waits for
  its ELK layout. Reduced motion disables all of it. Keyframes in `flow/flow.css`.
- **Obsidian page scenes upgraded.** TaskNotes is now a live `SceneStage` (real node -> Display), its
  HTTP API faked behind a demo flag (`demoTaskNotes.ts`, mirrors `forceDemoVault`) so the web shows a
  real Tasks cube with no server. Vault-table + TaskNotes Displays are collapsed to their 3x3 preview
  (a full frame/cube grows the card and zooms the scene out). The KMS-bridge graphic's highlight
  travels between the three cards (presenter-camera style, gated on `--anim`).
- **Document menu accordion.** New from example groups are collapsible (one open at a time, Start
  here open by default), so a long seed list no longer floods the menu (`DocumentTitle.tsx`).
- **OAuth/cloud-save scoped (plan-only).** Author asked to scope sign-in with Google/Bluesky to save
  graphs to Drive/PDS. Scoped into bundle 21 as **Stage 1-BYOS** (user-owned storage): a
  `RemoteStore` seam behind `documentStore`, PKCE on web + loopback on desktop, Drive via
  `drive.file` (recommended first cut), Bluesky reframed as publish/share because a PDS repo is
  public. Not built; author calls listed in `v2.0/21-collaboration.md`.
- **Packs page + site infra.** `/packs` shows the domain packs (grouped as in Settings, descriptions
  from the pack defs, on-by-default marked), added to nav + footer. `public/` gained `robots.txt`,
  `sitemap.xml` and `og-hero.png`; `index.html` gained `og:image` + `summary_large_image`.
- **In-app link to the site.** Help ▸ Solenoid website (also a palette command) opens the hosted
  `/?landing` on desktop, the current origin's landing on web.
- **Principle (author, this session):** the web app loads instantly, so the marketing site must not
  duplicate app/GitHub content. Killed proposed Functions and changelog pages on that basis; a
  changelog page is parked for later only if it earns its own surface.
- **Scene thread (`landing/SceneThread.tsx`).** A decorative socketless bezier from the bottom-center
  of each scene viewport (live stages AND the static `.sol-diagram` scenes) to the top of the next,
  drawn with the app's `getCablePath("spline")` (Bottom -> Top so it leaves/enters vertically).
  Measured from the DOM into an absolutely positioned SVG sized in px with NO viewBox (a viewBox
  scaled the coordinates), recomputed on resize/scroll/fonts.ready; fades in after the card entrance.
- **Hero scene switcher.** `LiveGraph` takes `scenes` (segmented pill) beside `build`: Spending
  (Frame -> Group by -> column chart), Vs target (two Frames -> Join -> line chart) and the 3D
  surface. ~30-row generated tables (`makeRng`), inline chart options, Reset kept.
- **Multi-series chart fixes (`chartRender.tsx`).** `MultiSeriesView` never passed axis labels to
  its axes (single-series did) — wired. Its legend is now a plain DOM row UNDER the plot, not
  recharts' `<Legend>`: recharts lays the legend out against the x-axis rect (it sat on the xlabel)
  and re-reserves height whenever measured != reserved (the chart jumped on a legend click). The
  row is fixed-height, inset by the y-axis width so it centers on the xlabel, its height taken off
  the plot. Verified with playwright (card bounds identical before/after a click). `OverlayView` /
  `ComposedView` still use recharts' legend (no xlabel there).
- **Playwright works here:** global `playwright-core` (under `openclaw`) + the ms-playwright
  Chromium 1223 build; scripts live in the session scratchpad. Use it before claiming a layout fix.
- **Open:** new-page copy (`/download`, `/examples`, `/packs`) is placeholder in the author's voice,
  marked `NEW COPY` — awaits an author pass. Reference-overlay gaps (Tables & Data tab, Units &
  Formats tab, Help sections) proposed, not built. TaskNotes status chip reads `6×0` (rows×cols
  with no cols reported) on both the real and demo paths — pre-existing.

### SESSION DIGEST (2026-09-14c — Knap 0.4.2 → 0.6.0)

All on `develop`.

- **`knap` bumped 0.4.2 → 0.6.0.** Nothing in `src/` had to change for the breaking list
  (typed `calc`/`round`/`length`, quoted `yaml` strings, `[42] | length` now 1): Solenoid
  never calls `yaml`/`yaml_property` from a template and no seed leans on the old text forms.
  `tsc` + 5951 tests green on the bump alone.
- **`{# … #}` comments wired up** (landed in knap 0.4.2, never adopted). `hasKnapSyntax`'s
  TAG_RE missed `{#`, so a Note or Report body whose only tag was a comment skipped the render
  and printed the comment verbatim. `embedBareVariables` now matches a comment first so a
  commented-out `{% for %}` cannot push an iterator the rest of the body shadows;
  `knapHighlight` greys a comment whole on `.fx-comment`. An unclosed `{#` is now a `#SYNTAX!`,
  the same as an unclosed `{%`.
- **`knap-upstream.md` re-verified against 0.6.0 and rewritten**, against the upstream source
  (shallow clone of obsidianmd/knap at the 0.6.0 tag), not just black-box probes. Entry 1
  shrank and sharpened: upstream PR #14 put the collection filters on a `TemplateValue` path
  but missed FOUR — `slice`, `reverse`, `unique` and `map`'s ARROW form (`map:Name` was ported,
  `map:x => x.Name` was not), all still `: string`. `slice` additionally has an explicit
  `slicedArray.length === 1` branch that returns `.toString()`. The fix is mechanical: port
  them onto `arrayInputValue`/`collectionInputValue` the way #14 did the rest. A `{% for %}`
  re-parses the JSON, so only `set`-then-index and a singleton `slice` show the gap, which is
  why it survived #14. Three more entries were wrong or stale and are restated. **5:**
  `sort:"Paid,desc"` is not "silently ascending", it is a lookup of a key literally named
  `Paid,desc`, so the rows come back in INPUT order with no warning — same as `sort:"Nope"`.
  **3:** the README does NOT document whitespace control (it did at 0.4.0); the real finding
  is that `trimRight` is hardwired on for block tags while `trimLeft` exists and is never set,
  so half the plumbing is unreachable. **8** and **6** both got much cheaper asks once the
  source was read: `src/docs/filter-docs.ts` already documents 61 filters in full (summary,
  syntax, parameters, notes, examples, groups) but is exported only to the CLI, so the ask is
  "re-export it from `index.ts`", not "add a `description` field"; and `parser.ts`'s internal
  `collectVariables` already computes exactly what `extractKnapVariables` does, so ask 6 is
  "export what `validateVariables` throws away". 2, 4, 7, 9 and 10 stand. **None of the ten
  are filed upstream** (knap has one open issue, #10, and one open PR, #13, both unrelated),
  so the backlog item is still the whole list.
- **The doc is now written to be filed, not just to be right.** Every entry is a plain-language
  issue/PR body with a "why it matters" paragraph and the repros in a fenced block, down to a
  "Solenoid side" line the author cuts before posting. The author files them by hand.
- **The edges are pinned now.** `knapTemplate.test.ts` § "the Knap engine edges the help doc
  names" asserts each gotcha `src/graph/help/knap.md` tells the author about, so the next bump
  fails instead of leaving the help copy stale. The help doc's § Gotchas was rewritten for
  0.6.0 (the `first`/`nth` line was wrong, the `sort` comma-form line was wrong) and § Blocks
  and filters gained the comment line.

### SESSION DIGEST (2026-09-14b — Obsidian hero interactive, LocalFile CSV, DTE integration)

Author-driven; all on `develop`, not pushed (local HMR verify).

- **Obsidian page hero is now a LIVE interactive canvas.** `LandingGraph` generalized to
  `LiveGraph({ build })` (the page's one live stage that keeps the process globals);
  `LandingGraph` is a thin wrapper. The `/obsidian` hero is `LiveGraph build={buildReportPipeline}`
  — a real reports/Knap chain (two Number inputs → Report note embedding them → Write to
  Obsidian), NOT the old properties-writer with its dense nested-IF ComputedColumn (author:
  reports/notes/Knap is the valued surface, properties reader/writer is least differentiated).
  `ReportOverlay` is mounted on the page (as LandingPage mounts TablePopup) so the Report's
  Document chip opens the rendered note.
- **Two more Obsidian scenes went real over the demo vault.** `VaultTableScene` (VaultFolder
  Notes → Filter tags∋book → Sort rating → Display) and `LocalFileScene` (a real Local File
  reads bundled `demo-vault/Data/expenses.csv`). Enablers: `SceneStage.awaitConnections`
  (compute → `whenConnectionsSettled` → recompute to a FIXED POINT via `hasInflightConnections`,
  was a magic 2 rounds); `demoVault.forceDemoVault(on)` (one non-persisted switch pinning
  `getVaultRoot`+`getCsvFolder` to the demo vault for the marketing pages, unifies the old
  forceVaultRoot/forceCsvFolder pair); the demo glob gained `csv`. **Latent bug fixed:**
  `fileBridge.readFileText` bypassed the path-aware `fs()` dispatch (raw Tauri imports) so demo
  paths never routed — now via `fs()` (no-op for real desktop paths). LocalFile allows a
  demo-vault folder off-desktop (CSV only). Covered by `tests/graph/demoVault.test.ts`.
- **Marketing chrome locked to the brand gold** (`.sol-landing` overrides the four `--accent*`
  vars); node/socket colors untouched. **Reveal animations play on reload** (the `--anim` gate
  moved to a `useLayoutEffect` so the hidden state paints before the IO reveal; extracted
  `useRevealAnim`, was duplicated in both pages).
- **DTE integrated (decision-tree-engineering).** The author's DTE tool is vendored at
  `tools/dte.py`; `decisions/` holds Solenoid's tree (A1–A4 goals, B1–B4 strategy incl. B4
  "adopt DTE", C1–C3 arch, D1–D2 impl for the demo-vault/marketing subsystem), `dte:ID`
  citations on ~12 files. DTE's OWN rules are vendored verbatim in `dte-rules/` (SPEC/PROTOCOL/
  README, `.dteignore`d) — the adopting repo does NOT re-create DTE-specific decisions as nodes.
  `docs/dte.md` + a `CLAUDE.md` pointer. `validate --as B` OK. **Open (author):** ratify the
  tree (A is owner-only); grow it to more subsystems; apply the WHY-comment→citation practice;
  optional pre-commit `hook`. Adoption friction logged to the DTE repo's FEEDBACK file (I1–I5,
  uncommitted for the author): vendored-tool tokens fail validate after init (I1), agent-can't-
  create-A tension (I2), day-one warning noise (I3), DTE never says to replace WHY-comments with
  citations (I4, the headline), ADOPTING invites duplicating the protocol (I5).

### SESSION DIGEST (2026-09-14 — landing/Obsidian pages on real canvases + demo vault)

Author-driven; all on `develop`, not pushed (local HMR verify).

- **Landing + Obsidian feature scenes are real locked canvases** (`landing/SceneStage.tsx`,
  `landingCompute.ts`, `LandingScenes.tsx`): the actual node components over a LOCAL rete stack,
  computed once. Converted: units (300 km ÷ 5 hr → 60 km/hr), equation (V=I·R solve), relational
  verbs (Join→GroupBy), draw (Point Plotter + Curve), typed cables (Input→Display per type, manual
  two-column), Obsidian note (Note frontmatter → TVM), and the Obsidian page's "Import a Note"
  (`NoteImportScene`: real NoteNode → Display). Function wall colored by node-kind accent. The "How a
  node reads" section/AnatomyScene was DELETED (author). Left as hand-built illustrations: MonteCarlo,
  Presenter (landing); Pipeline / TaskNotes / LocalFile (Obsidian — their real nodes do IO).
- **`activeGraph.ts` gained an OWNED-GRAPH registry** (`registerOwnedGraph`, ownership-only, never the
  action target). A scene's nodes live in its own editor, which `getOwningEditor`/`getOwningView` never
  knew, so render-time cross-node resolvers failed: a scene Display showed a date as its raw serial
  (date-ness is read off the output socket via `getOwningEditor`) and a united result as base SI (the
  docked FC couldn't resolve). Now resolved after main, before fallback. This was the real cause of the
  units scene's "16.667 m/s" — NOT the display-unit regression it was filed under (backlog reconciled).
- **Scenes lay out on MEASURED card heights** (`SceneInner`): compute → wait for RF to report sizes →
  stamp them onto the nodes → ELK, so a content-sized card can't be under-reserved. Main-app
  `FrameInputNode` height `220→280` (stale; predated the +Add lambda / +Add Form layout rows, so Tidy
  under-reserved and overlapped a neighbor). Backlog: main-app `elkTidyLayout` reserves DECLARED height
  for plain nodes (`tidyArrange.ts:473 return n`) — measure them too, but COMPARE git history first
  (likely measured once, changed deliberately).
- **Landing chrome onto current DESIGN tokens** (its designs predate the DESIGN.md overhaul): CTAs are
  the app's filled-accent "confirming action" + neutral default (were the pre-overhaul quiet-accent
  BORDER); theme/reset buttons off the `--btn-*` aliases onto `--surface-sunken`/`--border`.
- **Demo vault — a bundled read-only vault the web app reads** (`demoVault.ts`, `demoVaultData.ts`).
  Served through the `fileBridge` `FsProvider` seam behind a SENTINEL root `solenoid:demo-vault`:
  `getVaultRoot()` returns it when the new "Use demo vault (works in the web demo)" setting is on, the
  vault readers recognise it (their `hasFs()` gates allow the sentinel), and `fileBridge`'s path-aware
  dispatch routes those paths to an in-memory provider — desktop file ops stay on the real fs. Vault
  Folder + Import Obsidian Note now work with no vault, browser included. Writes throw (not editable);
  Write to Obsidian refuses with a read-only message. Files lazily code-split (`demoVaultData` chunk,
  ~10 KB gz); `.obsidian/` excluded by extension. FOLLOW-UP: the Obsidian page's Pipeline / VaultFolder /
  ImportObsidian illustrations could now become real canvases reading the demo vault (TaskNotes still
  needs its HTTP API; LocalFile would need a bundled CSV).

### SESSION DIGEST (2026-09-14 — solo with author; deps, settings, gauge, polish)

Rapid author-driven pass; all on `develop`, pushed at close.

- **Dependencies walked forward.** `vitest` 4.1.11 → 5.0.0 (suite green; it transforms with Oxc
  now, so the `esbuild: { keepNames: true }` in `vite.config.ts` — which only guards the production
  `minify: "esbuild"` path — prints a harmless "esbuild options ignored" warning in tests).
  `@anthropic-ai/sdk` 0.123 → 0.125, `@tauri-apps/plugin-http` → 2.6.0, plus in-range react/vite/
  katex/marked/dompurify/yaml. **`mermaid` held at 11.17.2** — 12 pulls chevrotain 11 with an
  unfixed high-severity `lodash-es` and no patched release to override to (backlog deps section).
- **Header-title case setting** (`settingsStore` `headerTitleCase`, global): UPPER (default) / As typed
  / Proper, a CSS `text-transform` via an `html.hdr-case-*` class on the label DISPLAY only — the
  editing input shows raw text, rendered cased on blur (draft-commit convention). Covers node cards
  and group titles. Non-upper modes drop the all-caps 0.08em tracking so Atkinson's lowercase isn't
  loose. The labels were hardcoded `text-transform: uppercase`, which is why case couldn't change.
- **Node-header vocabulary named** (glossary): Header label (`node.label`), Family name
  (`nodeTypeName`), Type-hint, Op name (`nodeName`), Node blurb — and the misleading `headerTitle()`
  in `nodeKit.tsx` (it returns the description tooltip) renamed `headerTooltip()`. Also a **Popups**
  glossary entry: popups open from a chip or the Display node, each a `*PopupStore` on the shared
  `PopupShell` (grep `PopupShell` for the roster), never the source-node component.
- **Undo/redo never flashes the load curtain.** A restore is a full `loadGraph`, so any graph past
  the curtain threshold flashed "Loading graph" on every undo (32 nodes tripped the old 60-work bar).
  Restores pass `curtain: false`; `SWITCH_CURTAIN_MIN_WORK` 60 → 300 (`persistence.ts`, `flowHistory.ts`).
- **Settings**: the four Tidy fields fold under a collapsible "Tidy" (new `accordion` field option);
  the per-doc "Network for this document" row shows ONLY for a foreign, undecided doc (Always-allow
  covers the rest); section order → Appearance, Canvas, View, Data, Obsidian, Renderer, Packs (AI +
  API keys trail).
- **Gauge Dial/Bar demoted from op to argument** (opArgDistinct; author: nobody searches "dial"/"bar",
  no formula surface — DESIGN § Op pickers corrected). Field `op` → `mode` (reusing the whitelisted
  init key, no save-format growth), `OpToggle` → `SegToggle`, out of `NODE_OPS` (no `{ }` marker, no
  "Gauge: Dial/Bar" rows; keywords carry search). Bar now collapses with the standard chevron to the
  standard hero-box `[Chart]` chip (opens the popup, which draws it via `ChartFigure`'s scale branch);
  dial keeps its mini arc. A collapsed-only box that is also a chip hero now right-aligns (was centered
  by the minis rule). Add-menu `{ }` marker gained a hover highlight + generic tooltip.

### SESSION DIGEST (2026-09-13b — solo with author; Chart Builder, catalog, family names)

Rapid author-driven pass; all on `develop`, nothing pushed.

- **Chart Builder.** Gantt's timeline and month-calendar layouts now offer different option
  sets — `chartBuilderKeys(target, layout)` narrows the calendar to what it actually reads
  (title, fontsize, layout, critical, minutes, window); timeline keeps the full set, inert
  rows still show dimmed. **Record** gained a Chart Builder target (title / fontsize / cardsize
  / clamp) — it had an Options socket the builder never covered.
- **Copy-edit freeze** (`devCopyEdit.ts`). Restores the element's `innerHTML` on exit instead
  of `textContent` (a markdown-rendered description no longer flattens to plain text and stick),
  and flags `.sol-copyediting` while an edit is open so the Inspector's 150ms poll holds — a
  re-render can't repaint rendered markup over the raw source under the caret. A corrupted List
  Input description (backticks stripped by the old bug) was restored.
- **7-Segment node removed** entirely (class, view, payload, `sevenseg` op, catalog + registry).
- **Add menu reorg.** New **Docs & Files** category (Note, Report, the Obsidian group nested,
  Image / File Link / SVG / Promo, QR) — it absorbed the old **Other**, whose pack-fallback role
  moved with it (`catalogUtils` placement fallback, `packShared`, function-reference / AI-grounding
  top-group). **Distributions** folded under **Numbers**; **Expression | Equation** paired; the
  **Format** node is now **Format Controller**.
- **NAME-3 — the hover type-hint shows the family name** (dte:D22 NAME-3). The card's right-side, hover-revealed
  type-hint (`.solenoid-node__type-hint`) now shows the op-agnostic FAMILY name (`nodeTypeName` — "Series",
  "Math FX"), so it stops being a third copy of the op the header and dropdown already show. ONLY the
  type-hint changed; the card title, Inspector, Navigator, popups, cable-source label stay op-specific
  (`nodeName`) as before. Because the family name is the class name de-suffixed + spaced, classes were
  renamed for clean output: `MathFnNode`→`MathFXNode` ("Math FX"), `NpvNode`→`NPVNode`, `IrrNode`→`IRRNode`,
  `GcdNode`→`GCDNode` (type = class name, so the three seeds + the personal-finance generator moved too).
  Remaining awkward family names backlogged (family-name polish). (A first pass wrongly pushed the family
  name through `nodeDisplayName` globally — reverted; family belongs only on the type-hint.)

### SESSION DIGEST (2026-09-13 — the decision walk; author present, two agents)

The author walked the "review with the author" backlog items one per turn; the Lead
(solenoid-0f) proposed, the author ruled, and every ruling that produced work went to Agent 2
(`be`) or Agent 3 (`fe`) and merged into `develop` when green. Nothing pushed. Rulings, in order:

- **compositesHoldUntilSolve** (Agent 2; the decision log). A composite in any Solve-button mode
  starts UNSOLVED on load, paste, create and a switch into a heavy mode; blank ports, stale dot on,
  driver readouts null, until Solve/Refresh. Plain single-pass composites stay live. Author: "people's
  intuition expects the value to already be blank/unsolved so they can see it work when they hit
  Solve." Pinned in `composite.test.ts`.
- **formatCarryPerOp** (Agent 3; the decision log, dte:D41 formatFlowsDownstream rewritten). The Lead's
  first proposal (exempt percent from ×/÷/^) was refuted by a 45-row fuzz: NPV of a 5% rate showed
  `123,456.00%`, COUNT inherited its list's style, integer `7 ÷ 2` showed `4`, `date − date` showed a
  1900 date, and the op class was never the axis. Ruling: a style survives only an op the node
  DECLARES meaning-preserving (`formatCarry()` in `src/graph/nodes/formatCarry.ts`, shaped like
  `passthrough()`; `unitFlow.ts` `carriedFormat` consults it, drops on ≥2 date-styled operands, and
  `compute` falls through `annotationFor` so MathFn abs/round carry). Declared: Arithmetic add/sub,
  the MathFn preserve set, RoundN/MRound/Clamp, Aggregate/Running dimension-preserving ops, EWMA,
  DateAdd, WORKDAY. Everything else (mul/div/pow, count/variance/product, stats, finance,
  Expression, Convert) carries nothing. **The harness stays** (author): `formatCarryReadability.test.ts`,
  70 rows, writes `.dev/format-carry-report.txt` for the author's eyeball on every run; grow it with
  every unit/format change. `unitFlowSeed` C flipped (× carries the value's unit, not the format).
- **List Input popup stays view-only** (Lead; `subsystem-invariants.md` § Literal input editors).
  Rows are the only editor; the chip's list popup keeps the shell resize grip, the orientation
  switcher and copy. The author's CSV-table idea (rows stored as CSV lines, CSV view = rows, grid =
  the flat list, output = the list) was discussed and set aside as a second editor for a node whose
  value is being simple.
- **TaskNotes read node stays** (Agent 2; `24-obsidian-vault.md` § F). The files cover
  title/status/priority/due/tags through Vault Folder; the API earns tracked time, recurrence and
  completed instances, the calendar, the stats, and Write Tasks needs it anyway. The Obsidian category
  copy carries the split; the TaskNotes description leads with what the files can't total. New seed
  `tasks-two-ways` (both reads side by side; tuned with `tune-seeds.mjs`).
- **Daily-notes targeting: skipped** (author disliked all three shapes: a Daily Note source node,
  a target choice on Write to Obsidian, Knap). The backlog line stays as "still shaping".
- **Widget Tier 1 follow-ups, all three** (Agent 3): Currency gains a Spot/History `mode` (named
  `mode`, not `op`: opArgDistinct keeps non-formula selectors off NODE_OPS) emitting ONE Date·Rate
  frame to chart, `fxRangeUrl`/`parseFxSeries` fixture-tested behind the C2 gate, sockets swapped via
  the op-card recipe plus a new generic `dropOutputCables`; Time Zone Convert From/To and World Clock
  Zones get an IANA `<datalist>` (`timeZone.ts` `IANA_ZONES`; `InlineInputs` `suggest` prop, still
  commit-on-blur); Time Zone Convert's result defaults to `datetime` via `annotationFor`, composing
  with formatCarryPerOp, a docked FC still overrides.
- **Chip + letter case stay exclusive** (author: "leave it alone"); backlog line deleted.
- **Chips were never tested — and were invisible where you set them** (Agent 2). An editable
  popup rendered every cell as a raw input with no chip branch. Now a chipped string cell shows its
  CategoryChip while unfocused (an overlay on the live input, `pointer-events:none`) and the raw text
  on focus, like a formatted number cell; Source mode stays raw. One `chipCols` + CategoryChip
  mechanism (B2.2); `chipStyle.test.ts` source-grep pin. Found by the Lead screenshotting the cubes
  seed's Regions column with a puppeteer script over the dev server in a fresh profile.
- **blankArgIsExcelBlank** (author: "map to Excel on optional arguments"; Agent 3 investigated, wrote no
  code before the wrap; the backlog line carries the handoff). A blank formula argument slot (`null`) is Excel's blank (0 / FALSE / ""), an omitted one
  (`undefined`) the default; one typed table at the formulajs boundary, internal overrides audited,
  TEXTJOIN ignore_empty the first row; the lookup family's "blank = omitted" convention goes.
- **Payment Breakdown** was already built (90903af4, 2026-09-07); its stale backlog line deleted.

**Open for the author (surfaced, unruled):** currency × a scalar now drops its 2-place format
(per the rule; a Display Format restores it; a unit-aware exception is possible but special-cases
the rule on the day it was made general); the older long-copy sweep (Decision Matrix, Sensitivity,
Allocator, Record layout, Chart values, Slider bounds, 200-plus-character catalog entries: run now or
at the release tail); ratifying `out-of-scope.md`; whether a seed should ship a chip column (cubes
Regions is the natural one); the exported webpage's rendering of a chipped column is untested.
Author eyeball list: the composites' blank-until-Solve on a saved document; the Currency
Spot/History toggle and its chartable frame; zone type-ahead on Time Zone Convert / World Clock;
an undocked Display on Time Zone Convert reading `2026-06-03 14:30`; cubes → Regions → Chip in the
popup (pill alignment); `tasks-two-ways` on desktop with the TaskNotes API on; the format-carry
report.

