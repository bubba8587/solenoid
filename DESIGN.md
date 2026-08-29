---
name: Solenoid
description: A node-based computation graph tool, an Excel alternative for data tables.
colors:
  accent: "#f5b914"
  surface: "#1e1e1e"
  surface-sunken: "#141414"
  surface-raised: "#262626"
  border: "#2d2d2d"
  border-strong: "#3a3a3a"
  text: "#e8e8e8"
  text-bright: "#f3f4f5"
  text-dim: "#9aa0a6"
  text-muted: "#80868e"
  canvas-bg: "#0b0b0b"
  sock-number: "#f5b914"
  sock-string: "#c8e040"
  sock-date: "#d685b1"
  sock-complex: "#56b4e9"
  sock-table: "#e96b3c"
  sock-frame: "#8e64ed"
  sock-lambda: "#00b890"
  sock-any: "#8a8f98"
  danger: "#e0473a"
  success: "#2fae7a"
  warning: "#d9a93b"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
  value:
    fontFamily: "Atkinson Hyperlegible Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  xs: "3px"
  field: "4px"
  chip: "5px"
  card: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
components:
  node-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{colors.card}"
    width: "180px"
  value-input:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text}"
    typography: "{typography.value}"
    rounded: "{rounded.field}"
  button-icon:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text}"
    size: "28px"
  button-pill:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
---

# Design System: Solenoid

## 1. Overview

**Creative North Star: "The Instrument Panel"**

Solenoid is built around legibility before anything else. The typeface is the Braille Institute's Atkinson Hyperlegible family. The type runs small and dense because a working graph wants information per pixel, not whitespace theatre.The accent color is user-swappable at runtime.

This system explicitly rejects three looks. It is not a generic SaaS or AI-startup dashboard: no purple gradients, no hero-metric cards, no glassmorphism, no rounded-everything template. It is not a childish or playful no-code toy: no bubbly cartoon blocks, no oversized friendly shapes. And it is not skeuomorphic or cluttered: no faux-3D bevels, no shadow overload, no chrome competing with the graph.

**Key Characteristics:**
- Dark-default workbench with a fully mirrored light theme.
- Small, dense, hyperlegible type. Information per pixel over whitespace.
- Flat at rest; elevation and glow appear only as a response to state.
- Fast, short, functional motion. The two choreographed moments (load reveal, AI-apply
  reveal) are deliberate showpieces, not a license.

## 2. Colors

A neutral workbench carrying a typed, saturated socket palette and a single swappable accent.

### Primary
- **Gold Accent** (`#f5b914`): The single interactive accent — the brand coil's gold, shared with the number socket. Marks focus (input field borders), the brand wordmark, and selection glows. Overwritten at runtime by the theme store (the user can pick any palette slot), so treat it as a role, not a fixed hue.

### Neutral
- **Workbench** (`#1e1e1e`): The raised chrome surface. Node bodies, menus, popovers. In light theme this becomes a near-white off-white (`#fbfcfd`).
- **Recess** (`#141414`): Sunken fields. Inputs, value and result boxes, button backgrounds. The brightest layer in light theme (`#ffffff`), so fields read as familiar input boxes.
- **Raised Fill** (`#262626`): Hover and selected fills inside chrome.
- **Canvas Void** (`#0b0b0b`): The graph canvas, a shade darker than every card so nodes lift off it. Light theme uses `#eef1f5`.
- **Hairlines** (`#2d2d2d` border, `#3a3a3a` strong, `#2a2a2a` subtle): Borders and dividers. Thin and quiet.
- **Ink** (`#e8e8e8` text, `#f3f4f5` bright, `#9aa0a6` dim, `#80868e` muted): The text ramp, brightest reserved for emphasis, muted for secondary labels. The muted tier clears WCAG AA 4.5:1 on the card/sunken surfaces. Light theme inverts to dark inks (`#1b1e23` down to `#6a717b`).

