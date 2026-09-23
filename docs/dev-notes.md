# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-22d: fixing what the rebuild specs found; author away)

- **What stands:** the backlog section "Found writing the rebuild specs" is empty; each item was fixed or
  ruled, and its spec says what the code now does. Every round ran tsc, the full vitest suite, `dte validate`
  and, when the engine changed, `cargo test --lib`.
- **Two engines, one answer:** units ride through the desktop's native verbs (schema shadows in
  `PolarsBackend`), Join and Nest Join compare unit keys as quantities (`joinKeyTransform`, #UNIT! across
  dimensions), a join keeps every column's unit and format, Window reads NaN as blank on both engines,
  and share / pct_change agree on blanks. A parity fuzz (every corpus case re-run with NaN, infinities, blanks
  and -0 added, prepended, or with every cell blank) found one more break, NaN order keys in the ranks, now
  fixed. The generator lives in the session scratchpad, not the repo.
- **Formulas:** LAMBDA parameters shadow names and constants, a blank scalar argument gives a blank answer
  while an empty argument slot does not, arithmetic on text is #VALUE! with advice, malformed numbers are
  lexed as errors.
- **Documents:** composites re-save byte-identical (saved ids), `seedStore.ts` and `SavedGraph.seedId` are
  gone, the save version is one constant, a Placeholder's references follow renames. Reports export and write
  to Obsidian what the card shows (format picks, highlights, frames as tables, frontmatter stripped); an empty
  merge writes nothing; a blank page name numbers off the sink's name.
- **Canvas:** Composed and Bubble honor the axis options the Chart Builder offers; the pointer census drops
  stranded fingers (a primary touch or a window blur); expand push leaves the user's own overlaps alone;
  standoffs draw under nodes.
- **Ruled, not changed:** a one-element list collapsing on scalar rungs is D13's design, and Frames and Cubes
  crossing the unit boundary untouched is the design (compute-pass spec). **For the author:** E14's line
  "Append / Bind Columns become VSTACK / HSTACK when the stack merge lands" reads stale.

### SESSION DIGEST (2026-09-22c: DTE and specs, merged and made rebuildable; author present)

- **What stands:** the tree has one node per decision. Merged into survivors: D8→D7, D44→D45, E3→D15,
  C56→C26, D2→C1, C12→C11, and the seven HTML-in-Canvas tuning nodes D55–D61→C42 (their knobs now live in
  `../tree/specs/canvas/html-in-canvas.md`). C52's audit half became C108 auditDefaultsToFix. Every unratified node below
  ring A was rewritten for plain reading; the Why no longer restates the Decision.
- **The rebuild test:** five new specs cover the computational core, written from the code: `compute-pass`,
  `formula-language`, `computed-columns`, `frame-verbs`, `save-format`. Every other spec was rewritten, and
  the thin ones (conduit faces, input-cable pruning, live connections, stores) now state behavior.
  `subsystem-invariants.md` is one table; the docs that held pieces of these specs point at them.
- **Nodes corrected against code:** C60 (Running has no mode toggle), C63 (Record's views are ops), C62,
  C65 (the standoff depth isn't set anywhere; labeled), C95, C1, C45 (ordering is case-sensitive), C48,
  C51, C61, C72, D10, D20, D22, B16.
- **Open:** node candidates the spec writers flagged (sections of `../tree/specs/documents/literal-input-editors.md`,
  the drawn-cable rulings) are unmoved. Still without a spec: the Table popup and the node families
  (`node-coverage.md` stands in); `tree/specs/values/format-model.md` is a spec living in docs/.

### SESSION DIGEST (2026-09-22b: the connective-core copy pass; author present, reviewing samples)

- **What stands:** the shipped copy is free of em dashes and `uiCopy.test.ts` enforces it over every genre,
  seeds included (DESIGN.md §7 now says so). Help tabs (`help.md`, `data-model.md`, `notes.md`), catalog
  descriptions, Inspector Excel notes, socket docs, tooltips and error messages along the computed-column,
  socket-lattice, unit-flow and type-propagation paths are rewritten in the author's register: short, plain,
  Excel names where they help, no wiring narration.
- **Facts corrected, not just reworded** (each verified against code): the help tab said a format resets at
  the first transform (it carries through meaning-preserving ops, [[D41]]); Saving said examples replace the
  canvas (they open as new documents) and only newer formats are refused (older are too); six Excel notes
  (ISNA, ISERR, ISTEXT/ISNONTEXT, MINVERSE, CONCAT/CONCATENATE) and the CONCAT description misdescribed the
  node; XLOOKUP's advice named Build Frame for pairing two lists (Frame from Lists does); node-coverage put
  `anydata` below `anytable` and said a computed column's formula sees only scalars.
- **Specs** `error-values`, `unit-flow`, `type-propagation…`, `socket-lattice`, `literal-input-editors` are
  restructured into sections; every spec header drops the "Lifted from subsystem-invariants" line.
  `mental-model.md`, `tree/specs/values/value-semantics.md`, `glossary.md` and all of `node-coverage.md` are reworked; build
  history goes to git.
- **DTE:** about 70 AI-made nodes reworded with rules unchanged, each with a History line; every `*Origin:*`
  paragraph and duplicate `*Why:*` label is gone; 56 bare rule names became `[[ID]]` wikilinks. Human-held
  nodes (A ring, B7, C80) were not touched; author quotes stay verbatim.
- **Open:** the before/after log for the author lives outside the repo (session scratchpad). The trailing
  parenthetical rule still covers only catalog, socket docs and Excel notes (279 sentence-level hits in seeds
  and catalog, mostly legitimate glosses).
