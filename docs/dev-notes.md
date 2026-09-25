# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-25b: the demo video, and what filming it found; author present)

- **The demo video is generated, not edited by hand:** `scripts/demo-video/` films the real app in headless Chromium
  and a real Obsidian running the Solenoid Properties plugin on a virtual display, then cuts it with ffmpeg: captions,
  title cards, crossfades, callout boxes, post zooms and a synthesized soundtrack. Obsidian scenes are filmed live
  (the plugin's look switched on, a 40-row Frame pasted into a new property, the written note opened); side-by-side
  scenes pair a Solenoid screenshot with an Obsidian grab per state (palettes and light mode, the imported note).
  Running and redoing it, and every mechanic that bit: `.claude/skills/demo-video/SKILL.md`.
- **Two cuts** (`cuts.mjs`): `demo`, the app tour, kept as `assets/video/solenoid-demo.mp4` (2:27) with its poster;
  and `obsidian`, a one-minute story for Obsidian users: the popup's Grid and CSV views, then an emailed table typed
  into a Frame property through its Form view, all in Obsidian; then, after a card that opens Solenoid, the note
  joined to a roster note and totaled with PIVOTBY, the chart written back into the note, and the plugin's look. Its
  Solenoid scenes film Obsidian and a real Solenoid window side by side on one display. Frame zero of each is its title card, also embedded as cover art. Renders land in `.dev/video/`
  (gitignored).
- **Solenoid Properties wordmark**: `src/logo/solenoidpropertieswordmark.svg`, the coil beside SOLENOID PROPERTIES in
  Atkinson Hyperlegible Next 800, outlined at the Solenoid wordmark's size, baseline and spacing. The demo vault
  gains `Sales/Q3 review` and `Sales/Divisions` for the obsidian cut's story.
- **App fixes it found**, one commit each: opening a Report no longer takes the app down (a hook after an early
  return); chart value axes write compact ticks in a gutter that fits them; the vault cards gate on `hasFs()` like
  their nodes; Open in Obsidian on the Write card follows the write, not the shell; a frame's CSV edit types the
  columns it adds from their values (`columnTypesAfterCsvEdit`, once the block is left or saved from); the demo
  vault's showcase note no longer retypes every project's `budget` and `milestones` (its keys are `purchases` and
  `inspections`; the projects' `milestones` is a Frame); an Equation linear in an unknown that appears more than
  once (`p = n*25 - (f + n*10)`) solves it exactly instead of by bisection (`solveLinear`).
- **Open:** the author listens to the soundtracks and picks where each video is published (backlog, Demo video); the
  Frame popup's blank-header-line item in the backlog (the author held that behavior until a change is shown
  rigorous). The outbox still lists A1, B1, B2, B3, B7.

### SESSION DIGEST (2026-09-25: formulas and aggregates at scale and at the edges; author asleep, one check-in)

- **Long lists:** a list past about 125k values no longer throws. `guardFinite(result, inputs)` takes an array (callers
  spread whole data lists into it, so web GROUPBY and most range formulas threw), `mapCells` measures each operand once
  (a tall column was N²: 40k rows took 1.9 s, now 54 ms), and MAP, BYCOL, HSTACK, CONCATLISTS, Set Cells and a script's
  table result read widths with `reduce`. The remaining `Math.max(...)` spreads run over bounded counts (canvas layout,
  chart axes, Frame from Lists, Template, Triangle). SUM still throws inside Formula.js past 125k values.
- **One answer per aggregate** ([[D51]] oneAnswerOneDivergence): the statistics formulas keep a first-class ∞ and a NaN
  cell, as the Aggregate card and GROUPBY do. `aggregate()` classifies its own result and answers `#DOMAIN!` for a NaN
  input on every op but the counts; the percentile, quartile, correlation, covariance and regression kernels classify
  theirs, and percentile interpolation returns a bracketing value both ends hold (PERCENTILE.INC of 1, 2, ∞ at 1 is ∞).
  MIN and MAX are owned (Formula.js spread the list into `Math.min`) on the card's kernel; PERCENTRANK.INC and .EXC run
  the card's kernel (Formula.js said 0 below the data).
- **Retired on the author's suggestion:** AVERAGEA, MINA, MAXA, STDEVA, STDEVPA, VARA and VARPA redirect to their plain
  forms ([[C14]] currentExcelParity, a new consequence line); lists are typed, so only the logical reading was left.
- **Excel parity at the edges, card and formula alike:** YEARFRAC basis 1 is Excel's actual/actual (211/366 for Excel's
  own example), truncates its dates, takes them in either order and refuses a basis outside 0 to 4; GCD and LCM share
  one kernel (`gcdLcm`) that truncates each value and refuses a negative or one at 2^53 or more; LEFT, RIGHT, FIND
  and SEARCH refuse a negative count or a start below 1 (the text cards pass their numbers as given); PEARSON and
  FVSCHEDULE are range functions on the card kernels (`fvSchedule` in `financeOps.ts`); BASE and the `*2HEX`
  functions write uppercase.
- **Other fixes:** Nest Join keys round like Join's converted key (`roundAtLargerTerm`, shared in `frame.ts`), so 1 in
  matches 2.54 cm; a pasted Missing placeholder stays a placeholder for its node (`placeholderFor`, shared by load,
  composite hydration and paste); the signature hints mark the second value optional, as Excel's do; the `display`
  node kind is gone (charts resolve the gold slot directly).
- **Open:** inbox `aggregate-list-cells` asks how every aggregate formula reads a logical (`SUM(x > 5)` is 0 while
  `AVERAGE(x > 5)` counts); owning SUM waits on it. Backlog "Formula parity leads" holds TEXTAFTER's later arguments,
  SEARCH wildcards, and the author's call on N, T, TYPE and ERROR.TYPE (out of scope, still callable). The outbox
  still lists A1, B1, B2, B3, B7 (left alone per the backlog).