**A palette replaces this whole neutral ramp** — canvas, window, the three surfaces, the three borders, the four inks, per theme mode (`BUILTIN_CHROME` in `palette.ts`). The rest of the neutral chrome (panels, overlays, button hover, the gauge track, the selected cable, light-theme shadows) DERIVES from those thirteen by fixed mixes, so a palette moves one ramp rather than forty tokens; the mix steps are calibrated against App.css's own literals, not eyeballed per palette. The hexes above are the **Default** palette, which authors no ramp of its own because it IS this section. The others each carry chrome their identity earns: Muted lifts off near-black onto a soft charcoal, Colorblind-safe goes fully achromatic and a step crisper so the Okabe–Ito hues carry the whole type signal, Solarized adopts its own canonical base03…base3 ladder, Equinox drops the last of the blue cast, Orchard trades the near-black workbench for Pear's warm cream, and Blueprint puts the whole instrument on a cyanotype ground where the canvas dot grid reads as drafting paper.

**The two tinted ramps follow the live accent** (`CHROME_HOME` / `adaptChrome` in `palette.ts`). A tinted ramp has a hue, and the accent is user-swappable, so Orchard and Blueprint declare the accent slot they were authored against (green and blue respectively) and the ramp rotates by the hue delta to the selected accent — a vermilion accent turns Blueprint into a red-line print, a pink accent turns Orchard's cream to blossom. The rotation runs in OKLCh and holds every key's chroma and relative luminance, so it may retint but never relight and never strengthen: the tint carries exactly the authored intensity, and the structure and contrast relationships below are exactly the authored ones under any accent; at the home accent the authored hexes pass through byte-identical. **OKLCh here is deliberate and is not the socket-sibling HSV rule's territory** (§Tertiary): that rule governs fixed shade steps NEAR a slot's own hue, where HSV's per-hue unevenness never shows; a chrome rotation always crosses hue regions, and HSV/HSL saturation held across that trip reads as paper in Orchard's yellow band but as a heavy color wash in pink or blue — the failure the first cut shipped. The other palettes hold still on purpose — Solarized's ladder is a lifted identity, Colorblind-safe and Equinox are achromatic by brief, Muted is about glare rather than hue, Custom is exactly what its author picked — and an achromatic accent (the neutral cycle, the gray slot) leaves an adaptive ramp authored.

It is all or nothing per palette (paletteAllOrNone) — a partial ramp derives nothing — and it is **not** a license to renege on the STRUCTURE above. Machine-checked over every ramp, the Default baseline included: canvas darker than card, dots legible without shouting, the field brightest in light and a recess in dark, hover fill stepping toward the ink, three border tiers stepping outward, four ink tiers stepping down in contrast.

**The 4.5:1 ink contrast stated in this section is a promise of two palettes, not of the system** (paletteAllOrNone): `Default`, the experience nobody chose, and `Colorblind-safe`, whose brief is legibility. Those two are machine-checked. The rest are aesthetic opt-ins whose value is fidelity to a look, and a palette lifted from a low-contrast source is allowed to be low-contrast — Solarized sits near 3:1 by design, and an earlier pass that forced it up to AA ended up shipping something that was no longer Solarized. Do not "fix" an aesthetic palette's contrast upward; a reader who needs the guarantee has two palettes that make it.

### Tertiary (Typed Socket Palette)
The socket colors are the system's real palette: each data type owns a hue so a cable's color tells you what flows through it. They are tuned to stay distinguishable across common color-vision deficiencies, and array and matrix variants are systematic siblings of their scalar (a darker, desaturated shade for lists; a punchier, deeper, hue-shifted shade for tables/matrices).

**The sibling derivation runs in HSV** (`palette.ts`) — the same space as `themeAccent` / `darkenAccent` / `socketRingShade`, so the whole family is tuned on one set of axes and each knob does exactly one thing: array = HSV value ×0.85; matrix = hue −11°, S ×1.18, V ×0.92. Do NOT reintroduce an RGB multiply or HSL step - use HSV. This rule's scope is these fixed near-hue steps; the one derivation that crosses hue regions — the adaptive-chrome rotation — runs in OKLCh for the same underlying reason (see §Secondary), not as an exception to it. The socket RING is a fixed HSV value drop rather than one translucent black.

