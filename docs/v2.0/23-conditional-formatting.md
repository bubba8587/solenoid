# Bundle 23 — Conditional formatting for tables (design-pass prep)

**Source:** scope-features #41 — IN, "must beat Excel by a lot"; author-gated since D4.
**Constraints (author):** its own design pass; Display-side only; must not step on FC
format/units territory. **Score:** Solid · Core · Medium · Moderate. **Written:** 2026-09-01,
plan-only — this is the prep for the design session, not the design.

## What "beat Excel by a lot" can mean here

Excel's CF is a hidden dialog of rules attached to ranges: unfindable, unauditable, copied by
accident, broken by inserts. Solenoid's edge is the one it always has: **a rule is a graph
value.** Proposal to bring to the design pass:

1. **Rules are columns.** A conditional format on column `Margin` is driven by a value the
   graph can see: a computed column (`@margin < 0`), a wired logical/number list, or an inline
   threshold that IS a literal on the node. Nothing hidden: the Inspector shows the rule, the
   text form carries it, where-used finds it, the AI palette can write it.
2. **The visual vocabulary is small and typed.** Per column, one of: **tint by rule** (a
   logical → one quiet tint), **scale** (a number → a two- or three-stop color scale), **bar**
   (a number → an in-cell data bar), **icon set** (a number or category → a glyph), **chip**
   (a string → categorical chips — 1.4's B2 primitive). Quiet Accent Rule: tints are
   backgrounds at low alpha; the palette's categorical/sequential ramps are the only sources.
3. **Where it renders.** `TablePopup`, `FrameDisplay`/`TableDisplay` on cards, the Record
   node's views (color-by = chip or tint by rule), Report embeds and the static HTML export.
   One resolver, every surface.
4. **Where it lives.** A per-column DISPLAY annotation in `frameFormatStore` (display only,
   never the unit — the FC owns units and number format; CF owns color/glyph/bar). The
   annotation names its rule source by node name (addressable) or holds the inline threshold.
   Sidecar-carried (`frameFormats` already is).

## Open questions for the design pass

- Authoring surface: the popup's per-column format row (`fcControls.tsx`, beside format and
  unit) vs a Format-Controller-like node ("Conditional Format" docking to a frame cable). The
  row is cheaper and Display-side; a node is wireable and visible on the canvas. Recommend
  the row for inline thresholds and a wired rule via a column picker (B4's picker).
- Does a rule travel with the frame downstream (Sort/Filter keep it — column identity by
  name survives verbs) or stay on the node it was authored on? Recommend travel, resolved by
  column name, dropped on rename/computation.
- Cross-column rules (highlight the row where `status = late`): a row tint keyed by one
  column's rule applied to all — one option, not a second mechanism.
- Interaction with the FC's number format (a bar under a formatted number) and with
  categorical chips (a chip IS a conditional format on a string).

## Build sketch (after the pass)

1. Annotation model + resolver (pure; unit-tested on frames + rules).
2. Popup row authoring; card/popup/Record/Report/export rendering through one resolver.
3. Wired rules via the column picker; travel-through-verbs semantics pinned.
4. A seed ("Margins") and the What's-New slide.

## Exit criteria

A table's coloring can be read off the graph (Inspector + text form), survives a Sort/Filter,
renders identically in the popup, the card, a Record view, a Report and the HTML export, and
never changes a value or a unit.
