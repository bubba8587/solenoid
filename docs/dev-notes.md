# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-11-09c: open-latitude fixes after 1.6, the headless runner for agents; cloud session)
- **Align, Distribute and a card opening end with the No-Overlap Pass** ([[C112]] noOverlapsEver; `selectionOps.ts`
  `settle`, `cardsExpanded`), the cards just placed or opened holding still.
- **A Chart plots a table** (an HSTACK, a matrix) as the frame of its columns, one row as a list; it drew an empty plot
  (`nodes/visual.rs` `chart`, `chartTable.test.ts`). **List Input keeps a typed gap** (`1,,3`) as a blank item
  (`list_row_items`). **`+3 days` reads as a relative date** (`is_relative`'s signed count).
- **SUMX2MY2, SUMX2PY2, SUMXMY2 count a logical in a pair** ([[D108]] aggregatesCountLogicals, which now names them);
  a pair holding text is still skipped, the author's call (backlog).
- **`run-graph` for agents and scripts**: it takes shot-graph's short form, `--set name=value` types into an input
  card, `--out name` prints only that card, `--formula` answers one formula; a card answers to its document name (the
  text form's `Name:`) or id before its label, and an unlabeled card's output is keyed by that name.
- **One text file goes from an idea to checked answers and a picture** (the `build-graph` skill): `ai-grounding
  --list` / `--card <words>` look a card up, `validate-graph` refuses what the app would drop or ignore, `run-graph`
  prints plain JSON (ISO dates, a table as its rows; `--raw` the engine's values; [[C137]] datesNeverSerials),
  `validate-graph --json` and `shot-graph` take the text form. The script launcher drains its output before exiting
  (a pipe cut anything past 64 KB).
- **Every card setting's choices come off the types** (`scripts/setting-choices.mjs` → `src/graph/settingChoices.json`,
  214 settings on 169 cards; `../tree/specs/floors/node-classes.md`): the validator refuses a value outside them and the grounding
  lists them. GROUPBY, Rollup and Group Lists' aggregator is `agg`, which both now say ([[C26]] opArgDistinct); the
  validator had checked it under `op`, a field those cards never read.
- **The No-Overlap Pass runs inside a group** (`settleMemberOverlaps`), the box growing over a member pushed past an
  edge: [[C112]] noOverlapsEver has no Unenforced bullet left.
- **Get Column answers `#REF!` for a column the table lacks**, naming the columns it has; it answered a blank that a
  SUM showed as 0.
- **`CLAUDE.md` opens with what the project is for**, in the author's words of 2026-11-09 and a model's account of
  what holds.
- **Local File reads a whole folder** ([[B11]] maximalMerge; `../tree/specs/computation/live-connections.md`
  § A folder as one table): a name with `*` loads every matching CSV and Parquet file as one table with a File column,
  a file that doesn't read named under the status line. `run-graph --data <folder>` runs Local File headlessly. Untested
  in a desktop build.
- **One standalone `solenoid` command** (`npm run build:cli` → `dist-cli/solenoid.mjs`, Node only): `guide`, `cards`,
  `validate`, `run`. From inside a vault it reads a folder of notes, filters and groups it in half a second.
- **A text-form line builds the rows it names** (`withImpliedRows`, `textFormRows.ts`): a filter's `condConfig` alone
  ran as the default `gt`, since a card read per-row settings only for the rows `valueKeys` named.
- **By-Row runs live or on Solve** (`byRowLive`, the Composite's By-Row editor; `../tree/specs/computation/composite-nodes.md`
  § By-Row): the author's answer to many things through one transform. A list of tables through a live By-Row
  Composite comes out trimmed table by table.
- **A new leaf is checked against the author's test by a hook** (`.claude/settings.json`: an agent reads `dte.md`
  § What is a leaf and what is a spec and refuses a description or a restatement of the parent). D126, which only
  described the folder read and applied [[B11]] maximalMerge, is retired.
- **A folder's files go through one transform each** (`../tree/specs/computation/live-connections.md` § A folder as one
  table): Local File's `files` output is a Cube, a row per file with its table; a live By-Row Composite runs once per
  row; its answer is a Cube with a table per row, which Unnest stacks. `scripts/shot-graphs/folder-each.json` is the
  whole chain.
- **One value per pass is typed as what it is** (`seriesTypeOf`, `../tree/specs/computation/composite-nodes.md` § Run
  modes): By-Row, Scenarios and Data Table outputs are a value's list, a list's table, or a Cube for tables, where the
  socket kept the inner type.
