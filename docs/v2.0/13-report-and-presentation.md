# Bundle 13 — The report file, the object socket family, and presentation nodes

**Source:** scope-features #13 (IN, corrected), #47 (IN, confirmed easy), #50 (IN, scoped
way down), #51 (IN, light), #52 (IN, colors only), #49 (IN, as a node). **Depends on:**
loosely on bundle 01 (stable names sharpen inline refs) but buildable now without it.

## #13 — The report projection: one editable markdown file (IN, corrected scope)

**Read the VERDICT carefully — this is NOT "canvas Notes rendered in reading order."**
The Report is **one editable markdown file**, independent of the graph, NOT a Note node
and not built by stacking existing Notes. Blank by default (no auto-population from
pins/Notes/pinned values). It reuses the Note body's inline-ref span mechanism directly
and can additionally **embed** existing Note nodes as placed objects — but the file, not
the Note, is the report's unit.

**Three-step design (already settled 2026-07-02/03):**

1. **Note INPUT sockets via inline refs.** A Note body already turns frontmatter keys
   into typed OUTPUT sockets; build the mirror: an inline code span `` `=name` `` in a
   Note body mints an INPUT socket named `name` (the ExpressionNode bare-name pattern),
   reconciled on blur like frontmatter. The span renders the connected value in place,
   through the same annotation resolver `ValueDisplay` uses — so an FC-locked value shows
   its unit/format in the prose ($1,200.00, not 1200). A frame input renders as a compact
   table capped at preview size, never a full materialization.
2. **The "object" socket category (the Special family).** A CATEGORY, not a single
   dataType: teal-green glyph-in-circle sockets. `lambda` (λ glyph) is already the first
   member; `chart` joins as the second (tiny chart glyph). Each member connects only to
   itself + `any` (a MAP fn input must never accept a chart) — the shared look says
   "special object, not data" in the legend. Members are scalar-only and ref-on-the-wire
   (the lazy `FrameRef` precedent — user-facing type + chip + popup preview, lightweight
   handle). **Explicitly excluded:** membership in frame/cube CELLS (no Polars dtype,
   lossy CSV round-trip, no verb/aggregator meaning over objects). Machine-check the
   lattice edges via the existing full-sweep test (`socketConnect.test.ts` pattern).
   Charts gain an object output; a lambda ref in a Note renders as KaTeX (the compiler
   already emits LaTeX per parse — reuse it, don't build a second renderer).
3. **The report file itself** — a single editable markdown document, separate from the
   graph's node set, blank until written in. Gets the inline-ref span (step 1) directly
   — no Note node required to hold it. Can additionally embed a Note node as a placed
   object; an embedded chart still renders as a chip/placeholder in canvas Notes (the
   live chart stays on the canvas beside it) but renders full-size in the report file.

**Scope discipline (the VERDICT's explicit risk note):** plain markdown source + inline
refs + embeds — no WYSIWYG toolbar, no block library beyond what markdown + embeds
already give. Don't let this become "a document editor."

**Build order:** step 1 (Note input sockets) first — it's nearly-free groundwork either
way since the span mechanism is shared with step 3. Step 2 (object socket family) next —
needed before charts/lambdas can flow into the report file. Step 3 (the report file
itself) last, consuming both.

## #47 — Static HTML export (IN — confirmed easy, a few days not a redesign)

**Depends on #13 landing** (the report is what gets frozen). Feasibility already
confirmed: charts render as SVG already (no new export path); the HTML-canvas renderer
already captures node DOM as images (`drawElementImage`) so a canvas screenshot is nearly
free; freezing the report means rendering the same markdown with today's values
substituted as plain text — no new renderer needed.

**Build:** "Export as webpage" → one self-contained `.html` file: the report view, key
charts, pinned values, a canvas image — frozen at export time. Inline CSS/images as data
URIs for single-file portability. Deliberately frozen/non-interactive — the (deferred)
interactive published form is a separate later thing, not this.

## #50 — Auto-documentation node (IN — scoped way down, gated on confidence)

**Explicit scope limit:** attaches to **Groups only**, not arbitrary selections or
whole-document narration. **Explicit caution (don't skip this):** only build if
confident the composition approach actually works well — the naive version might need a
bespoke prose string authored per catalog entry (a large ongoing maintenance cost, not a
one-time build). Prove the composition works on a handful of node types before
committing to catalog-wide authoring.

**Build:** a node attached to a Group that generates a readable description by walking
the group's structure + the catalog's existing short node descriptions, rendered as
templated local prose (no cloud call needed for the basic version). Feeds into the
report file (#13) as embeddable text.

## #51 — Presenter mode: the Presentation node (IN — keep it very light)

**Explicit scope (author's correction — simpler than the original pitch):** a
**Presentation node** stores an ordered list of steps; each step is a title text + an
explicitly-defined set of nodes (picked like a navigator list, NOT an ad hoc canvas
selection). Stepping through a step does ONLY camera zoom-and-pan to frame that step's
node set. **No isolate, no highlight, no dim** — just camera movement, reusing the
load-reveal's existing camera-choreography machinery repurposed from loading to
presenting.

## #52 — Branded output: colors only (IN — colors only, no logo, no fonts)

**Explicit scope limit (author's correction):** no logo, no custom font substitution —
managing header/font swap across output surfaces was judged too much complexity for the
payoff. Just a **color override** on report/published-artifact output surfaces (never
the editing canvas, which keeps the tuned design system). The per-document palette
already persists (`SavedGraph.palette`) — this scopes a brand-color override to the
presentation projections specifically (report, static HTML export).

## #49 — Session History node (IN — as a node)

**Build:** a Session History node — does NOT persist (reflects the current session's
history-plugin state only, never saved document data), autogenerates its digest text
whenever it exists on canvas, has a copy button. That's the whole UI: copy, done. The
history plugin already knows everything that happened in the session; this distills it
into a dated, human-readable digest ("changed FX assumption 1.08→1.11; added a Reconcile
branch; renamed 3 nodes").

## Exit criteria

Note bodies support inline-ref input sockets; the object socket family exists with
`lambda` + `chart` as members, lattice-checked; a standalone, blank-by-default,
editable markdown report file exists with working inline refs and Note-embedding; static
HTML export freezes the report + charts + a canvas image into one self-contained file;
an auto-doc node exists on Groups (only if the composition approach proved out during
build — otherwise this sub-item is explicitly OK to leave unshipped rather than force a
bad version); a Presentation node steps through camera-only views of explicit node sets;
report/HTML-export surfaces support a color-only brand override; a Session History node
renders a copyable session digest.
