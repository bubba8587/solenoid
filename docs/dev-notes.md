# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### OPEN PROBLEM (2026-07-25 — a choppy zoom BAND: interior range of scales, both extremes smooth)
Zoom chop is **not** monotonic in graph size or zoom depth. There is a specific interior range of
camera scales that is markedly choppier than BOTH very close zoom AND very far zoom. Observed by
the author on the Vercel preview of `develop` (desktop browser → DOM renderer; `drawElementImage`
is not in stable Chrome, so the HTML-in-Canvas layer never engages there). Not yet pinned to a
numeric `k` range — that is test T1 below.

**This supersedes the framing in `archive/performance-hardening.md`.** That doc's ledger is still
correct about what it measured, but every lever in it was tested without knowing a band existed,
so any ablation may have been run OUTSIDE the band and read as "negligible" for that reason. Treat
its negative results as *unconfirmed inside the band*, not as foreclosed.

**Ruled out — measured, do not retread:**
1. **The gesture-exit settle.** Held `ZOOM_SETTLE_MS` at 3000ms on a live preview (`dc96159`,
   reverted here). The band survived the long hold unchanged, so it is NOT the per-notch
   exit/re-enter scale-change repaint that 2026-07-20d diagnosed. That 420ms fix stays valid for
   its own symptom; it is not this one.
2. **Element count / DOM weight.** `semanticZoom` defaults OFF (`settingsStore.ts`), so at far-out
   zoom EVERY card is on screen and fully painted — and that is the SMOOTH case, while the choppy
   band has strictly fewer elements on screen. Element count is *maximal* in the good case, so it
   cannot be the driver. This also retires "unmount the semantic-zoom body subtree" and
   viewport-culling as fixes for THIS symptom (they may still be worth doing for load/idle cost).
3. **The HIC mip curve.** `computeIdealMipLevel` saturates to level 0 for every scale
   ≥ `1/(quality·dpr)` — so ≥0.5 on a dpr-2 display, ≥1.0 on dpr-1. Close zoom is pinned at level 0
   regardless of the curve, and `REF = 1` caps the source capture so raising `quality` cannot make a
   sharper texture either. Irrelevant on the preview anyway (HIC does not engage).

**Instrumentation (all live in a deployed preview, no redeploy):**
- `window.__solenoidPerf = true` → on each pan/zoom gesture end, `fpsProbe` (`Canvas.tsx`) logs
  frames, mean/fps, **worst frame + the `k` it happened at**, the **`k` range covered**, and the
  dropped-frame count. The `k` tagging was added for this problem — it is how T1 gets answered.
- `window.__zoomSettle = <ms>` → re-A/B the settle window (`zoomSettle.ts`, default 420).
  **Gotcha if you set this long in HIC mode:** `exitGesture` is timer-only and the holder is
  `visibility:hidden` for the whole gesture — which is not hit-testable — so nodes are unclickable
  for the entire hold. Harmless at 420ms, a dead canvas at 3000ms. A pointerdown escape in
  `onPointerDown` fixes it (was written and reverted with the experiment, `55b6449`); re-add it
  before running a long-settle test on the desktop build, and remember it perturbs touch pinch
  (one extra exit/enter at pinch start).
- `window.__hcMinNodes = <n>` → HIC engage threshold (weighted units) for the desktop-build tests.

**Tests to run, in order. T1 and T2 gate everything else — the rest are guesses until those land.**
- **T1 — Pin the band numerically.** `__solenoidPerf = true`, then zoom slowly across the whole
  range on a named seed (Famous Math, and Personal Finance as the lean control). Record the `k`
  values the worst frames cluster at, and the `k` where chop starts/stops. Deliverable: a
  `k_low–k_high` range per seed. Everything below is phrased against that range.
- **T2 — Chrome Performance trace inside vs outside the band.** The decisive measurement. Compare
  the time split across *Update Layer Tree / Paint / Rasterize / Composite Layers* at a `k` inside
  the band against one outside it. **If Paint+Rasterize dominates inside the band → T3/T4/T8. If
  Composite Layers / Update Layer Tree dominates → T5/T6.** Do not build anything before this.
