---
aliases: ["Components"]
tags: [spec, floors]
---
<!-- [[C27]] noDataInComponents, [[C95]] commitOnEnter, [[D10]] onePrunePath, [[B12]] losslessSaves, [[B3]] sameNodeEverywhere, [[B14]] oneDesignSystem, [[C43]] oneFlowSurface, [[B10]] reactFlowView; covers: src/graph/components/*.tsx, src/graph/flow/*.tsx, src/graph/*.tsx -->

# Spec: Components

Serves [[C27]] noDataInComponents, [[C95]] commitOnEnter, [[D10]] onePrunePath, [[B12]] losslessSaves, [[B3]] sameNodeEverywhere and [[B14]] oneDesignSystem.

What every React component in the app is built to. A component that implements a specific mechanism cites that mechanism's leaf in its own header; this spec is the floor every one of them stands on, and its `covers:` line is what `dte blast` and `dte coverage` read instead of a citation per file. The first section is the rules; the rest describes the shared card kit that almost every node component is assembled from: the card shell, the value box, the input rows and manual resize. How a socket anchors and how a cable finds it is [[react-flow-surface-contract]]; visual rules (color, type, spacing) are DESIGN.md.

## The rules

1. **A component never computes.** It renders what the model already holds and never calls `node.data()`. A value it shows comes from the engine's cached result on the node or from a store ([[C27]] noDataInComponents; the `sourceInvariants` sweep enforces it).
2. **A text edit commits on Enter or clickaway, never per keystroke.** `useDraftCommit` (in `components/inlineInput.tsx`) and the draft-commit fields hold the draft locally, write it to the node on commit, and run the recompute; Escape reverts. A raw `<input onChange>` never calls `processGraph`. A discrete pick, such as a dropdown or checkbox, applies at once ([[C95]] commitOnEnter; sweep-enforced).
3. **A socket that is about to disappear loses its cables first**, through `dropInputCables` (or `dropOutputCables` for an output) in `components/cablePrune.ts`, never a hand-rolled loop over `editor.removeConnection` ([[D10]] onePrunePath; sweep-enforced).
4. **A node's `width` and `height` belong to the ResizeObserver**, which overwrites them with the rendered size on every layout. Only a declared size-owner class (annotation frames, the composite card, groups, overlay hosts) reads `init.width` and `init.height` back on load; any other resize gesture routes its size through `nodeSizeStore` ([[react-flow-surface-contract#Node width and height]]).
5. **Every render is inside an error boundary**: `ErrorBoundary` wraps each card (`withNodeBoundary`) and the app root, so one throwing card shows its own error and never blanks the canvas ([[C43]] oneFlowSurface; [[react-flow-surface-contract]]). The node wrapper is memoized by component type, because a fresh wrapper type per render would remount the card, lose focus mid-edit and re-run every effect.
6. **Visual, layout and copy choices follow DESIGN.md** ([[B14]] oneDesignSystem): the op and argument split ([[C26]] opArgDistinct), the socket glyph table, the voice rules for every string, icons at even pixel sizes, and no native browser dialogs ([[C106]] noNativeDialogs).
7. **A node looks and behaves the same wherever it renders** ([[B3]] sameNodeEverywhere): marketing scenes, popups and the socket value peek mount the real component, never a redrawn copy.
8. **Pointer handling depends on pointer type** ([[C93]] gestureByPointerType). A control you drag inside stops the event from reaching the canvas. Read-only chrome uses `stopDragStart` (in `coarse.ts`), which stops the event on desktop, so a click cannot start a card drag, and lets it through on mobile, so a pan starting there still works. Nothing swallows a second finger, so a pinch always reaches the canvas ([[C92]] pinchUnvetoable).
9. **A new node component** arrives through the `add-node` skill: the class, the component, the catalog row and the Add-menu entry land together, and the catalog is the one declaration ([[C8]] declareOnce).
10. **Per-node code reads its own graph.** A card can live inside a composite drill-in, so it reaches its editor and view through `getOwningEditor` and `getOwningView`, never `getEditor` or `getView`. Chrome that acts on the surface the user is looking at reads `getActiveEditor` and `getActiveView` ([[composite-drill-in-mount-lifecycle]]).

## The card shell

A standard card is `NodeShell` (`nodeKit.tsx`) around `NodeCard` (`NodeCard.tsx`). `NodeCard` is the outer box; `NodeShell` adds the header, the socket content wrapper and the resize grip. Standard shapes (input rows plus one result box, add-and-remove rows, one segmented toggle) come from the factories in `standardNode.tsx`; a node needing more writes against `NodeShell` directly.

**What `NodeCard` does**

- Class names on the root carry the card's state: `--selected`, `--collapsed`, `--grouped`, `--resizable`, `--sized`, `--wide`, `--medium`, `--square-collapse`, `--no-chevron`.
- It publishes the accent as `--node-accent` (the class accent from `nodeAccent`, or an `accentOverride` adjusted for the theme with `themeAccent`) and a darker `--node-accent-dark` (`darkenAccent`). A group member also gets `--group-color` and `--group-color-dark` from `groupMembershipStore`. It re-renders on theme changes so the accent follows light and dark.
- A capture-phase `pointerdown` and `mousedown` listener stops propagation when the target is an input, textarea, select, contenteditable element or any button except the chevron. The node drag listener is native and would otherwise fire before React's handlers and hijack text selection inside a field.
- It publishes `--out-socket-top`: the vertical center of the first visible `.solenoid-node__figure`, `__display-value` or `__value-input`, summed up the `offsetParent` chain to `.solenoid-node__content`, so it does not depend on the header. With no visible box the property is removed and sockets fall back to 50% of the content wrapper. It re-syncs after every commit and on every resize.
- Its ResizeObserver writes the rounded rendered size to `node.width` and `node.height` (rule 4), re-renders the node in its owning view so cables re-route live during a resize drag, re-aligns any docked Format Controller, and re-centers the card itself on its host when it is a docked FC (the pre-layout height estimate is short).
- **Collapse.** The chevron toggles `collapseStore` and re-renders the node so cable ends re-measure. The chevron's press reaches the header drag on purpose, so the node can be dragged from it; a desktop mouse then loses its click to the card, so the toggle fires on a stationary release (within `HEADER_TAP_SLOP`, 4 px) detected on a window `pointerup`. A square-collapsed card also expands on double-click. A collapsed card drops any pinned inline height, and a manual size is ignored while collapsed. `collapsible: false` hides the chevron.
- `frameless` skips the painted frame, for a card that paints its own single-stroke ring (the Format Controller).

**What `NodeShell` does**

- **The title.** The header shows the label clamped to 4 lines. A stationary tap on it (under `HEADER_TAP_SLOP`) opens a textarea with the caret at the tapped character; a drag moves the node, because the whole header is the drag handle. The textarea exists only while editing, since a textarea can't ellipsize, and it grows to at most `LABEL_MAX_HEIGHT` (60 px), matching the clamp. It shows the raw text; the Header-title case setting (`settingsStore.headerTitleCase`, applied through `html.hdr-case-as-typed`, `-proper` and `-upper`) transforms only the display. A cleared title shows the catalog name as its placeholder, so the header never collapses to a sliver. The rename runs through `useEditableLabel` ([[C95]] commitOnEnter).
- **The hover texts.** The header's tooltip is the node's catalog description with its markdown stripped, since tooltips render no markup. A hover hint in the header's right strip shows the family name (`nodeTypeName`: Series, Math FX), never the op.
- **`--header-h`.** `useHeaderHeightVar` publishes the header's border-box height, fractional when the layout is, so the frame divider sits exactly on the seam. The frame's header viewport and the corner badge read it.
- **The content wrapper.** Everything below the header sits in `.solenoid-node__content`, the socket positioning context ([[react-flow-surface-contract]]). Output sockets and one resize grip (for a `nodeResizable` class) render inside it.
- **Badges.** `cornerBadge` pins a mark to the body's top-right corner, `--header-h + 3` px from the top and outside the content wrapper: the lock on a pack preset, a Display's expand button. The comment badge is a round mark peeking out of the top-left corner at a fixed offset, shown only while the node has a thread.
- **Semantic zoom.** While the Settings toggle is on, the shell mounts a stand-in showing the node's name large; the swap at the zoom threshold is pure CSS on a root class, so cards never subscribe to the zoom.
- `nonScrollingBody` marks a figure card whose body scales rather than scrolls, so a sized card does not trap the wheel.

`useNodeField(node, key)` is the hook for a discrete pick: local state mirrored onto `node[key]`, then a recompute and `reconcileTypesAfterEdit`, since a config value can move a derived socket type (a GROUPBY aggregate's column type) with no connection event.

## Card chrome

The card's CSS lives in `nodeCard.css`; socket sizing is `socket.css`, driven by `--socket-size`.

- **Width.** The three width tiers are DESIGN.md § Cards. `min-width: 180px` is the general floor, which content-sized cards (a Display grown to a short result) also read against. A node class can add its own width class (`solenoid-node--geocode`, `--cast`, the Slicer tiers).
- **The painted frame.** The body border, the header's 2 px accent cap and the 1 px header divider are drawn by `CardFrame`: two sibling SVGs over the card, stroking at fractional geometry so their shared edges stay coincident under zoom. The first strokes the body border. The second is sized to `--header-h` and clips the cap and divider to the header, so a card without a header gets neither. The card and header keep transparent borders at the original widths, so layout is unchanged; never paint those borders. In light mode the divider takes the frame's accent-dark color instead of gray. A card that is its own positioning context sets `--frame-outset` so the frame reaches back over its border.
- **Stacking inside a card.** Frame 1, chevron 2, semantic stand-in 3, group membership corner 5, selection ring and resize grip 6, sockets, pills and badges 7.
- **Header.** An opaque accent tint (`--header-tint`), clipped to the padding box so zoom rounding lands inside the strokes. The title and its textarea share one box, so switching between them never shifts a socket, and both leave a 44 px strip on the right that stays grabbable and holds the type hint. A card with no chevron reclaims the left padding.
- **Selection and hover.** The selection ring and glow are DESIGN.md § Cards; the ring is an overlay, so selection never changes the card's size. Hover steps the border to `--border-strong`; in light mode it mixes the accent toward black, so rest, hover and selection ramp 0, 12% and 20%.
- **Group members.** A member takes a real 2 px border in the group's color, not an inset ring, which seams at rounded corners, and keeps it whether or not it is selected, so selecting it never changes its size. The header overhang widens to match. The membership color shows only while unselected, and the hover rule repeats it so hover never recolors half the edge. A 15 px triangle of the same color, mixed into the opaque surface, marks the lower-right corner.
- **Collapsed.** Every body child is hidden except the value box, the main text field, sockets, the input pill, output rows and `__collapsed-only` content, so a multi-output card collapses to its output values. `__collapsed-only` shows only while collapsed (the Slicer's "X of N", Sparkline's mini). A collapsed table card hides its grid and centers its chip. **Square collapse** (Sparkline, the Gauge dial) hides the header and shrinks the card to a 68 px square; its chevron appears on hover or selection, which is the touch path to re-expand, and the mini figure is inert so clicks reach the card.
- **Glyphs** repeated on every card (the chevron, the copy button, the resize grip) are masked `::before` shapes, not inline SVGs, to save DOM on every card.
- **Semantic zoom** hides the body with `visibility`, not `display`, so the socket rows keep their measurements, and draws the node's name at 28 px, clamped to 3 lines, over the card.
- **Focus** inside a card takes the card's accent (DESIGN.md, the Nearest-Accent Rule).
- **Op pickers** hoist to the top of the body with flex `order: -1`, which works only on a direct body child; their 2 px edge is paid out of the padding, so they take the same space as a neutral field (DESIGN.md § Op pickers).
- **Jump and flash.** `.solenoid-node-flash` pulses a 1 s glow ring on whichever node root it lands on (card, note, group or Conduit), used by the Problems and Comments panels.

## The value box

`ValueDisplay` (`nodeKit.tsx`) renders a card's result box; `valueDisplayFormat.ts` resolves the Format Controller annotation that governs it ([[format-model]]).

- **What shows.** Null or an empty list shows a faded placeholder (default `—`), because an empty string has no line box and would collapse the card. An error shows the red `#CODE!` badge. An object value (a Frame, Cube, chart, document or other kind) shows its chip (`valueChipFor`); this check runs before any number or string path. A residual `NaN` is dirty data, not an error: a muted italic `NaN` with an explanatory tooltip, never error red. A list shows an `ArrayChip`, or its values joined when shown inline.
- **Inline or chip.** A list renders as joined text when the box is an expanded Display (`full` true) or when a card carries an FC annotation, so the formatting is visible. A collapsed Display (`full` false) always shows the chip, even under an FC (`shouldRenderListInline`).
- **Family.** Whether a value is a date, and which element family tints a chip, comes from the node's declared output socket (`nodeOutputElemFamily`), never from scanning cells: a date serial looks numeric and an all-null list has no cells.
- **Formatting.** An FC annotation overrides the card's own `render`. Null and error cells in a list keep their literal form. A date renders a notch smaller (15 px) than the 18 px number hero unless the FC sets a size. For text, the FC's case, bold, italic, size, alignment, monospace and Markdown options apply to the display only; Markdown is sanitized before it is injected, because a shared file is untrusted. The FC's Chip text style renders `CategoryChip`s. The FC's red negative style colors the number; the string already carries the sign.
- **Whitespace.** In a text result, leading and trailing spaces show as middots and an empty string as a dim placeholder; the value and what is copied keep the real whitespace.
- **One line.** A non-resizable card ellipsizes its value to one line; a resizable card (inputs, text, Display, lookups) wraps and fills instead.
- **Chips.** A box holding a chip uses `--chip`: a flex row that centers the chip vertically, aligns it right, and keeps the height of a text box, so chip cards line up with value cards. Cards never restate this inline (`sourceInvariants` pins it).
- **Copy.** A copy button sits at the box's left edge. On desktop the text is selectable; on touch a drag pans instead, and the button covers copying.
- **Several boxes.** A card with several result boxes passes `socketKey`, so an FC wired to one output formats only that box. `InlineOutputRows` shows compact per-output rows, each resolving its FC per socket; a row shows at most three list cells and then `…`.
- **Errors explained.** When an error is wired into an IS-check card, the card shows the code, the producer's message and the longer `ERROR_EXPLANATIONS` text.

## Input rows

`InlineInputs` (`inlineInput.tsx`) renders a card's input rows, one `MeasuredSocketRow` per socket ([[react-flow-surface-contract#The socket box and its row]]). `ExtensibleInputs` and `PairedExtensibleInputs` add rows that can be added and removed.

- **The row.** Each row is 22 px tall with the label on the left and a literal field on the right. A wired row replaces the field with a marker naming the source (`↩ Rate`, or the catalog name for an unlabeled source, [[D22]] oneNamePerCard), truncated at 72 px with the full name in the tooltip. Which inputs are wired and who drives them are derived at render time, never cached, so a rename shows at once.
- **Which field.** Which field a row gets, and which map it writes, is [[inline-literal-maps]]. A socket label of the form `Foo (default X)` splits into the label `Foo` and the placeholder `X`. `suggest` offers type-ahead through one native `<datalist>` per card holding the union of every suggested key's options; any value still commits. `cableOnlyKeys` rows show only the socket and label; `mathLabelKeys` labels render with KaTeX.
- **Collapsed.** Two or more inputs collapse into one pill (`CollapsedInputPill`) centered on `--out-socket-top`. The sockets stay functional but hidden behind it, so cables still land, and the pill draws its own highlight. A lone input centers on the value box like the output. A collapsed group shows the same pill for a hidden Conduit's bundled outputs, mirrored to the right edge.
- **Number fields** (`InlineNumberField`, the Number Input card) scrub: a vertical drag past 4 px changes the value one step per 6 px, up to increase, Shift ×10, Alt ×0.1 on a 0.1 grid. The drag previews live, Escape reverts, and the release is one commit and one undo entry. Under 4 px a click just focuses the field.
- **Text fields.** A string literal is framed by decorative quote marks that are never part of the value (`QuotedTextInput`), so a trailing space reads as the gap before the closing quote. The main value field is a textarea that keeps pasted newlines, grows with its content up to 200 px and then scrolls; a row's inline field fills the row and scrolls. Text reads in the sans face, left-aligned; numbers use the mono face.
- **Adding and removing rows.** A remove button sits on each removable row (on a tuple's first row, and only while more than `minRows` remain). Removing prunes the row's cables first ([[D10]] onePrunePath), re-renders the card, bumps the connection version so the cables of the rows below re-route, and recomputes.

## Manual resize

A `nodeResizable` card gets one grip (`ResizeHandle`) in the bottom-right corner of its value box: a 16 px mark at half opacity, matching the group grip, padded for a fingertip on coarse pointers, and hidden while collapsed.

- The width applies to the card and the height to the body alone (`--box-h`), so the card's height stays content-driven: the header and leading rows keep their natural height, and the body's last child (the value box, grid, chart or text field) fills and scrolls. The grip reports the card's size, and the box follows the height change from the start of the drag.
- Floors: 140 px for the card's width (below the 180 px default on purpose) and 40 px for the box. On load a stored size is clamped to the current content's minimum (`nodeSizeStore.getMin`), since the grip clamps only live drags and a Display sized for a scalar may now show a chart.
- The size persists through `nodeSizeStore` (rule 4). On mobile the grip stays grabbable even on an unselected card, where every other control is inert until the card is selected.
- A text field that resizes on its own (the Mermaid source, the Record layout, the Script source) wears `FieldResizeGrip` instead of the browser's resize corner, whose heavy glyph no CSS can restyle; that height is a live DOM size and is not saved.