- **Number Amber** (`#f5b914`): scalar numbers. List sibling `#c08512`.
- **String Lime** (`#c8e040`): scalar text. List sibling `#7a9210`.
- **Date Orchid** (`#d685b1`): scalar dates. List sibling `#c06a98`.
- **Complex Sky** (`#56b4e9`): complex/scalar-or-list. Matrix sibling `#2a8fd9`.
- **Logical Purple** (`#c05dd1`): booleans (TRUE/FALSE), with list/matrix siblings.
- **Table Coral** (`#e96b3c`): table/frame data.
- **Frame Violet** (`#8e64ed`): named-column frames.
- **Lambda Teal** (`#00b890`): lambda values.
- **Any Gray** (`#8a8f98`): untyped sockets (`trueany` is the same gray as a hollow,
  border-only ring).

### Status (semantic state)
A small reserved set for failure and state feedback, kept apart from the typed socket palette so an error never reads as a data type.
- **Danger Red** (`#e0473a`): error values (the `#CODE!` badge, the error explanation panel) and destructive-action hover. Lighter siblings `#e0524d` (alerts) / `#e06c75` (row-remove hover) are tints of the same red.
- **Success Green** (`#2fae7a`): a true/ok state, e.g. a boolean input reading 1.
- **Warning Amber** (`#d9a93b`): caution / out-of-range states.

### Named Rules
**The Quiet Accent Rule.**
In the WORKING CHROME — panels, bars, buttons, menus, dialogs, section headers — color conveys
type or state: a socket, a cable, a focus ring, a selection glow, a status badge. Don't inject
accent or socket hues there for visual interest. But the app is not colorless by doctrine;
decoration is real and deliberate, in named homes: **brand marks** (the wordmark, the desktop
accent window border, the top-bar art slot), **user-authored color** (note and group tints,
theme palettes, report palettes, chart colors), and **opt-in flourishes** (cable flow beads,
the load reveal, the AI-apply reveal). The rule's actual content for an agent: NEW decorative
color is an author call, never a default you reach for — when unsure whether a color is meaning
or mood, keep the chrome neutral and ask.

**The Opaque-Chrome Rule.** Bars, panels, popovers and floating overlays fill with `--surface`
(via `--panel-bg` / `--overlay-bg`) and never let the graph show through; a chrome surface that
needs a `backdrop-filter` to stay readable is the glassmorphism §1 rejects. Alpha stays where it
IS the effect: modal scrims and the compute curtain (they dim what's behind on purpose), tint
washes over an already-opaque surface, user-authored group and note fills (a group body must show
its members), and glows, shadows and rings.

**The Nearest-Accent Rule.** There are two accents in play — the app's (`--accent`, the user's theme pick) and the surface's (`--node-accent`, the type color tinting a node card's or a value popup's header). Inside a surface that carries its own accent, the surface's wins: its focus rings, drop targets, active states and filled actions all resolve `var(--node-accent, var(--accent))`, so the fallback hands app-level chrome — the command palette, Settings, the Navigator, the accentless dialogs — the app accent untouched. An app-accent ring inside an accent-tinted card puts two unrelated hues on one small surface and reads as a mistake. An accent FILL additionally needs its ink from the matching pair (`--node-accent-ink`, derived per surface); `--accent-ink` is computed for the app accent's hue and goes unreadable on any other.

**The Sibling Rule.** Array and matrix socket colors are never free choices. A list is a darker, desaturated shade of its scalar; a table/matrix is a punchier, deeper, slightly hue-shifted shade. Introduce a new typed color only as a systematic sibling, never an arbitrary new hue.

**The Accent-Mix Ladder.** Every accent-derived shade is a `color-mix` of the surface's accent at a NAMED rung — never an ad-hoc percentage. The rungs live as CSS vars in `App.css`; the mix target is chosen by role at the use site:
- `--mix-hairline` (30%) toward a border color — tinted hairlines (markdown table edges, strip separators).
- `--mix-edge` (45%) toward `--border` — a structural edge on a field or bar.
- `--mix-emphasis` (60%) toward `--border` — the quiet-emphasis edge: an operation selector at rest, an active step.
- `--mix-ink` (55%) toward `--text` — accent-tinted glyphs and labels (header titles, chevrons, swatches).
- `--mix-glow` (28%) toward `transparent` — the selection glow alpha.
- `--mix-ring` toward `--ring-into` — the selection ring: 70% toward `#fff` in dark, 80% toward `#000` in light (the light nerf; a ~70% mix toward black reads as a harsh near-black frame over a pale card).
Tint FILLS stay separate: the header band uses `--header-tint` (22% dark / 52% light) toward `--surface`; translucent washes (active rows, count pills, chips) run loose at 12–22% toward `transparent` and are not yet rungs. A new accent shade picks the rung whose role matches; needing a new percentage means proposing a new rung here, not inlining a number.