- **T3 — Does the band track TEXT size?** Hypothesis for an interior maximum: visible glyph count
  grows as ~1/k² while per-glyph raster cost falls as glyphs shrink, so the product peaks in the
  middle — lots of glyphs that are still large enough to fully rasterize. Test: change the base
  font size (or the browser's own page zoom, which rescales CSS px) and see whether the band's `k`
  range shifts inversely. Band moves with text size → glyph rasterization is the driver.
- **T4 — Does the band depend on DPR?** Repeat T1 on a dpr-1 and a dpr-2 display (or force it via
  devtools). Raster work scales with dpr², so a band that shifts with dpr points at a raster-budget
  threshold rather than a content-count effect.
- **T5 — Does the band depend on the GRAPH BBOX?** The promoted holder's backing store is
  `graph bbox × k × dpr`. Compare graphs with the SAME node count but very different spread, and a
  small graph against Famous Math. Band shifts with bbox → the holder is crossing a tile/texture
  budget and the fix is to stop promoting a whole-graph-sized layer (viewport-sized layer, or cull
  the holder's content box). Known related datapoint: mobile holder promotion already tiles and
  flickers because `bbox × dpr` exceeds the mobile GPU max texture.
- **T6 — Is the promotion itself the mechanism?** A/B `holderEl.style.willChange = "transform"` in
  `onZoomActivity` (`Canvas.tsx`) on/off while zooming through the band. `performance-hardening.md`
  argues promotion makes content cost irrelevant; if the band DISAPPEARS un-promoted, the promotion
  is the mechanism (Blink re-rastering a very large promoted layer at its sharpness thresholds),
  and that reframes the whole problem.
- **T7 — Does the band exist in HIC mode?** Desktop build only (the Blink flag is wired there via
  `additionalBrowserArgs`). During a gesture HIC draws cards as cached bitmaps, so: band persists →
  it is not card content at all (look at cables/conduits or the compositor); band vanishes → it is
  card paint, and HIC is already the mitigation.
- **T8 — Content ablation INSIDE the band.** Re-run the two cheapest ablations from the old ledger
  at a `k` known to be inside the band: hide all cables, and hide all card bodies. Both previously
  read "negligible" — but see the supersession note above.

**Do not retry** (already eliminated, `archive/performance-hardening.md` "Reverted experiments"):
holder promotion on plain pan, `--zooming` quality drops on desktop, render-resolution scaling,
mobile holder promotion. Add to that list: the long zoom settle (1 above).

### SESSION DIGEST (2026-08-17 — Architecture map: overlay → real seed document; the Inspector)
- **The Architecture map is now a REAL DOCUMENT** (author-directed, after two overlay
  rounds rated mid): View ▸ Architecture map opens the generated seed
  `seedGraphs/architecture-map.json` via `documentStore.newFromTemplate` — one new
  `SubsystemNode` per architecture.md module group on the main canvas, real violet
  frame cables along the strong import edges, ELK positions, two Notes (what it is;
  the rules enforcement summary + gaps). The Subsystem node (nodes/subsystem.ts,
  kind=util, wide) persists its module table as `frameText` (no new persistence
  fields) and outputs it as a frame (module, role, imports; rows degree-ordered);
  its multi-connection `deps` frame input is data-inert BY DESIGN — the cables are
  the information. The SpecMapView overlay, specMapStore, and the virtual:arch-deps
  vite plugin are deleted.
- **Derivation chain, every link machine-pinned**: `scripts/scan-arch-deps.mjs`
  (relative-import scan, 603 files) → `specMap.ts` (docs parse; now incl.
  Why/Origin/Exceptions + per-rule module refs) → `archGraph.ts` (file → group from
  the doc's own tables/prose citations/dir headings; `archGraph.test.ts` pins
  UNMAPPED AT ZERO, so a new file demands its architecture.md home in the same
  commit) → `archSeed.ts` (drawn edges admitted heaviest-first and kept ACYCLIC —
  textForm's topo order caught the cyclic first cut) → `archSeed.test.ts` diffs the
  checked-in seed against a fresh derivation (`npm run gen:arch-seed` to refresh).
  Both guards fired the same day they landed (the Inspector's new files).
- **architecture.md reconciled to FULL source coverage** (73 unclaimed files given
  real homes: new rows across five tables, App-chrome prose extended, new Packs +
  Landing & showcase dir sections; `src/graph/`-prefixed citations now match).
- **The node INSPECTOR ships** (author-requested): `InspectorPanel.tsx` +
  `inspectorStore.ts`, the top bar's (i) button + View ▸ Inspector. A right dock on
  the pinned Report's chrome pattern (`html.sol-inspector-docked`, same canvas
  squeeze; the two right docks are mutually exclusive). Reads the ACTIVE surface's
  selected node: catalog description (`describeNode`), the Function Reference's
  generated rows READ by catalog type (`buildFunctionReference` — Excel syntax +
  parity notes, Add-menu breadcrumb, pack tags; one derivation, never a copy),
  and the node's socket roster: the REAL glyphs (`SocketComponent` reused — shape
  encodes type; no invented dots), `SOCKET_TYPE_LABELS` names, opt-in per-socket
  detail (`socketDocs.ts` static class map, Subsystem is the worked example), and
  any declared frame-input example table (`FrameHintTable`, extracted from the
  hover layer so both render one declaration). STATIC by author call, refined over three rounds: no live values (the
  card and its popups are the value surface), no live connections (the Cable
  inspector's job), and actions stay in the right-click menu — the Inspector is
  the static reference for the selected node and its current configuration. Selection polls (no push store, same as SelectionActionsBar).
  Recorded in layout-chrome + the alias table.
  ENTRY refined once more (author): the node context menu's description blurb is
  GONE in all modes, replaced by an (i) in the menu card's top-right that opens
  the Inspector focused on that node (`inspectorStore.openFor`; explicit focus
  outranks a stale selection until a new selection lands). On mobile that (i) is
  the ONLY entry (no top-bar button): the panel renders as a full-width sheet
  between the chrome envelopes, canvas squeeze off, HUD and nav pill yielding.
- **The chrome envelopes publish FLOORED heights** (author-confirmed on device):
  `top:`/`bottom: var(--chrome-*)` puts a panel's edge AT the published height,
  so publishing above a bar's true fractional height opens a subpixel gap
  (Chrome Android's 1px gap under the mobile Inspector sheet). Floor tucks the
  edge beneath the opaque bar (bar z 100 over panel z 90). NOTE the first fix
  shipped as ceil — the sign was INVERTED and ceil guarantees the gap; the
  corrected geometry is written into layout-chrome.md's envelope section.
- **Socket-docs sweep (author-directed fan-out, 7 parallel agents)**: 119 node
  classes now carry `static socketDocs` — every sentence verified against the
  `data()` code or shared kernel, DESIGN §7 voice, opt-in bar held (dynamic-key
  sockets and label-sufficient sockets deliberately skipped; agents reported their
  skip lists). Landed as slices 1-7 (one commit per completed agent). The sweep
  also surfaced real drift: Text Filter's `contains` meta said case-sensitive
  against the D12 case-insensitive kernel (FIXED), plus four divergence flags now
  in the backlog (FACT's wired-blank k, finance basis codes, ISPMT sign,
  FIXED/DOLLAR negative decimals).
- **The Playwright eyeball loop is now standing practice** (author sanction recorded
  in CLAUDE.md, superseding the screenshot ban). It caught, across the session: a
  setPointerCapture-on-pointerdown click swallow, backwards cable semantics, ELK
  scattered by weak edges, invisible rest cables, an empty-neighborhood dim, and the
  seed's overlapping first layout (card heights underestimated the frame preview).

### SESSION DIGEST (2026-08-17 — wrap styles: prose gets `pretty`, shaped blocks get `balance`)
- **The Wrap Rule is now DESIGN.md §3.** `balance` for short blocks read as a shape (doc
  headings, dialog messages, toasts, the sentence-length node-card empty states); `pretty` for
  running prose (`.sol-md` paragraphs and list items, the socket-legend and Inspector
  descriptions, the Reference catalog's expandable description row, What's New bodies,
  Settings notes). Applied at each component's own rule, ~20 declarations.
- **Only the `text-wrap-style` longhand ships.** The `text-wrap` shorthand also sets
  `text-wrap-mode`, so it silently resets a `white-space: nowrap` on the same element into
  wrapping text — `.solenoid-alert__msg` is one ellipsis-clipped line by design and was the
  live example. `cssSyntax.test.ts` gained two guards (no shorthand anywhere; every
  `text-wrap-style` is `balance`, `pretty` or the `auto` reset). The landing page's three
  pre-existing shorthand uses were normalized to the longhand so there is one idiom.
- **Note and Report bodies set `pretty` on the CONTAINER** (`.solenoid-note__rendered`,
  `.report-preview`), by author request. The property inherits, so it reaches table cells and
  whatever bare text `marked` emits rather than only the `<p>`s; embedded notes inherit it from
  the preview. `.sol-md pre` resets to `auto` — code wraps greedily. Safe only because each
  surface's editing textarea is a SIBLING of the rendered view (`.solenoid-note__body`,
  `.report-source`), so prose never rebreaks under the caret.
- Measured in the real app at a 300px card (playwright, live stylesheets), because two
  plausible worries were both wrong. `overflow-wrap: anywhere` on the Note body does NOT
  disable `pretty`: greedy `[260,275,35]` → pretty `[260,259,51]`, i.e. "its inputs." instead
  of a stranded "inputs.". And a first probe that toggled the style on the CONTAINER showed no
  change at all — `.sol-md p` declares its own `pretty`, which beats an inherited value, so the
  comparison has to be made on the element that actually wraps.
- **13 hard-wrapped lines swept out of seed Note bodies** (author spotted them in the
  Architecture map). Every Note/Report surface parses with `breaks: true`, so a newline INSIDE
  a paragraph is a literal `<br>`: the prose was frozen at the ~70-column wrap of whoever typed
  it and could not reflow to the card at all, which is what made the `pretty` work above
  invisible there. `arch-note` (6) and `arch-enforcement` (1) are GENERATED — fixed in
  `archSeed.ts` (one string per paragraph, `join("\n\n")`) and regenerated, so the next
  `gen:arch-seed` cannot reintroduce them; `sudoku-solver`'s note (6) was hand-edited.
  Verified through `marked` with the real options: 13 `<br>` before, 0 after.
- **`seeds.test.ts` now guards it** ("prose bodies have no hard-wrapped lines mid-paragraph"),
  over every `NoteNode`/`ReportNode`/`ImportObsidianNode`/`PresentationNode` `body` in every
  seed. Structure is exempt: blank line between paragraphs, list items, table rows, fenced
  code, and a heading closing its own block.
- The false positives that make a naive scan useless here: `frameText` newlines are CSV ROW
  SEPARATORS (a naive sweep flagged 647 of them across the seeds, all of which must be left
  alone), and `# Heading` followed by prose is two blocks, not a break. Only `body` on a prose
  node type is in scope. `src/graph/help/*.md` is also NOT affected — `Markdown.tsx` parses
  with `breaks: false`, so hard wraps there are ordinary markdown authoring and stay.
- Not reachable: hover tooltips are native `title=` attributes, which the browser renders and
  CSS cannot touch. Nothing to do there short of a custom tooltip component (feature work).

### SESSION DIGEST (2026-08-17 — chrome fills went opaque; the frosted-glass layer is gone)
- **`--panel-bg` / `--overlay-bg` are now `var(--surface)`** (`App.css`), so every bar, panel
  and floating overlay is the raised surface rather than a 90–98% window onto the graph. The
  light-theme overrides for both are gone (the alias follows `--surface`), and `palette.ts`
  no longer derives them — a palette's own `surface` carries them, so they left
  `DERIVED_CHROME_VARS`.
- **Every `backdrop-filter: blur(8px)` is deleted** (top bar, status bar, Navigator ×2, zoom
  pill, mobile bottom bar, web-demo banner, align bar, Conduit toolbar): behind an opaque fill
  it painted nothing and still cost a re-rasterization per frame. Modal SCRIMS keep their
  1–2px blur — there the translucency IS the effect. DESIGN.md §1 rejects glassmorphism
  outright, so this is the system converging on its own rulebook.
- Two consequences the blur used to own, re-pinned: TopBar's stacking context is now its
  `position` + `z-index` (`MenuBar.css`, `docs/layout-chrome.md`), and the Navigator list's
  layer promotion is plain scroll containment, not a blur-rerasterization dodge.
- `mobile.css`'s opaque `.solenoid-topbar` override and the dead `rendererSpike.css` (nothing
  imported it since the renderer spikes were deleted 2026-08-09) are both gone.

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep 2026-08-17: through the 2026-08-16 window — the formula-surface,
op-vs-arg, drill-in, value-selector and Save Times sessions). `git log` is the
per-commit record.
