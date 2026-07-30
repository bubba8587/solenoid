# 19 — The computed-column SURFACE (table columns are defined, not just typed)

**Status: DESIGN RATIFIED 2026-07-29 (author) — build slice 1.** The core
mechanics shipped the same day (`computedColumnCore.ts` + the Computed Column
verb node); this bundle is the full UIUX surface the author called for: *"a
very large percentage of Excel work is table computed columns, we can't
half-ass this UIUX surface."* Author rulings: C1 = addable λ sockets; C2 =
the TablePopup hosts Formula editing (the card chip marks computed columns
with a glyph); C3 = STRUCK — there is NO wired-list column source and NO
Frame from Lists fold (see "What does NOT change"); C4 = eyeball on the
preview.

## The spectrum (author direction, verbatim intent)

Computation should not be crammed into formula text when the graph does it
better — that is the app's whole thesis. So a computed column has a LADDER of
definitions, each at its natural altitude:

| altitude | definition | surface |
|---|---|---|
| trivial (`price*qty`) | inline formula text | typed on the column / the CC node |
| reusable | a λ (params bind to columns; captures carry side values) | wired |
| arbitrary logic | a NODE SUBGRAPH | the existing downstream verbs — the chain ENDS in a frame via Add Column / the CC node / Frame from Lists |

The first two live IN the table — Excel users think "the column has a
formula". The third already speaks frames on its own: an external process
that builds a column with nodes finishes as a frame through the machinery
that exists (author ruling 2026-07-29 — no new injection surface; "inject it
back" = the pipeline's OUTPUT is the enriched table).

## The column-source model (the design's one idea)

Every column of an EDITABLE table (Frame Input) has a **source**:

1. **Data** — today's literal cells (raw text, never rewritten). The default.
2. **Formula** — an inline row-wise expr. Same rules as the CC node, verbatim,
   because both call `computeColumnCells`. Excel TABLE semantics (D24,
   2026-07-30): `@name` is this row's cell, a bare name is the WHOLE column
   (`[@Amount]` vs `[Amount]` — so `@revenue / SUM(revenue)` is a share of
   total and `SUMIFS(amt, cat, @cat)` a per-group subtotal); the bracket
   references spell the two for names a variable can't — `@[Unit Price]` this
   row, `[Unit Price]` whole;
   `row`/`rows` builtins; null flows in; one value per row (a list result is
   a #SHAPE! pointing at `@`).
3. **λ** — one of the node's wired lambda inputs. Frame Input grows an
   EXTENSIBLE λ input group (individually-labeled addable sockets — the
   ExtensibleInputs pattern; each input plays a distinct role, per the
   node-coverage design rule). A column picks a λ by its socket label.

There is deliberately NO wired-list source (author ruling 2026-07-29): a
column built with nodes arrives as a FRAME through the existing downstream
verbs, not as a list injected into the source table — computing from the
table's own rows via a wire-back would be a graph cycle anyway, and the
in-table sources (2–3) are the cycle-free form of that.

Where the sources live in the value model: `FrameSourceColumn` grows a
`source` variant (`typed` | `{formula, expr}` | `{lambda, socket}`).
Pre-alpha: the save format changes, seeds update, no shim.

### Intra-table references

A formula/λ column may reference OTHER computed columns. Evaluation is in
dependency (topo) order; a cycle among computed columns is a per-column
`#REF!` naming the cycle (the acausal Equation node exists for genuine
simultaneity — a table is not that). This is half the value of the surface
(margin = revenue − cost, revenue itself computed), so it lands in the FIRST
slice, not later.

### What renders where (TablePopup)

- The per-column header controls (name, type-cycle, format row) gain a
  **source control**. Data stays visually as today. A computed column's
  cells render read-only with the derived-value treatment (the popup already
  distinguishes Source vs Formatted for literals — computed is a third,
  visually quiet state; the column header carries the definition).
- The formula for a Formula column is edited in the popup (one definition per
  column — Excel's "same formula down the column" model, PQ's Custom Column
  dialog; never per-cell text that pretends each cell has its own formula).
- On the CARD, Frame Input shows its normal chip; the λ/list input groups are
  ordinary extensible socket rows.

### What does NOT change

- **The CC verb node stays.** It is the mid-pipeline form (computing on a
  Join's output has no editable table to host the definition) and the two
  surfaces share one core, so they cannot drift.
- **Frame from Lists and Add Column stay, as themselves.** They are the
  node-built path's ending — a chain that computes a column with nodes
  finishes as a FRAME through them. No fold, no successor (author ruling
  2026-07-29: any future foldability is hypothetical and is not a goal).
- **Get Column → nodes → Add Column stays legal** — it is the same
  computation at the graph altitude.
- The Frame Input's literal columns keep the raw-text guarantee untouched.

## Staging

1. **Core extraction — DONE** (`computedColumnCore.ts`; the CC node
   delegates; 27 pins).
2. **Slice 1 — DONE (2026-07-29):** Frame Input λ sockets (extensible) + the
   per-column source control (Data | λ) + computed-cell rendering +
   topo-order eval + cycle refusal. The smallest slice that exercises the
   whole surface.
3. **Slice 2 — DONE (2026-07-29):** Formula source (`FrameSourceColumn.expr`;
   TablePopup editing per C2 — the source select gained Formula and an
   =-prefixed formula row under the header) — the pure-text rung — plus the
   chip's ƒ mark on any table with computed columns.
4. **Tail:** per-column format/unit reuse on computed columns, binding
   pickers, the CC node's remaining UX items — unchanged backlog.

## Crux decisions — RESOLVED (author, 2026-07-29)

- **C1 — addable λ sockets** (ExtensibleInputs rows, individually labeled);
  a lambda-list socket type was rejected — a lattice change for a UI-density
  concern.
- **C2 — the TablePopup hosts Formula editing** (one formula per column,
  where the column's other controls live); the card CHIP marks computed
  columns with a glyph for at-a-glance discoverability.
- **C3 — STRUCK.** No wired-list source; Frame from Lists is not folded and
  no fold is queued.
- **C4 — computed-cell rendering:** author eyeball once slice 1 is on the
  preview.