- **Unnest keeps every nested table's columns** (it took the first table's and dropped the rest's without a word).
- **Join takes a Cube and carries its lists and tables** by row number (`join_side`, `with_nested`), and
  **LINKNAME / LINKPATH** read the note a link names: a vault's tasks join to the project notes they link in one step.
- **A cloud container can start hundreds of commits behind `develop`** (this one was 352 behind, a shallow clone): `git
  fetch origin develop` and compare before the first edit, or the first push is refused and the fixtures and wasm are
  redone on the new base.
- **A drill-in undo or redo never leaves a marker without a port** (`adoptMarkerPorts`, on the step and on leaving
  the level; `compositeLeaveLevels.test.ts`).
- **`run-graph --formula --set` takes a list or a grid** (`--set 'm=[[1,2],[3,4]]'`) and refuses a name the formula
  never reads.
- **INDEX's whole column was changed to a column and put back the same day**: the author was holding it. The backlog
  line has what the try showed (right in a formula, splits the card). `CLAUDE.md` § Reflexes now says a change that
  moves a saved graph's answer is the author's call.
- **LET stays out of the formula language, on purpose** (author 2026-11-10): every name in a formula is already a
  wireable socket, so naming a value is what a cable does. It was added and reverted the same day; the reason now
  sits in `tree/specs/computation/formula-language.md` § Blocked and wrong-surface names.
- **The strict validator refuses a setting of the wrong kind** (`ValueInputNode value=3` read as 0 with no word; it
  now says `write value="3"`), and `validate-graph` reports a missing `---` line where it used to crash.
- **The card reference lists every input that takes a typed value** (`aiGrounding.ts` asks `literalFieldOf`, as the
  canvas does): GROUPBY's `keys` and 77 other cards' fields were born empty and went unlisted.
  `aiGroundingInline.test.ts` holds each listed key to what the validator accepts.
- **A note's body is data** (`noteBody.ts`, Vault Folder's "From each note" boxes): Tasks gives `note-tasks`, a nested
  table of every checklist item with its done mark, dates, priority, tags, heading and line; Tables gives
  `note-tables`, the note's pipe tables stacked and typed as an import is; Fields reads Dataview's `key:: value` as
  property columns. Backlinks gives `backlinks`, the notes anywhere in the vault that link to each note
  (`resolveLink` finds a link's note as Obsidian does). All four are off until ticked. The example
  `vault-note-bodies` runs them on the sample vault.
- **Write to Obsidian has a Tasks target**: each row ticks or unticks one checklist item by `path`, `line` and `done`,
  changing the one character between the brackets (`planTaskMark`, `setTaskMarks`); a line that is no longer the item
  read is refused. A property write leaves out `note-tasks`, `note-tables` and `backlinks` and never copies an inline
  field into the frontmatter (`resolveKeyOrField`).
- **Edit Frame changes a computed table's cells by hand** (`tree/specs/computation/edit-frame.md`): its popup
  takes typing and ticks over the table with its edits applied, rows and columns fixed (`fixedRows`); each changed cell
  is kept as `{ row, column, value }`, the row found by its Key columns' text (`path, task` for a vault's tasks), so
  an edit follows its row through a reorder. Stale and ambiguous edits stay listed and change nothing; an edit the
  table now gives on its own drops (`settled`, `coreWatched`). The edits list as Pipeline's steps, 20 shown and the rest
  counted; the Edits output is the edits as a table (column, row, previous, new, status).
- **Replace Values writes NaN for a replacement its column can't read** ([[C58]] tableInputRawText; `coerce_replacement`,
  `frame_verbs.rs`): it skipped the whole column with no notice. The card never errors over one replacement; the
  frame holds the truth, and a total over the column says so.
