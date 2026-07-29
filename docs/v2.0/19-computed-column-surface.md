# 19 — The computed-column SURFACE (table columns are defined, not just typed)

**Status: DESIGN — crux decisions open (author).** The core mechanics shipped
2026-07-29 (`computedColumnCore.ts` + the Computed Column verb node); this
bundle is the full UIUX surface the author called for the same day: *"a very
large percentage of Excel work is table computed columns, we can't half-ass
this UIUX surface."*

## The spectrum (author direction, verbatim intent)

Computation should not be crammed into formula text when the graph does it
better — that is the app's whole thesis. So a computed column has a LADDER of
definitions, each at its natural altitude:

| altitude | definition | surface |
|---|---|---|
| trivial (`price*qty`) | inline formula text | typed on the column / the CC node |
| reusable | a λ (params bind to columns; captures carry side values) | wired |
| arbitrary logic | a NODE SUBGRAPH computing a list | wired list / by-row composite |

All three must feel native to a TABLE — Excel users think "the column has a
formula", not "there is a verb node downstream".

## The column-source model (the design's one idea)

Every column of an EDITABLE table (Frame Input) has a **source**:

1. **Typed** — today's literal cells (raw text, never rewritten). The default.
2. **Formula** — an inline row-wise expr. Same rules as the CC node, verbatim,
   because both call `computeColumnCells`: variables are column names,
   `row`/`rows` builtins, `col("Unit Price")`/`col(2024)` for unspellable
   names, null flows in, error cells propagate per row, one value per row.
3. **λ** — one of the node's wired lambda inputs. Frame Input grows an
   EXTENSIBLE λ input group (individually-labeled addable sockets — the
   ExtensibleInputs pattern; each input plays a distinct role, per the
   node-coverage design rule). A column picks a λ by its socket label.
4. **Wired list** — one of the node's wired LIST inputs (same extensible
   pattern, `anylist`). The list IS the column's cells: the injection path for
   node-built columns. **Cycle constraint:** the list must come from UPSTREAM
   data — a list derived from this table's own output is a graph cycle and
   refuses like any cycle. Columns computed FROM the table's own rows use
   sources 2–3 (in-table, cycle-free) or the downstream CC-verb pattern.

Where the sources live in the value model: `FrameSourceColumn` grows a
`source` variant (`typed` | `{formula, expr}` | `{lambda, socket}` |
`{list, socket}`). Pre-alpha: the save format changes, seeds update, no shim.

### Intra-table references

A formula/λ column may reference OTHER computed columns. Evaluation is in
dependency (topo) order; a cycle among computed columns is a per-column
`#REF!` naming the cycle (the acausal Equation node exists for genuine
simultaneity — a table is not that). This is half the value of the surface
(margin = revenue − cost, revenue itself computed), so it lands in the FIRST
slice, not later.

### What renders where (TablePopup)

- The per-column header controls (name, type-cycle, format row) gain a
  **source control**. Typed stays visually as today. A computed column's
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
- **Get Column → nodes → Add Column stays legal** — it is the same
  computation at the graph altitude, and the wired-list source is its
  ergonomic ending.
- The Frame Input's literal columns keep the raw-text guarantee untouched.

## Staging

1. **Core extraction — DONE** (`computedColumnCore.ts`; the CC node
   delegates; 24 pins).
2. **Slice 1:** Frame Input λ sockets (extensible) + the per-column source
   control (Typed | λ) + computed-cell rendering + topo-order eval + cycle
   refusal. The smallest slice that exercises the whole surface.
3. **Slice 2:** Formula source (popup editing UX) — the pure-text rung.
4. **Slice 3:** Wired-list source; decide Frame from Lists' fate (it becomes
   the all-wired degenerate case — fold or keep).
5. **Tail:** per-column format/unit reuse on computed columns, binding
   pickers, the CC node's remaining UX items — unchanged backlog.

## Crux decisions (author)

- **C1 — λ inputs: individually-addable sockets** (recommended; matches
  ExtensibleInputs + "distinct roles get labeled rows") **vs one λ-list
  socket** (would need a new lambda-list socket type in the lattice for a
  UI-only need).
- **C2 — where a Formula column's text is edited:** the TablePopup column
  header (recommended: the definition lives where the column lives) vs the
  node card.
- **C3 — Frame from Lists' fate** once wired-list columns exist.
- **C4 — computed-cell look** in the grid (author eyeball once slice 1 is on
  the preview).