## 3. Typography

**Display Font:** Atkinson Hyperlegible Next (with system-ui, sans-serif)
**Body Font:** Atkinson Hyperlegible Next (with system-ui, sans-serif)
**Value/Mono Font:** Atkinson Hyperlegible Mono (with ui-monospace, SFMono-Regular, Menlo, Monaco)

**Character:** One legibility-first family in multiple weights, paired with its monospaced sibling for values and code. Atkinson Hyperlegible was designed by the Braille Institute to keep easily-confused glyphs (I/l/1, O/0, b/d) distinct at small sizes, which is exactly the constraint a dense node graph imposes. The pairing contrasts on a single axis (proportional vs monospaced), not on competing personalities.

### Hierarchy
- **Display** (600, 20px, 1.2): Overlay and panel titles, e.g. the Function Reference. Rare; the system runs small.
- **Title** (600, 14px, 1.3): Node headers, menu and section headings.
- **Body** (400, 12px, 1.4): The base size. Node body text, menu items, descriptions.
- **Label** (400, 11px, 1.3): Field labels, the socket legend, secondary annotations.
- **Value** (mono, 12px, 1.3): Computed results, numeric literals, formula text. Monospace so digits align and values read as data.

### Named Rules
**The Hyperlegible Rule.** The UI face is Atkinson Hyperlegible Next and the value face is Atkinson Hyperlegible Mono. This is a fixed accessibility constraint, not a style choice. Never substitute a generic geometric sans for "polish"; the glyph disambiguation is the point.

**The Small-and-Dense Rule.** Body is 12px and labels are 11px. The graph wants information per pixel. Do not inflate type for breathing room; rhythm comes from spacing and grouping, not from large headings.

**The Wrap Rule.** Text that wraps to more than one line picks a wrap style; greedy wrapping is for text that never wraps. Two styles, and the choice is the block's job:
- `text-wrap-style: balance` — short blocks whose silhouette is read as a shape: headings, dialog messages, toasts, and the sentence-length empty states inside a narrow node card. Browsers cap balancing at a few lines, so this is wrong for body copy.
- `text-wrap-style: pretty` — running prose: help markdown, catalog and socket descriptions, settings notes, and the user's own writing in a Note or Report body. It keeps lines full and only rebreaks the tail to kill a one-word orphan.

`text-wrap-style` inherits, so a body of rendered markdown sets `pretty` once on its container rather than per block: it then reaches table cells and whatever bare text the renderer emitted, not just the `<p>`s. Two consequences of doing that. A block inside it that must stay greedy resets to `auto` (`.sol-md pre` — rebreaking a wrapped code line moves the break away from where the code reads), and the container must not be an ancestor of the editing textarea, or prose rebreaks under the caret as it is typed. The Note and Report both put the rendered view and the textarea side by side as siblings, which is what makes this safe.

Always the `text-wrap-style` longhand, never the `text-wrap` shorthand. The shorthand also sets `text-wrap-mode`, so it silently resets a `white-space: nowrap` on the same element into wrapping text (`.solenoid-alert__msg` is one ellipsis-clipped line by design and would have broken). `cssSyntax.test.ts` enforces the longhand and the two allowed values. Both degrade to greedy wrapping where unsupported, so no fallback is needed.

## 4. Elevation

The system is flat at rest and uses elevation only to communicate state. Cards sit on the canvas with no shadow at all; depth is the tonal step between the canvas and the slightly lighter card. (A 1px card seam was tried and dropped as imperceptible.) Real lift is reserved for two things: floating overlay chrome that must read above a busy graph, and state feedback (hover, selection).