- **A tiny transformer, a new example** (`seedGraphs/tiny-transformer.json`, Worked examples): one layer and one head
  over *the cat sat on*, every step an Expression card whose formula reads like the paper's (`MMULT(Q, TRANSPOSE(K)) /
  SQRT(4) + mask`, a softmax as `e ^ s / MMULT(e ^ s, SEQUENCE(4, 4, 1, 0))`); attention and the next-token
  probabilities draw as labeled heatmaps. Building it found `EXP` refusing a matrix (backlog § Formula library).
- **A new feature is never a new leaf** (the author, 2026-11-10; `docs/dte.md` § What is a leaf and what is a spec,
  `CLAUDE.md`, the leaf-check hook): a feature and its design go in its spec; a leaf is added unasked only for a
  product decision (the author overriding conventional wisdom, or answering a contested, high-stakes question).
- **Import Obsidian Note mints `note-tasks` and `note-tables` outputs** when the note has a checklist or a table
  (`bodyFields`), beside the outputs its frontmatter gives.
- **Unnest's output takes its value's type** ([[C136]] typesKnownAfterCalc): it was the fixed untyped socket, so a
  cable leaving an Unnest never showed Frame or Cube. It is a `valueTypedOut` now, and
  `cablesTypedAfterCalc.test.ts` holds every example to the rule that a cable carrying a value is typed at both ends
  once it has run. `staticTrueAnyOut` is left to NA alone.
- **Vault Read and TaskNotes have specs** (`tree/specs/integrations/vault-read.md`, `tree/specs/integrations/tasknotes.md`). Writing them
  found that a note's own `date` or `created` property never reaches Vault Folder's Cube (backlog § VaultBridge).

### SESSION DIGEST (2026-11-09b: two pre-1.6 safety fixes; cloud session)
- **The desktop's fetch is `net_fetch`** (`src-tauri/src/net.rs`), the http plugin gone: what someone else wrote stays
  off this computer and the local network by the address a name resolves to, on every redirect, with no proxy between;
  the user's own documents reach it again (TaskNotes on localhost was refused on desktop since F1). A card pasted out
  of a foreign document carries `elsewhere`, which no Allow clears: its File Link asks and its fetches stay off the LAN.
- **A type switch in Obsidian's Update dialog keeps every value**: a nested list or table becomes its JSON text where
  the new kind holds only scalars (`keptCell`, `yamlValue.ts`); only column names go, on a switch to a list or matrix.
- **The plugin has its own engine module** (`build-wasm.mjs --plugin`, the `plugin` feature): main.js 1.8 MB, was 12.9.
  **`npm run plugin:lint`** runs Obsidian's review config over the exported snapshot; it holds 0 errors (68 warnings
  stand, each asking for an Obsidian-only global). 0.1.7 to 0.1.9 shipped today; tags and Actions runs stay the author's.
- `src-tauri` compiles and tests here after `apt-get install libwebkit2gtk-4.1-dev libxdo-dev
  libayatana-appindicator3-dev librsvg2-dev` (clippy, `cargo test --lib`, shared check target); no AppImage was run.

### SESSION DIGEST (2026-11-09: the Obsidian plugin's export caught up; cloud session)
- The plugin snapshot builds from source again, Rust included: `plugin:export` carries the wasm engine as the files
  `wasm-stamp.mjs`'s `sourceFiles()` hashes plus `rust-toolchain.toml` and `build-wasm.mjs`, never the compiled module;
  the snapshot's `npm run build` runs `build:wasm`, `tsrs --noEmit`, then Vite, and its release workflow installs the
  pinned Rust and `wasm-bindgen-cli`. Exported to `Solenoid-Properties` `develop`; a clean `npm ci && npm run build`
  there passes (about a minute of cargo). The version stays 0.1.6 until the author says release.
- Two plugin-build bugs fixed (`oneWasm` in `obsidian-plugin/vite.config.ts`): the `cjs` build turned
  `new URL(wasm, import.meta.url)` into a base of "undefined", which throws as `main.js` loads (the plugin could not
  load at all); and the glue's own fallback URL inlined the 9 MB module a second time (main.js 25 MB to 12.9 MB).
- The `frameBackend` and `activeGraph` stand-ins had drifted from the modules they replace (new exports, `FrameRef`,
  `getActiveView`); they keep the real signatures again. `src/*.d.ts` (`focusgroup`) and the `@solenoid/gantt-layout`
  workspace package now travel with the snapshot; `dompurify` is pinned (Note HTML is bundled).
- Checked in headless Chromium with a stub `obsidian` (not the rig: no Obsidian here): onload in ~300 ms, all 13 types
  register, chips and the Frame editor render, a date column reads through the core. Real Obsidian is still unchecked.
- Open: `eslint-plugin-obsidianmd` 0.5.1 on the snapshot finds 100 errors (0.1.6's snapshot: 113 under the same
  version), so its rule set is stricter than what passed review; new kinds since 0.1.6 are `prefer-window-timers`
  (`PopupSkeleton`, `connectionStore`, `noticeStore`), `no-unsafe-*` (`graphEditor`, `dataflowEngine`, `engineWasm`,
  `nodeInit`, `nodeBoundary`), `no-static-styles-assignment` (`themeColor`, `columnHeadControls`). The bundle's Rust
  crates' licenses are not in the snapshot's third-party file yet (`scripts/rust-licenses.mjs` covers the app's).
- The plugin's What's New tab, the funnel to the app ([[obsidian-plugin#What's new]]): opens on install, each plugin
  update and each new app deck (`WHATS_NEW_VERSION`), with a settings toggle and a command. Plugin notes for 0.1.7 are
  drafted in `pluginNotes.ts` (one entry; the author's to extend), shown once the manifest says 0.1.7; the app section
  imports the 1.6 slides.
- Checked in real Obsidian 1.14.5 through the rig (dark, light, the phone emulation): the What's New tab opens on a
  fresh install, every chip and editor renders as on the site's `/obsidian` page, settings show the new toggle, no
  errors. The rig now falls back to Xvfb where there is no Xephyr, so it runs in a cloud session.
- The Solenoid look, reviewed in real Obsidian (1.14.5 updating itself to 1.15.0), two passes, desktop and the phone
  emulation, dark and light: notes, callouts, tables, code, the explorer, tabs, sidebars, command palette, quick
  switcher, menus, modals, search, settings, graph, canvas, bases, hover previews, notices. Six fixes in `look.css`, each
  in the spec: the active sidebar tab lost its box (1.14 fills the tab itself), the top line crosses the sidebar resize
  handles, a focused explorer row takes the hairline over Obsidian's 2 px ring, a base's grid is the Frame hue and its
  number cells don't box (1.14 reads the note table's border variables there), and a folded Properties card is its header.
  Still open: the phone code block's copy button sits over the first line's end (Obsidian's own placement).
- Look passes 3 to 5, with Obsidian's developer docs as the checklist (the CSS variable reference, the theme guidelines,
  the October self-critique; `obsidianmd/obsidian-developer-docs`) and 1.15's own `app.css` to see which variables it
  reads: the look sets every color variable Obsidian derives from its gray ramp but a handful (modal cover, notice,
  tooltip, drawer, prompt, dropdown, slider, toggle thumb, scrollbar), none of which showed off-tint under Orchard or
  Blueprint. Fixed: the divider between side-by-side panes now carries its pane's line; Outgoing links' sections are
  section headings; `kbd` is the app's key; the Live Preview rule takes padding, not margin; callout titles take an ink
  worked out from their header color (measured WCAG contrast over 9 palettes x 2 modes: 2.3:1 at worst before, 5.2:1
  after). The look has no `!important`; its 24 `:has()` are all direct-child anchored. Checked and left: Solarized's
  dim chrome text (3.3 to 4.5:1) is the palette's own design; a base's Cards view stays neutral.
- The Properties card reads as a node card (author: its header was too weak): the fill was already the node header's
  tint; what it lacked was the node frame's 2px accent cap and the `--mix-ink` title the Reference's boxes and the
  cards carry. The body stroke is now neutral in dark, the accent's dark shade in light, as `nodeCard.css` draws it.
- Phone sidebars and dialogs against the app's own (screenshots of the dev server's Navigator, Settings, menu sheet and
  Reference, desktop and phone): a settings page's group headings are the app's section captions; desktop dialogs are
  the app's dialog (panel hairline, divider under the header, 14px title) while menus and the palette keep the overlay
  border; a phone dialog stays Obsidian's bottom sheet; Delete takes the callout ink rule (5.3:1); the phone drawer's
  view picker marks the active view as the app's Navigator does, and its vault name is the brand mark.
- The phone drawer's button pill (author: broken borders): Obsidian runs it the drawer's full width, so the look's
  pill lost its ends; its floating nav cleared the fill and drew the list's fade inside it, over the outline. It insets
  to the view picker, keeps its fill, and the fade moves above it.
- Gray on tints (author): an in-page scan for neutral text or icons on a tinted background found five, each fixed to
  its tint's ink: the Properties chevron (through Obsidian's collapse-icon variables), a base header's sort chevron and
  its column separators (the header row sits in `.bases-view`, outside the table container the earlier fix targeted),
  a picked menu item's icon, a picked file's badge, the phone drawer picker's chevron. Re-scanned clean on desktop,
  settings (six tabs) and phone, both modes.
- Weak tints (author): a scan for tinted fills under 40% of full strength without a strong edge, then the app's rule
  (a wash gets a full edge, as a selected group row does; a header-tint fill reads alone). Picked rows, tags, quotes,
  note tables and the active tab got full-strength edges (dark: the color; light: its 12%-darker shade,
  `--sol-edge-shade`); idle tabs went neutral with their type's glyph; a base header got the Frame's 2px cap.
- Still weak (author), measured against the app (not the Navigator): the look's colors matched the app's to the value;
  the difference was the ground. The Reference's landing puts its boxes (surface) on the canvas; a note put its cards on
  the surface they are made of. The note page now takes the canvas; the explorer's names read in the text color (the
  Reference's lists), and property labels are 500 weight (a node card's labels).

### SESSION DIGEST (2026-11-08: per-frame camera work trimmed; cloud session)
- A source read (no measuring) of what runs on every pan and zoom frame; four pieces of dead work went, each with its
  rule in its spec: the selection mirror scans only on a new `nodes`/`edges` array (`flow/selectionMirror.ts`, not RF's
  selection hook, which walked every node and edge per frame); the view keeps no canvas pointer position (nothing read
  it, and it cost a layout read per pointer move); the corner grip drives `XYResizer` itself with no store subscription,
  as the socket handle does; standoff bars and the HTML-in-Canvas frame loop skip their card walk while RF's `nodes`
  array is unchanged. Findings 4 (cables) and 5 (minimap) of `canvas-frame-cost-findings.md` stay open by the author's call.
- React Flow 12.12.1 is on `develop` (handle and resize control unchanged, so the app's copies still match). RF
  13.0.0-next.3 is ported on `bleeding-edge` as an `Edge:` commit: its split stores take every per-card and per-cable
  selector off the camera, which is finding 4 solved upstream. Port it with `port.mjs` once 13.0 ships stable.
- The HTML-in-Canvas change is unexercised in a browser (the mode needs a Chromium flag); the grip and selection were
  checked on the live canvas.
- The local `develop` here again held the 50 Android commits no remote holds; kept as `develop-stale-local` in this
  container only.

### SESSION DIGEST (2026-11-07: live multiplayer researched; cloud session)
- **Bundle 27** (`v2.0/27-multiplayer.md`, plan-only) is bundle 21 Stage 3's new home: link rooms with no accounts, a
  Loro CRDT at the `serializeGraph` boundary keyed by room-only sync ids, tables as rows × columns × raw-text cells,
  an encrypted dumb relay on Durable Objects, every client computing. netcore-rs is untouched by design.
- **Facts that steer it:** WebKitGTK (Linux desktop) has no `RTCPeerConnection` until about 2.56 (so no P2P-only
  design); hosted PartyKit shut down 2026-10-23; y-sweet stalled after Jamsocket joined Modal.
- **Step 1 stands alone:** `applyGraphDelta` would end the full `loadGraph` behind undo and the AI apply. Five author
  calls wait at the bundle's end.

### SESSION DIGEST (2026-11-07: function records, the Text family organized; cloud session)
- **Function records** ([[C140]] functionRecords, `tree/specs/computation/function-records.md`): one Cube-form record per function under `fixtures/functions/`, Excel's answer beside Solenoid's, a kind of truth, a verdict and a citation per case. Excel's answers come only from a workbook Excel saved, through `from-excel.ts`, which refuses anything else or a wrong calibration sheet.
- **Text is organized**: 33 records, 43,771 cases (the old tests and specs, IronCalc's workbooks vendored under `fixtures/functions/sources/ironcalc`, the edge grid); `harvest.json` gives every mention a case or a reason. No answer is filled: the run waits until every family is organized.
- **Traps the workbook handles**: bound values sit in cells, not constants (Excel reads them differently); every formula is a marked dynamic array (an unmarked one is intersected); Excel's `_xlfn.` prefixes come from Excel-saved files; arrays come back through ARRAYTOTEXT beside a shape cell.
- **Viewer**: the Excel Coverage tab's parity mark opens a function's record in the Cube popup.
- Develop was rewritten upstream mid-session; 50 Android commits no remote held were kept on the local branch `backup/android-local-2026-11-07` in the session's container only.

### SESSION DIGEST (2026-11-06: audit and bug hunt; cloud session)
- **Saves:** a text holding half a surrogate pair made the core read the save as null, so every save, autosave and undo snapshot became an empty document; the writer spells such halves U+FFFD and `textFormWrite` answers an unreadable save with `!`. The per-card `foreign` mark rides the text form's positions table ([[save-format]]).
- **Shared documents** ([[B18]] safeToShare): every picture path holds through `webUrl.ts` (the browser's URL parser decides what is the web); markdown text values use `sanitizeNoteHtml`; table-cell pictures go through `WebImage`; SVG `href`, `background`, `<style>`, `image-set()` and `@import` are held. An AI rewrite can't clear a mark (`keepCardTrust`). The Script worker's file is served with its own CSP (`vercel.json`) and a newly loaded graph retires the worker. File Link asks before UNC paths and more Windows launchers.
- **Desktop documents:** a write-through marks the copy's own time, so a mid-pass edit stays unsaved; opening a file a document keeps opens that document; a future `savedAt` is capped at now; `fileStem` drops leading dots, trailing dots and Windows device names.
- **Elsewhere:** binary reads/writes and Open go through the path's provider (Android granted folders, the demo vault); the file picker keeps its cursor through a background relist; Write to Obsidian refuses error cells and calls a value the note already holds unchanged; criteria fast paths read numbers to 15 digits as the scan does, a `"true"` criterion ignores case, and the SUMIFS card totals exactly; a wrapped group member's group holds the composite, and paste/unpack rebuild group tints.
- **Open:** the author's calls are the backlog's 2026-11-06 audit section. The author is building a formula test set in another session; no new card/formula tests were added after that.

### SESSION DIGEST (2026-11-06: pre-1.6 cleanup sweep; cloud session)
- **What went:** one-off probes nothing ran (chart-contact-sheet, heap, layout, undo-drift, gantt-shots, touch-pan,
  formula-node-parity), the orphaned `relativeDateCorpus.ts`, `.impeccable/`, the bitmap fonts in `public/fonts/`, the
  Unit Flow gallery thumbnails (`site-shots --thumbs` remakes them when P16 lands), three stray `assets/` files, the TS
  `guardFinite` (the core's `guard_finite` is the spec), `triangleOps.ts` and four unused exports, about 30 CSS classes
  nothing renders, all 52 `eslint-disable` comments (no eslint runs here), redundant per-file clippy allows, dated
  "author's Excel" stamps in non-test Rust comments (the conformance tests hold the measurements), and 25 archive docs
  plus review-plan, python-r-gap, upstream-formulajs, the crate audit and `docs/plans/`. Open boxes from review-plan
  and python-r-gap moved to the backlog; 17-matrix-formulas' B-table moved into [[formula-language#Broadcasting]].
- **Fixed on the way:** `package.json` had `test:core` twice (the cargo one stands; the TS tier is
  `npm run test:bucket core`); `tests/buckets.mjs` lost the regex names an earlier rule always claims (no file moved
  bucket); two stale `ISOLATED` entries left `vitest.config.ts`; 1.6-plan holds only what is left.
- **Kept on purpose:** the perf probes an open backlog or deferral item names, `scripts/shot-graphs/`, the demo videos,
  `docs/google-style/` (the author's call), `stillGranted` in `androidFolders.ts` (unused, but the Android grant check
  it is for is new), the `__hcDiag` / `__hcProbe` diagnostics (`tree/specs/canvas/html-in-canvas.md` documents them), `build:wasm:opt`
  (the author's release step).
- **Module headers** are two lines at most in 82 files (`tree/specs/floors/engineering.md` § Comments): what the spec
  already said went, a sentence about one item moved onto it, and noteHtml's network-gate rule moved into
  `tree/specs/documents/reports-and-notes.md`. The palette's OKLCh comment points at DESIGN.md, which holds the ruling.
- **Also:** 203 types only their own file names are no longer exported (the packages' public API kept); the docs
  pointer check now reads backticked `../` paths too; `.gitignore` lost two patterns nothing writes.
- **Open:** `.claude/settings.json` allows `npx tsx scripts/parity.ts` and `npx tsc *`, both stale.

### SESSION DIGEST (2026-11-06: geometry figure cards, pack seeds and examples, pack constants, formula layout, the Element card; cloud session)
- **Geometry figure cards** (the author 2026-11-06): Triangle Solver, Unit Circle, Circle Solver, Regular Polygon,
  Two Points, Polygon from Points and Solid. Each is a frame in (or its own keyed `frameText`), a frame out, one row per
  figure with a unit per column; XWide, the figure in a Recess, the Record pager, the Preview. Rust in `nodes/geometry.rs`
  (`FigureTable`, `Measure`), TypeScript in `GeometryFigure.tsx` and `GeometryCards.tsx` (`FigureCard`). A size the
  solve didn't need is checked, a mirror pair is `#SOLVE!`, text in a part is `#VALUE!`. Unit Circle answers blank where
  a function is undefined, says so in its card warning, and has exact values every 15°.
- **Direction** (the author 2026-11-06): Solenoid should be broadly usable in education, STEM above all. The figure
  cards (exact values, every part keyable, honest "two answers fit" errors) and the Element card are built that way.
- **Every pack ships an example seed** (`Pack.seed`, `seedGraphs/packs/`, written by `scripts/gen-pack-seeds.test.ts`),
  offered under Packs while the pack is on; each charts what it computes (`frameOf` + `chart`), but Geometry's figures
  and Timesavers' QR code are already the visual. Comparison is core. **Seeds open as examples** (`SolDoc.seed`): out
  of the file tree until changed and kept, "Discard changes?" on leaving an edited one (`requestChoice`).
- **Pack constants are cards** ([[C76]] formulaPackDefault, `pack-architecture.md` § Physical constants): a preset
  names a physical constant as a variable and declares it (`constants`); placing the card places a Physics Constant
  cabled in (`companions`, `src/graph/companions.ts`, both placement paths). The variable is required (`varRequired`,
  `nodes/formula.rs`): cut and untyped, it answers `#SYNTAX!` naming it, never a hidden CODATA copy. Physics Constant
  is a core card the five physics packs tag. Empirical fit coefficients stay in their formulas.
- **Every preset input has a description**, its name and unit and nothing else (author 2026-11-06); `packs.test.ts`
  fails on a bare one.
- **Formulas lay out by their parentheses** (`formulaLayout.ts`, [[formula-language#Editor support]]): tab indents,
  Enter indents by the open brackets, a closer on a blank line dedents, Shift+Alt+F lays out the whole formula. Presets
  arrive laid out; a card's narrow formula field shows one flowing line. The popup's editor has its own resize grip.
- **The Element card is the periodic table** (`data/elements.json`: PubChem's properties, IUPAC weights;
  `nodes/elements.rs`): a symbol, name or atomic number in, or a list of them; g/mol, Z and a 19-column Elements frame
  out; `ELEMENT()` answers every property. The picker is an edge-to-edge table tinted by category (palette series
  slots, inset borders) with a detail panel and legend.
- **Smaller:** Blueprint and Orchard pull every color toward their home slot (a standing derivation); Value Input's date
  mode takes the medium width; chart markers are solid dots in the series color.
- **Open:** a Chart fed a table (not a frame) plots nothing, silently (`values: [null…]`), where it should plot or say
  why. Earth's radius is still a number in the haversine and horizon presets (no Physics Constant op for it).
- **Save is autosave done now** (author 2026-11-06, `saveNow`): Ctrl+S captures and says "Saved"; on an example it
  asks, then keeps it in the tree named in place (`treeRename.ts`); on desktop a file-bound document writes through.
  Save As is the export. No Keep button.
- **The 1.6 desktop session** (the author 2026-11-06): the develop build's Linux AppImage runs headless here
  (`Xvfb`, `xdotool`, a throwaway `HOME`; the cloud app can't start Actions runs, the author does, and artifacts download
  through the GitHub tool). F2 verified, F1 landed (dot-dirs closed everywhere, local network refused, Parquet async and
  capped; fs-to-picked-folders after 1.6), F12 landed (every kept desktop document a file, autosave writing through).
  A local `npm run tauri build -- --no-bundle` (about 4 minutes once warm) tests `src-tauri` changes before a CI build;
  it needs `libwebkit2gtk-4.1-dev` and friends, as `desktop-build.yml` installs them.
- **Waiting on the author:** remove the 15 Geometry formula presets the figure cards cover; whether the comparison
  functions (IS, ABOVE…) move to core with the Comparison card; record the education direction as a leaf (which ring).

### SESSION DIGEST (2026-11-06: mathlib as a lens, the spec vocabulary and an overnight research run; cloud session)
- **Spec vocabulary from mathlib** (develop 4b7b526, 9491962): `value-semantics` § Points and differences is the one
  home for point kinds (dates, °C/°F readings) and point weight; why the Kleene tables are forced; `socket-lattice`
  § The shape of what connects (widening is a preorder, narrowing and wildcards don't compose, coercions agree along
  paths except through the bridge and the other families' matrix rungs) and the Type Settle's real cap (256 passes);
  dimensions as exponent vectors; the four aggregate kinds (`formula-language`, "What a total can be built from");
  glossary entries. Mathlib's names go in specs as words, never backticked (docsPointers holds backticked names to the
  code).
- **The research** lives on `research/mathlib-lens` (its research doc under `docs/audits/` and two probe test files), six
  of eight hourly passes run before the author stopped it. Its confirmed bugs are in the backlog, § Found by the mathlib
  research. Two choices wait in the inbox: `dates-weigh-as-points` (`(d1 + d2) / 2` is `#TYPE!` for dates but a
  reading for °C) and `aggregates-of-nothing` (MAX, MIN and PRODUCT of nothing make up a 0).
- **The research landed** ([[C139]] mathlibLaws, made with the author 2026-11-06: mathlib is the reference for the laws Solenoid's math keeps): MDETERM has no singularity
  cutoff (a singular matrix is 0, as Excel), MINVERSE and SOLVE decide singularity at any scale
  (`singular_at_any_scale`) while computing as before; the Equation solver's tolerances are purely relative; the
  spreads sum their terms exactly (`terms_sum`); the Type Settle visits cards in topological order (`visit_order`).
  The laws behind each are in the specs with their mathlib declarations (`../tree/specs/floors/engineering.md` § Laws come from mathlib, by
  name, pinned to mathlib `9c8f67d`) and held by `properties.rs` and the graph crate's `lattice.rs`, `settle.rs` and
  `boundary_core.rs`. Refrozen: MDETERM of a singular matrix (0 now), and last-digit moves of at most 7e-12 relative.
  Then the rest: every family's matrix rung shapes what arrives (`to_matrix`); PRODUCT multiplies in sorted order
  (`product_of`); running and rolling sums are exact and snap as SUM does; dimension exponents snap to small
  fractions (`snap_exp`); MOD and QUOTIENT say which quotient MOD pairs with (Lean core's `Int.fmod_add_fdiv_mul`).
  The research list is empty. The author's calls landed too: [[E19]] datesWeighAsPoints (a refused date formula is
  weighed whole, then piece by piece, `by_point_weight`) and [[D125]] aggregatesOfNothing (MAX and MIN of nothing
  blank, PRODUCT 1, GCD 0, LCM 1). Date cards are back in the 210px tier (`nodeMedium`).
- **`#POINT!`** ([[E20]] pointError, the author 2026-11-06): a position (a date, a °C or °F reading) used as an amount
  is its own error, where it was `#TYPE!` for dates and `#UNIT!` for readings. `point_error` beside `unit_error`,
  `point_refused` for dates; `#TYPE!` keeps wrong kinds, `#UNIT!` real unit clashes. Scheduling's dates come from
  adding durations to dates, never dates to dates.
- **Before pushing Rust, even a prototype test: `bash scripts/check-rust.sh <crate>`** (the crate bans `powi`, clippy
  runs with warnings as errors) and give a new test file a leaf citation, or coverage fails CI.

### SESSION DIGEST (2026-11-06: 1.6 release copy and the value-handling triage; cloud session)
- **Marketing copy is looser than UI copy** (DESIGN.md §7, author 2026-11-06): the What's New deck lives in `src/graph/whatsNewSlides.ts`, which the UI-copy sweep skips; no em dashes, American spelling and true claims still hold. The 1.6 deck is in (`WHATS_NEW_VERSION` 1.6); `docs/release-notes-features.md` is its source, `docs/release-notes-1.6.md` the plain changelog.
- **Empty text is nothing typed in a total** ([[D109]] aggregatesRefuseText): a card that answers text as its formula reads `""` as a blank at the port (`family_cell`, both boundaries), and SUMSQ and SUMPRODUCT skip it. PTP, IQR, MAD, SEM, CV and RMS refuse text in formulas, as their cards did.
- **Two temperature scales never meet** ([[C25]] firstClassUnits): `temperatures_mix` (`unit_value.rs`) refuses K with °C or °C with °F on the Arithmetic card, in an aggregate or running list, in a formula whose inputs carry two scales (a list mixing scales mapped item by item doesn't count) and in a computed column. Δ°C is still owed: two °C readings subtract to K.
- **AVERAGEIF(S) over nothing is blank**, as AVERAGE's is, in the formula and on the SUMIFS card.
- **CSV junk cells are NaN** (`infer_text_column`): missing markers and up to a tenth of other text keep a number or date column, their text in `raw`. A stopgap until the NaN walk; the full CSV pass is in the backlog.
- **Query is Pipeline, a run mode** ([[C53]] pipelineIsCompositePreset, author 2026-11-06): computes as Manual refresh (`refreshes()`), plus `pipelineChain()` (one chain from the Table marker to the Result marker; side inputs through the Pipeline's own ports; the first fault named) and the read-only `PipelineSteps` list on the card, numbered, with a folded Preview of the selected step off its `cachedResult`. Nothing on the card edits the graph. Shot graph: `scripts/shot-graphs/pipeline-steps.json`.
- **Freezing**: `bodies_over_values_with_a_unit`, `fold-units` and `tests/csv.rs` now refreeze under `FREEZE_NATIVE` like the other suites.
