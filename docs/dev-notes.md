# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-10-04: XY gradient line, drag frame rate, Chart Builder sections, stacking commands; cloud session)
- **An XY line with a numeric `c` draws in the ramp too**, segment by segment, and `cmap` picks the ramp from the Heatmap's colormap list ([[chart-figures]] XY).
- **Stacking commands**: Bring to front / forward, Send backward / to back on the selection (Ctrl+Shift+], Ctrl+], Ctrl+[, Ctrl+Shift+[; Edit menu; front and back on right-click). The order is the editor's node order and the save keeps it in the `positions` key order ([[react-flow-surface-contract#Stacking]]).
- **Chart Builder is a wide card and folds its secondary rows into sections** when its chart offers more than ten (DESIGN.md § Card sections); its select options no longer repeat their row label.
- **A drag never re-renders a card** (`SolNodeAdapter` memo ignores RF's position and `dragging` props); a dragged card is one composited layer and chart internals drop pointer events while anything moves ([[react-flow-surface-contract#Drag performance]]). Measured 36 charts × 250 points: a 30-step drag 13.3 s → under 1 s, worst frame 1.2 s → ~70 ms (dev build, headless).

### SESSION DIGEST (2026-10-03: settings accent picker; cloud session)
- **Settings ▸ Appearance's swatches pick the accent**: the same `SwatchGrid` on `appThemeStore` as the toolbar's paintbrush, so the two stay in step. The read-only legend mode is gone.

### SESSION DIGEST (2026-10-02: palettes, status colors and ink; cloud session)
- **New palettes, all derived from Default, none authored** ([[B14]] oneDesignSystem; `palette-and-theme` § The built-in palettes): **Neon** (HSV push to 65% of full, a brightness-seeking hue nudge capped at a third of each neighbor gap, 4.5:1 on black, never closer than Default's gold/lime; chrome polarized off Default's ramps) and **Dawn and Dusk** (Default's slots at 65% chroma, tinted 10% toward plasma's dusk burgundy; chrome takes plasma's two ends, ground from one and ink from the other). Plasma is Dawn and Dusk's inspiration only; the author ruled harmony with the grounds over separation (gold/lime closest at about 68% of the socket floor).
- **Equinox** keeps Default's OKLab lightness as grays, stretched onto 0.42 to 0.9, and its chrome is polarized at 0.3 (`polarizeRamp` takes a strength).
- **Tinted canvases sit further below their cards** (`deepenCanvas`, § The canvas step on tinted ramps): Solarized, Orchard, Blueprint, Dawn and Dusk step 0.10 (dark) / 0.05 (light); the dot grid keeps its contrast; judge against ungrouped cards, since a group's tint already lifts its members.
- **Status colors are palette tokens**: `--sol-ok` (green) and `--sol-warn` (gold) beside `--sol-error`; every hard-coded success, warning and error hex reads them. Slider thumb, syntax highlighting and autocomplete tags follow the palette (DESIGN.md § Status).
- **Ink follows Android Chrome's rule** (`contrastInk`): white only where white clears 3:1 WCAG contrast, so the accent's ink matches the browser's theme-color toolbar.
- `shot-graph.mjs` takes `--palette <name>` and `--light`. PIVOTBY list/grid cells are parked on `pivot-list-cells` (reverted on `develop`; a merge needs the revert reverted).

### SESSION DIGEST (2026-10-01b: mechanical backlog sweep; cloud session)
- Seven 09-29 commit-walk leads landed (author: "anything mechanical you're confident in"): the Distribution card's form and op switches (right cable pruned, kept params relabeled, the Sample form's hidden Draws field back), CHISQ/F/GAMMA at x = 0 and below as Excel answers (the three stray formula paths now run `DIST_SPECS`), SUMIFS and Get Column drop a stale async read, AI Apply refuses when the document moved under its diff, dead VARP/STDEVP rows, the value-semantics `autoLiterals` list.
- Second batch ("keep going"): Write Tasks refuses while TaskNotes shows the demo (and the fetch key carries the demo state), section folds record undo, SEARCH reads Excel's wildcards (one kernel with the criteria functions, card and formula), XNPV refuses an earlier date on card and formula, GROUPBY totals keep a min/max of dates a date, Add Column's Add as keeps a cable the new type accepts (`retypeInputCables`; the three Frame-card socket swaps moved into their classes), binomial sampling walks the CDF once (100k draws over 1000 trials: ~7 s to ~45 ms, same draws), Convert shares `numberFormatOptions`.
- Left for a ruling, though small: chart compact ticks (nine call sites and the gutter-width measure), Running over unit lists (per-position dimension for PRODUCT, °C sums), the Frame popup's stray format on a cancelled new column (which names Cancel should drop), UUID and undo, CI on `develop` (build minutes).

### SESSION DIGEST (2026-10-01: the unratified tree rewritten to the author's leaf test; cloud session)
- **A Why may lean on its parent, downhill only** (`docs/dte.md` § Solenoid practice; author): "we want A, thus we want B", never specifics piled up to justify the parent; a parent the call doesn't follow from is usually the wrong parent.
- **Every unratified B to E leaf rewritten** to the author's test (a call a person could weigh; "this works and doesn't not work" is spec): Decisions cut to the call in plain words, Whys to the plain reason, mechanics, per-function lists and the author's detail rulings moved into their specs (input-roles § Rulings, obsidian-plugin, formula-language § Lists, columns and tables, and others).
- **New C118 formatTravelsWithValue** (a value's format is set with a node and travels with it), the call C94 stood in for; D41 and D94 refine it.
- **Retired into specs:** C64, C94, D16, D18, D34, D37, D42, D75 (how a feature works, not a call); citations repoint to the call each served.
- **Reparented:** C92 and C93 to B20 alone, C117 to B16, D85 to C15, B19 to A5, C38 to B18.
- Stale claims dropped on the way: C60 (a blank Window reads as left out, so cumulative), C68 (no file-name date tokens), C70 (a row fault is the node's `#VALUE!`, per E10), C107 (the plugin's opt-in look does restyle Obsidian).
- **Second, aggressive pass** (author: "another pass. aggressive"): 25 more leaves retired into their specs (C13, C19, C21, C43, C60, C61, C62, C109, C111, C113, C116, D5, D21, D23, D63, D69, D71, D81, D83, D91, D92, D95, E16, B10, C41: conventions, applications of a parent, how a feature works, a library choice, a process order). MUST markers dropped except D73. The 98 unratified leaves now average 30 words of Decision and 22 of Why (the author's ratified ones run 22 to 46 and 14 to 44). D21 and D22 hang off B16, C42 off A1, D82 off C100 and C54.
