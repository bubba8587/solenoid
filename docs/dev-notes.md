# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

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
- **NAME-3 revised** (rules.md). A placed card shows its class-derived FAMILY name (`nodeTypeName`),
  op-agnostic — the op dropdown on the card carries the op, so the header no longer repeats it. Every
  display surface (`nodeDisplayName`, plus the header placeholder / typeHint / Navigator / cable-source
  label that called `nodeName` directly) now reads the family; the op label lives only in search and the
  Inspector reference line. Classes renamed for clean names: `MathFnNode`→`MathFXNode` ("Math FX"),
  `NpvNode`→`NPVNode`, `IrrNode`→`IRRNode`, `GcdNode`→`GCDNode` (type = class name, so seeds + the
  personal-finance generator moved too). Remaining awkward names backlogged (family-name polish).

### SESSION DIGEST (2026-09-13 — the decision walk; author present, two agents)

The author walked the "review with the author" backlog items one per turn; the Lead
(solenoid-0f) proposed, the author ruled, and every ruling that produced work went to Agent 2
(`be`) or Agent 3 (`fe`) and merged into `develop` when green. Nothing pushed. Rulings, in order:

- **compositesHoldUntilSolve** (Agent 2; `decisions.md`). A composite in any Solve-button mode
  starts UNSOLVED on load, paste, create and a switch into a heavy mode; blank ports, stale dot on,
  driver readouts null, until Solve/Refresh. Plain single-pass composites stay live. Author: "people's
  intuition expects the value to already be blank/unsolved so they can see it work when they hit
  Solve." Pinned in `composite.test.ts`.
- **formatCarryPerOp** (Agent 3; `decisions.md`, rules formatFlowsDownstream rewritten). The Lead's
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