### Shadow Vocabulary
- **Card seam** (`--shadow-card`, `0 1px 0 rgba(0,0,0,0.4)`; light `0 1px 2px rgba(20,30,50,0.08)`): NOT a card shadow any more. Survives only under small in-card popovers (the note's field picker, the formula editor).
- **Popover lift** (`--shadow-pop`, `0 4px 14px rgba(0,0,0,0.2)`): Menus and small popovers. Light theme softens to `rgba(20,30,50,0.06)`.
- **Overlay lift** (`--overlay-shadow`, `0 4px 14px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)`): Floating chrome that sits above the graph (socket legend, minimap, pins, alerts). Layered so it reads over busy content without pooling under the element. Light theme softens to `rgba(20,30,50,0.09)` / `rgba(20,30,50,0.05)`.
- **Selection glow** (`box-shadow: 0 4px 14px <node-accent>/28%`): An accent-tinted glow drawn from the selected node's own type color, not a neutral shadow.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadow is a response to state (hover, selection) or a job (an overlay floating above the graph), never a default decoration. A node at rest casts no shadow.

## 5. Components

### Buttons
- **Shape:** Two families. Round icon buttons (28px, `border-radius: 50%`) for canvas tools, and pills (`border-radius: 999px`) for grouped toolbar controls and segmented controls.
- **Default:** Sunken background (`--surface-sunken`), 1px neutral border (`--border`), body-color icon/text. Quiet and recessive.
- **Hover / Active:** Background lifts to `--btn-hover`, border steps to `--border-strong`. No color injection; the button stays neutral.
- **Confirming action** (one per dialog at most — Save, Done): the exception to the neutral rule. Filled with its surface's accent and its matching ink, so the button that commits a change reads as belonging to the thing being changed. Every other button in the same dialog stays neutral; two filled buttons in one footer is the misuse.
- **Icon-only buttons use EVEN-sized icons** (an even content box + an even icon = whole-pixel centering; odd sizes rasterize blurry and shift with browser zoom). Draw dividers with an inset `box-shadow`, never a layout border. Never a text `×`/`✕` for a close button — `components/CloseIcon.tsx`. A genuinely asymmetric glyph gets fixed in the path by ink centroid (an art call, not the parity rule).

### Inputs / Fields
- **Style:** Sunken background (`--surface-sunken`), 1px border (`--border`), 4px radius. Value text in the mono face. Reads as a familiar input box, especially in light theme where the field is the brightest (white) layer.
- **Focus:** Border shifts to the accent (`--accent`). No glow, no ring; a single colored border edge.
- **Edits commit on Enter / clickaway, never per keystroke** (like an Excel cell). Drafts stay local while typing; Escape reverts. `useDraftCommit` (`inlineInput.tsx`) is the mechanism; never call `processGraph()` from a text field's `onChange`. Discrete picks (dropdowns, checkboxes, sliders) apply immediately.

### Op pickers (the accent's one home on a card body)
A card body holds two kinds of pick, and they are different things all the way down (rules opArgDistinct):

| | **OP** | **ARG** |
|---|---|---|
| What it is | Which operation the card performs. Its values are ops: each a top-level formula function and an Add-menu name. | A parameter of the card's one function: a sort order, an aggregator, a pad side, a view. |
| Field | `op` | its own name (`order`, `agg`, `side`, `view`, `condition`) |
| Component | `OpSelect` (dropdown) / `OpToggle` (segmented) | `ArgSelect` (dropdown) / `SegToggle` (segmented) |
| On the card | Hoisted to the top of the body, 2px accent edge at `--mix-emphasis`: the op reads before the inputs it shapes. | Neutral, sits in its row. |
| Add menu | Searchable per op ("Chart: Column"). | Not a row; its words ride the host leaf's `keywords`. |
| Formula surface | A function per op (`ISEVEN`, `NORM.DIST`). | A parameter of the host's function: `SORT(list, index, order)`, `RUNNING(op, list, [window])`, `PADTEXT(text, width, [side])`. |
| Declared in | `NODE_OPS` (`nodeOps.ts`) | nowhere |

A family has at most one OP; the op picker is the only body control that spends the accent, and it is the only control that hoists. Everything else in the body stays neutral. There is no flag, `kind` or attribute that moves a control from one column to the other: the field name and the component are the whole classification, and the tests hold both directions (a string `op` field ⇔ a `NODE_OPS` family; `OpSelect`/`OpToggle` ⇔ bound to `op`; `ArgSelect`/`SegToggle` never bound to `op`).

The sorting question for a new pick: *would the user search the Add menu for this value by name, and call it as a function?* Yes → OP. No → ARG, whatever it looks like on the card. Chart's type is an OP (Column, Line, Scatter are things you search for). Record's view, Gauge's style and Proportion's layout are ARGs (three drawings of one figure). Running's aggregator is an ARG (`RUNNING(op, …)`), while Aggregate's is the OP (SUM *is* the card). Neither per-op names (`RUNNINGSUM`, …) nor zero names is the argument form; both were tried on 2026-08-10 and both were wrong.

### Cards / Containers (the Node Card, signature component)
- **Corner Style:** 8px radius.
- **Width:** Three fixed tiers so every node reads as a uniform unit: 180px default; 210px medium for nodes whose output is a date (a formatted `15-Mar-2026` reads wider than a number; `nodeMedium` in `nodes/kind.ts`); 240px wide for nodes carrying 2D table/frame data or an inline plot (`nodeWide`). Wide wins when both apply; a manual resize overrides either. Heights stay content-driven.
- **Background:** `--surface` body with a per-node accent-tinted header band. Each node type owns an accent; the header carries a tint of it (`--header-tint`, 22% dark / 52% light), so type is legible at a glance without coloring the whole card.
- **Shadow Strategy:** None at rest; the selection glow is the only shadow a card ever casts.
- **Border:** 1px neutral, stepping to `--border-strong` on hover. In light theme the border becomes a darker shade of the node's own accent rather than gray. **The frame paints as ONE SVG overlay** (`CardFrame` in `NodeCard.tsx`: body border + header accent cap + divider) so the strokes can't subpixel-crack under zoom. Never reintroduce painted CSS borders on the card or header (transparent borders there are layout-only); a new card-like surface reuses `CardFrame`.
- **Selected:** A 2px accent ring drawn as a pseudo-element overlay (so it sits above the header and group borders) plus the accent-tinted selection glow. Selection never changes the card's size.
- **Grouped:** Members take a 2px border in the group's color, with a small solid corner triangle marking membership.

### Navigation / Toolbars
- **Style:** Floating pill and icon clusters over the canvas, using the overlay chrome tokens (opaque `--surface` fill, always-on `--overlay-border`, deep overlay shadow) so they read above the graph. Controls are neutral; only their icons and state feedback carry weight.

### Signature: Typed Sockets & Cables
- **Sockets:** A deterministic 12x12 dot straddling the card edge, filled with the socket's type color and an inset ring (`--socket-ring`). Shape encodes type alongside color: circle = scalar, square = list, split square = scalar-or-list, grid = matrix, "F" in a square = frame, flat hexagon = cube, λ in a circle = function, three bars in a square = chart, two text lines in a square = document, hollow square = any data up to rank 2 (`anydata`), hollow ring = anything at all (`trueany`). The full table: `docs/socket-reference.md`.
- **Cables:** Colored by the type they carry, drawn at full curved fidelity at all times. Cables are never straightened, hidden, or shape-swapped during drag, pan, or zoom as a performance shortcut; the curve fidelity is part of the instrument's trustworthiness.


## 7. Voice & copy

Rules for shipped UI text — headings, dialog bodies, What's New slides, tooltips, empty states,
`src/graph/help/*.md`, every `nodeCatalog` description. The house voice is plain and declarative:
name the feature, say what it does, stop. These were distilled from a pass that rewrote the
What's New / About copy (before → after shown).

**Zero learning curve from Excel is a mandate for MECHANISMS, never for prose.** Every element is
self-documenting through hover tooltips (with Excel equivalents), the Socket Legend, the formula
editor's syntax highlighting, per-node descriptions from the catalog, and the Function Reference
overlay (Ctrl+/) — someone who knows Excel but has never seen a node graph needs zero Googling.
The app is visual and is NOT to be explained by elaborate text: the Reference tab docs exist
SOLELY for systems normal usage cannot make obvious (the socket lattice, unit flow). If a legend,
tooltip, glyph or on-screen control already carries it, the text must NOT restate it
(`data-types.md` once held a nine-row shape table rendered directly beneath the Socket Legend
that already draws and labels all nine).

**No "Captain Obvious" UI strings.** Never narrate the affordance ("Click to add", "Drag fields
between boxes"), no placeholder sentences, no redundant subtitles restating a name. Prefer a
single muted word over a sentence; nothing over a word; let the control carry the meaning. A
genuine STATE explanation is fine ("— connect a frame" on an empty list explains WHY it is empty).
Descriptions and tooltips never explain wiring (no sockets/cables/"typed or wired"/"flows out"):
wiring is the app. Tooltips are structural only — never dynamic data (names, values); visible
text carries the flexible part. UI copy only — docs and code comments can be as explicit as
needed. The rules below are about tone once the string earns its place.

`uiCopy.test.ts` enforces the machine-checkable subset of this section over the help markdown and
the node catalog: teased counts, the slogan phrases, conventional-affordance narration, chummy
asides. The rest stays a human call. Two rules below are NOT yet enforced because the shipped
corpus predates them — the em-dash ban (95 uses) and no-trailing-parenthetical (113); both need a
prose sweep before they can be turned on.

- **A control's own action is a verb, and that is not "imperative tone."** "Cycle Number / Text /
  Date / Boolean", "Open the Problems panel", "Drill in", "Rename" are correct on a button, chip
  or menu item: they name what the control does, the same register as its label. Only a GESTURE
  in front of the verb is wrong — "Click to cycle …" → "Cycle …". Strip the gesture, keep the
  verb. (The third-person rule below is about NODE DESCRIPTIONS, which describe a thing rather
  than offer an action; do not carry it onto controls.)
- **American spelling.** color, not colour. Also gray, center, behavior, labeled, neighbor, meter,
  analyze, normalize, catalog, dialog. Applies to every shipped string; code identifiers and CSS
  classes are a separate matter. `uiCopy.test.ts` enforces this one.
- **No em dashes.** Use a period, a colon, or restructure. The em dash is the tell of the machine-written
  aside. _"the whole app comes with you — toolbar, minimap, zoom"_ → _"…the whole editor. The minimap,
  zoom, right-click menu…"_
- **Name the feature; don't slogan it.** A heading is a label, not ad copy. Kill "and then some", "built in",
  "made simple", "…, meet …". _"Every chart Excel has, and then some"_ → _"More chart types"_. _"Make it
  yours"_ → _"Theming and shortcuts"_.
- **Don't tease a count.** No "three ways", "and more", "…, four ways". Say the thing. _"Ask 'what if' —
  four ways"_ → _"What-if analysis"_.
- **Define by what it is, not what it isn't.** Drop the "X, not Y" / "not a stripped-down Y" antithesis and
  its strawman. _"A real canvas, not a stripped-down popup."_ → (cut; the sentence before it already said
  the editor comes with you).
- **No knowing wink, no editorializing clause.** State the mechanism instead of the attitude; don't
  anthropomorphize or take a swipe at the alternative. _"so nothing recomputes behind your back"_ →
  _"recompute when you press Solve, and a marker shows when the result no longer matches its inputs"_.
  _"visible in a way a spreadsheet hides"_ → _"the steps of a calculation stay visible on the canvas"_.
- **Complete sentences, not headline fragments strung on dashes.** Subject, verb, period. A colon or "plus"
  for a genuine enumeration is fine; the dash as a rhythmic beat is not. _"…with your own API keys —
  refreshes on a timer, charts in a click, and never bakes the data into the file."_ → _"…with your own
  API keys. They refresh on a timer and are never saved into the file."_
- **Representative, not exhaustive.** List a few concrete examples; don't inventory every feature (and never
  list the same one twice for cadence). One definition per noun — no stacked appositives. _"A node-based
  computation graph — an Excel alternative for data tables."_ → _"A node-graph alternative to Excel for data
  tables."_
- **Second person for instructions, not for asides.** "Pull … onto the canvas" is fine; "behind your back"
  is not. Address the user to tell them what to do, never to be chummy.
- **No trailing parenthetical.** A string that ends with "(…)" is a sentence that didn't commit. Fold the
  aside into the sentence, promote it to its own sentence, or delete it. _"Stores the series id, not the
  data (refresh to re-pull)."_ → _"Stores the series id, not the data; refresh to re-pull."_ A parenthesis
  mid-sentence for a genuinely optional gloss is fine, sparingly — never two in one string, and never as
  the string's sign-off. The Excel-equivalent note in a tooltip becomes a plain trailing sentence:
  _"Excel: XLOOKUP."_
