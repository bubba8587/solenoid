---
aliases: ["Layout and chrome"]
tags: [spec, canvas]
---
<!-- [[B14]] oneDesignSystem, [[C93]] gestureByPointerType, [[B10]] reactFlowView, [[C109]] linuxOwnWindowControls -->

# Spec: Layout and chrome

Serves [[B14]] oneDesignSystem. It maps the app's chrome (the bars, pills, panels and overlays around the canvas) on desktop, tablet and mobile: what sits where, what each offset is measured from, and what to check before adding or moving a piece. Citations are a file plus a selector, never a line number; grep the selector.

The recurring bug here is a floating overlay covering a bar. Every overlay's offset traces back to the same few bar heights, so moving or resizing a bar moves every dependent offset with it. The two envelopes below carry most of that; the tables say what each remaining number means.

## The two envelopes

Both are measured CSS variables on `:root` ([[#The two envelopes]]).

- **`--chrome-top`** is published by `Header.tsx`, which observes its own height. Every top-anchored overlay offsets from it. On desktop it measures 66px (the 22px menu bar plus the 44px top bar), with a 2px accent underline making about 68px to the canvas. A tablet in portrait wraps the top bar onto two rows (see Tablets), so the envelope is conditional and no longer a number anyone could write down; `touchActions.test.ts` pins the wrap.
- **`--chrome-bottom`** is published by `chromeBottom.ts`. Each bottom bar (the status bar, the mobile action bar) registers its root element while mounted, and the variable is the tallest registered height. A `display: none` bar measures 0, so whichever bar owns the bottom edge wins. The mobile bar's height includes its safe-area padding, so the variable carries the inset and consumers drop their own `env()` term.

**MUST:** every floating overlay derives its anchor from the two envelopes with `calc(var(--chrome-*) + gap)`, and no overlay hard-codes a bar height. The offsets used to be magic numbers scattered across many CSS files, so moving one bar meant finding every dependent by hand; measured once, a bar that appears, hides or grows carries every overlay with it. **Reopen if:** the header and footer become part of the layout rather than floating, so the canvas is simply the remaining flex box.

Every use keeps a static fallback for the first paint, before the observers fire: `var(--chrome-top, 66px)`, and `var(--chrome-bottom, 19px)` on desktop or `var(--chrome-bottom, calc(57px + env(safe-area-inset-bottom)))` on mobile.

Both envelopes publish rounded down (`Math.floor`). A `top:` or `bottom: var(...)` puts a panel's edge at the published height, so a value above the bar's true fractional height lifts the edge off the bar, a 1px gap at fractional device pixel ratios (seen on Chrome for Android). Published at or under the true height, panels tuck beneath the opaque bars, whose z-index sits above the docked panels.

**Still hand-keyed:** the bars' own row heights (22, 44 and 52, in each bar's CSS), the 12 and 16px gutters, each overlay's gap, and mobile's top overrides (the safe-area inset plus literal `82px`-based values). Treat the tables below as the source of truth for what each number means, and grep for a number before changing a bar height.

## Desktop

This is the layout with a mouse and a desktop user agent (no `html.is-mobile`). The header is one absolutely positioned, full-width column pinned to the top; the footer is pinned to the bottom; everything else floats over the canvas.

| Element | Class | Anchor | z-index | File |
| --- | --- | --- | --- | --- |
| Header wrapper | `.solenoid-header` | `top: 0`, full width, flex column | 6 | `Header.css` |
| Menu bar (row 1) | `.solenoid-menubar` | height **22px** | 2 | `MenuBar.css` |
| Top toolbar (row 2) | `.solenoid-topbar` / `.solenoid-apptools` | height **44px** | 1 / 6 | `TopBar.css`, `AppToolbar.css` |
| Tablet touch actions (in row 2) | `.solenoid-topbar__group--tablet` | inside the 44px row; adds no height | none | `TopBar.css` (under `html.is-tablet`) |
| Status bar (footer) | `.solenoid-statusbar` | `bottom: 0`, height **19px**, full width; publishes `--chrome-bottom` | 6 | `StatusBar.css` |
| Nav and zoom pill | `.solenoid-nav` | `top: chrome-top + 14px; right: 12px` (upper right) | 5 | `NavMenu.css` |
| Navigator (outline) | `.solenoid-outline` | `left: 12px` (upper left); the open-pill also `top: chrome-top + 14px` | 5 | `OutlinePanel.css` |
| Web-demo banner | `.solenoid-webdemo` | `top: chrome-top + 14px` | 5 | `WebDemoBanner.css` |
| Align and distribute pill | `.solenoid-selbar` | `top: chrome-top + 10px; left: 50%` (top center), shown only with two or more nodes selected | 7 | `selectionActions.css` |
| Socket legend | `.solenoid-legend` | `bottom: chrome-bottom + 129px; right: 16px`, stacked above the minimap; drops to `+ 11px` when the minimap moves or hides | 100 | `SocketLegend.css` |
| Minimap | `.solenoid-minimap` | `bottom: chrome-bottom + 11px; right: 16px`, about 105px tall | 100 | `Minimap.css` |
| HUD stack (alerts, pins, problems, comments) | `.solenoid-hud-stack` | `top: chrome-top + 58px; right: 12px` (the pill's 14 + the pill's 34 + a 10 gap) | 110 | `hudStack.css` |
| Cable inspector | `.solenoid-cable-inspector` | bottom left | 110 | `cableInspector.css` |
| Command palette | `.solenoid-cmdpalette` (with `-scrim` and `--persistent`) | docked at the bottom (`left: 50%; bottom: chrome-bottom + 21px`), a full-screen scrim behind | 300 as a modal; 150 when persistent | `CommandPalette.css` |
| Docked report panel | `.report-panel--docked` | `top: chrome-top; right: 0; bottom: chrome-bottom; width: 440px` (through `--report-dock-*`) | 5, beneath the header, with the minimal `--dock-shadow` edge lift (DESIGN.md §4) | `ReportOverlay.css` |
| Node inspector panel | `.inspector-panel` | `top: chrome-top; right: 0; bottom: chrome-bottom; width: 340px` (through `--inspector-w`) | 5 on desktop and as the mobile sheet alike, beneath the header so the bars and their pop-overs paint over it; `--dock-shadow` on desktop, none on the full-width sheet; the align pill hides while the mobile sheet is open | `InspectorPanel.css` |

**The command palette.** The persistent (always-on) palette is ambient chrome, not an invoked overlay: its scrim doesn't cover the canvas, only its own box takes input, and at 150 it yields to the 200 modal band (Settings, help, shortcuts), so dialogs cover it.

**The navigator.** Collapsed, it is a small top-left pill (the navigator toggle and search, side by side) with a thin border, since the thick overlay border is reserved for the usable panels; expanded, the panel wears the overlay border and a soft shadow.

### The top bar

- The top bar sits below the menu bar in the stacking order, so the menu bar's dropdowns paint over it. The top bar has its own z-index and is therefore its own stacking context, which is why the node-budget modal renders as an App-level sibling of the status bar.
- Its bottom edge is a hairline border with a 2px accent highlight beneath it.
- Icon buttons group into pills: the pill carries the border and fill, and the 28px buttons inside are borderless and fill on hover. With no padding, the 28px buttons plus a 1px border make each pill 30px, the same height as the apptools pill, so every pill in the bar is one height. The accent swatch and the theme toggle stay separate buttons.
- The zoom pill has 2px of padding, so its outer height is 34px (28 + 2·2 + 2·1) and it aligns with the navigator's open-pill (32px buttons plus a 1px border) on both edges.
- The app-menu trigger (a round surface pill with the Solenoid mark masked inside) and the navigator toggle are hidden on desktop, where the wordmark and the floating open-pill do their jobs; mobile.css reveals them. Without the base hide, the navigator toggle would render as a duplicate in the desktop bar. The document name in the top bar is likewise mobile-only.
- A decorative art slot fills the leftover middle of the bar and can shrink to nothing (`min-width: 0`).
- The Tidy options pop-over (`.solenoid-tidy-options`) anchors under the Tidy button, opened by a slim chevron beside it, and overflows down over the canvas, since the header doesn't clip.
- Hover styling applies only where a pointer can hover (`@media (hover: hover)`). On touch, `:hover` sticks after a tap until the next tap elsewhere, which masked a toggle's real state. A hovered button that is on keeps its accent ring and fill, because a plain `:hover` rule outranks the single-class `--on`.

### Tablets

A tablet (`html.is-tablet`: a coarse pointer without a mobile user agent, `IS_TABLET` in `coarse.ts`) runs this desktop layout, because `IS_MOBILE` requires a mobile user agent and tablet Chrome reports non-mobile (`userAgentData.mobile === false`). iPadOS sends a desktop user agent on purpose. So a tablet gets no bottom action bar; the top bar carries the touch actions instead (palette, undo and redo, select, group, delete; `TabletActions.tsx`) as ordinary 28px pill buttons in the existing row. A button dimmed because it needs a selection is still tappable, because the selection is polled every 200ms and a disabled button would swallow the first tap after a fresh select. The touch target grows to 44px (the 28px button plus 8px above and below), the platform minimum, through a pseudo-element rather than padding, so the laid-out pill stays 30px.

Two things are deliberately not carried over from the mobile bottom bar, so don't complete the parity: **Add node** (Insert ▸ Add node… in the menu bar covers it, and a ➕ up top would be a second), and the **raised FAB treatment** (a thumb-reach accommodation for a phone's bottom edge; up top it would only be a loud button, and the Quiet Accent Rule reserves accent for type and state, not emphasis). The touch add gesture is a long-press on empty canvas, the browser's native long-press turned into `contextmenu` and routed by `canvasContextMenu.ts`. The full set of add paths is long-press or right-click on the canvas, the mobile bar's ➕, the `A` key, and Insert ▸ Add node…. The gesture inventory is [[touch-gestures]].

**The portrait wrap.** The desktop bar doesn't fit a tablet in portrait, so below 1100px it wraps: it fills a line and pushes the overflow to the next one. Nothing is reordered, and nothing is forced onto a chosen row.

- The one exception is the pinned trio (theme, Reference and Settings, inside `.solenoid-apptools`), which must hold the top-right corner. An in-flow flex item can't do that, since it lands wherever its line ends, so the trio is `position: absolute` and the bar reserves its column with `padding-right: calc(12px + var(--tablet-pinned-w))`, the trio's width plus the usual 8px gap. `--tablet-pinned-w` is slightly generous: over-reserving leaves a little slack, while under-reserving would let a wrapped row slide under the trio. Everything else then wraps normally against the narrower line. Reserving on every line costs a little width on row 2, the price of the corner staying put.
- Don't fix this with a forced break. A full-width, zero-height break element ends the line whether or not more would have fit, which splits the bar into two rows rather than wrapping it. Don't add `order` rules either: they scramble the landscape row, which fits and needs no help.
- Dividers are hidden, since across two rows they would orphan at a row edge; the pill outlines already separate the groups.
- The wrap is safe because the header height is measured: a second row pushes every top-anchored overlay down on its own.

Measured in Chromium: at 768 and 800px, row 1 holds `SOLENOID file layout` plus the trio and row 2 `cable palette undo/redo sel/grp/del`, a bar of 80px (an envelope of 102). At 1024px row 1 also takes `cable` and the palette, and only `sel/grp/del` wraps. At 1280px it is one 44px row, with the trio flush at the padding edge.

**Mobile browser toolbars.** A tablet still runs inside a mobile browser with dynamic toolbars, and the device has a navigation bar, so the layout viewport (`100vh`) is taller than the usable screen.

- `.solenoid-app` is `100dvh` app-wide (`App.css`, with a `100vh` fallback line), not gated on `is-mobile`. Gating it left the desktop layout's bottom chrome (status bar, minimap, navigator) below the usable screen on tablets. Desktop browsers have no dynamic toolbars, so `dvh` equals `vh` there.
- Tall overlays carry `vh` and `dvh` declaration pairs (the Function Reference, the Report window, the Settings, Shortcuts and help dialogs, the table and pivot pop-ups, the Add menu, the command palette, the drill-in run controls). The `dvh` line wins where supported and is never larger than the `vh` value, so it only ever shrinks. Keep the pair when adding a tall overlay.
- The zoom pill's fullscreen button gates on `IS_COARSE` (touch-primary), not `IS_MOBILE`, so a tablet's desktop pill keeps it. A tablet has no F11 key; mouse desktops keep F11 and the browser's own.

## The desktop window frame (the Tauri shell)

The menu bar is the title bar: `.solenoid-menubar` carries `data-tauri-drag-region` (`MenuBar.tsx`), and no separate title strip exists. Everything here is scoped to `html[data-shell="desktop"]` (`main.tsx`), so the browser build is untouched. The window has no native decorations on either platform; what draws minimize, maximize and close differs.

| | Windows | Linux |
| --- | --- | --- |
| Native bar removed by | decorum's `create_overlay_titlebar` (`lib.rs`) | `set_decorations(false)` (`lib.rs`); decorum's overlay is not created |
| Controls | decorum's injected buttons in `[data-tauri-decorum-tb]`, a fixed click-through overlay at the top right, restyled to the bar by `desktopFrame.css`: 22px tall, 37px wide, glyphs at 8.5px and weight 200, in the accent ink. decorum sets these sizes inline, so the overrides need `!important`. | `WindowControls.tsx` (`.solenoid-wincontrols`), in flow at the menu bar's right end, 3 × 38px, gated by `OWN_WINDOW_CONTROLS` |
| Bar reserve | `.solenoid-menubar { padding-right: 120px }` keeps menus out from under the overlay | none: `:has(.solenoid-wincontrols)` zeroes the reserve (`WindowControls.css`) |
| Maximize hover | decorum's Snap Layouts overlay | a plain toggle |

- **Linux control styling.** Hover is the menu items' ink wash (`--accent-ink` at 14%); close hovers to the error red (`--sol-error`) with white ink. Glyphs are 10px SVGs at a 1px stroke (even-sized, never a text glyph). The maximize glyph follows `isMaximized()` on every resize. The window calls are allowed by the `core:window:allow-*` lines in `src-tauri/capabilities/default.json`.
- **Linux draws its own controls** instead of decorum's ([[C109]] linuxOwnWindowControls, which records decorum 1.1.1's three failures there).
- **Linux resize.** The undecorated window has no frame to grab. Tauri's own handler starts a resize from a press within 5px of an edge but never changes the cursor, so `WindowControls.tsx` portals eight `.solenoid-wingrip` strips to `body` (5px edges, 10px corners, z-index 10000, resize cursors) that call `startResizeDragging`. They claim the same 5px the native handler already takes, and unmount while the window is maximized or fullscreen.
- **On Linux nothing inside a node may become a GPU layer** ([[#The desktop window frame (the Tauri shell)]]; `src-tauri/src/linux_webview.rs`, called from `lib.rs`). WebKitGTK rasterizes a compositor layer at 1× and stretches the bitmap by the viewport's `scale()`, and a transformed element with any composited descendant must itself become a layer. So one promoted box inside one node puts the whole React Flow viewport on a stretched layer, and zooming in pixelates the canvas.
  - Two promoters of node content are switched off: the `AsyncOverflowScrolling` feature (every scrollable box in a node) and 2D canvas acceleration (the canvas-drawn charts).
  - The third promoter is CSS: WebKit runs an `opacity`, `transform` or `filter` transition on the GPU by promoting the element, so a hover fade inside a node flipped the whole canvas onto a layer and back (a 1px squish on hover, and at far zoom-out a second of black while the entire graph rasterized at 1×). `main.tsx` marks the engine (`html[data-webview="webkitgtk"]`), and `desktopFrame.css` turns transitions off inside `.react-flow__viewport` and drops the load-time node reveal. The cable flow animates `stroke-dashoffset`, which is never accelerated, so it keeps running.
  - GPU compositing itself stays on, so the canvas paints into the root layer's tiles at the real scale. The blunt alternative, `WEBKIT_DISABLE_COMPOSITING_MODE=1`, also fixes it but moves all painting to the CPU.
  - Any new trigger brings the blur back: `will-change`, `translateZ` or other 3D transforms, `<video>`, WebGL, or `position: fixed` inside a node. A new style that promotes an element inside a card (a transform animation, `will-change`, a filter) is checked against WebKitGTK before it ships, with `WEBKIT_SHOW_COMPOSITING_DEBUG_VISUALS=1`, where a green box around the graph is the viewport layer.
  - This is the mobile GPU budget ([[html-in-canvas#The GPU texture budget]]) decided per engine: layer promotion is chosen by the app, not left to the browser. **Reopen if:** WebKitGTK rasterizes layers at their transformed scale.
- **A debug build is marked on the window itself.** `lib.rs` sets the bug-badged icon under `cfg(debug_assertions)`, from `src-tauri/icons/debug/icon.rgba` (raw RGBA, so no PNG decoder ships; `scripts/debug-icon.mjs` regenerates it from `icons/icon.png`). Release builds never carry it. The two builds pin to the panel as separate apps (`scripts/install-linux-launchers.mjs`): the debug launcher runs through a `solenoid-debug` symlink, because GTK takes `WM_CLASS` from the program name, and a distinct class is what the panel matches a launcher by.

## Mobile

The mobile layout applies under `html.is-mobile`, set in `main.tsx` from `IS_MOBILE`: a coarse pointer and a mobile user agent. That covers phones in any orientation, including landscape, where a width breakpoint would miss them, but not mouse-driven laptops, tablets, or a phone that requested the desktop site (a desktop user agent gets the desktop layout, as the user asked). The overrides live in `mobile.css`, imported last in `App.tsx` so they win the cascade. The desktop layout stays the source of truth; mobile enlarges tap targets and keeps floating chrome from overflowing. Canvas touch navigation comes from `touch-action: none` on the canvas, and in-node targets matter only while a node is selected, since touch gates all node interaction on selection (`socket.css`).

The top chrome becomes two rows.

| Element | Class | Height and anchor | Notes |
| --- | --- | --- | --- |
| Row A, the accent menu bar | `.solenoid-menubar` | `padding-top: safe-area`, about 30px of content, z-index **8** | The document name and caret only, beside the wordmark; carries the notch inset. |
| Row B, the neutral tools bar | `.solenoid-topbar` | **52px** | Menu, navigator, layout tools, then accent, Reference and Settings. |
| Bottom action bar | `.solenoid-mobile-bar` | `bottom: 0`, full width, about 57px plus `safe-area-inset-bottom`, z-index 100 | Undo, Redo, the ➕ FAB, Select, Delete. `display: flex` only on mobile (`MobileControls.css`, shown by `mobile.css`). |

**The mobile top-chrome edge is `safe-area-inset-top + 82px`** (30 for Row A plus 52 for Row B). Every top-anchored mobile overlay clears this number, and it is written literally in several places, so keep them in sync:

| Overlay | Mobile `top` | File |
| --- | --- | --- |
| Menu hamburger sheet | `82px + safe-area` (right at the edge) | `mobile.css` |
| Nav pill | `92px + safe-area` (the edge plus a 10 gap) | `mobile.css` |
| Navigator panel | `88px + safe-area` (its bottom derives: `chrome-bottom + 27px`) | `mobile.css` |
| Align pill (`.solenoid-selbar`) | `92px + safe-area`, level with the nav pill | `selectionActions.css` |
| Command palette (top-anchored on mobile) | `92px + safe-area`, level with the nav pill | `CommandPalette.css` |
| Web-demo notice | `48px + safe-area` | `mobile.css` |

The align pill must sit at 92px, level with the nav pill. A value sized for a single-row top bar (56px) lands inside Row B and covers the toolbar. If the two rows are retuned, this number and the others in the table move together.

The minimap and the socket legend are `display: none` on mobile (`mobile.css`). Bottom-anchored floating chrome (the docked Conduit toolbar, the cable inspector, the drill-in controls, toasts, the navigator) lifts off the measured bar: `calc(var(--chrome-bottom, calc(57px + env(safe-area-inset-bottom))) + 27px)` or `+ 39px`. The lift clears the raised FAB, which sticks about 8px proud of the bar and casts a shadow; the safe-area inset rides inside the measured height.

### Row A and Row B

- **Row B** is 52px, a touch taller than the desktop's 44px, so the accent underline reads as a real separator and the buttons sit visibly centered. It keeps the desktop separator (the hairline plus the 2px accent underline) from the base rule. It hides the file group (Save and Open live in the hamburger sheet), the dividers, the art slot, the cable-shape toolbar, the mark and its own copy of the document name, and surfaces the layout group (Tidy, Cleanup, collapse all, snap) just left of the apptools. Every Row B control is 34px (the nav-style buttons with 17px glyphs, the apptools buttons, the round navigator toggle beside the ⋯ app-menu button at the left edge), so the layout pill equals the apptools pill at 36px.
- **The apptools** (accent, Reference, Settings) sit at the right of Row B. The light and dark toggle moves into the accent palette pop-over (40px below), and the lone accent button rounds to a circle. Their 14px glyphs use stroke width 2, so they don't read as hairlines next to the heavier bottom-bar icons.
- **Row A** is the menu bar turned into a thin accent strip: accent background, accent ink, the safe-area inset as top padding, its desktop menu items hidden (they live in the hamburger sheet). Its center block is in flow on mobile, at 30px and left-aligned, because it is what gives the row its height; out of flow the menu bar collapses to 0. The wordmark beside the name is masked in the bar's own ink and is 24px tall; it must stay under the row's 30px, or Row A grows and the literal 82px envelope is wrong everywhere it is spelled.
- **The documents menu** is portaled to `body` and pinned 10px from both screen edges, so a long name truncates within the row instead of pushing controls off; its `top` comes inline from the trigger's measured rect.

### Mobile overlays

- **The hamburger sheet** sits below both rows (`82px + safe-area`), sized to its widest content up to `min(280px, 86vw)`. Its height is cropped (`100dvh − 150px` minus both insets) so it never runs under the bottom-left undo and redo pill, whose top sits about 86px plus the inset above the bottom. Keyboard-shortcut hints are hidden, since a phone has no keyboard and they stretch every row. Its cables section re-renders the top bar's `CableShapeSelector` (hidden up there on touch) with finger-sized segments on one centered row.
- **The nav pill** keeps only the canvas controls, Fit and Lock: zoom in and out are dropped (the pinch does it), and the cable-flourish button is desktop-only. Its buttons are 30px, scoped to the pill so Row B's layout buttons keep their own size.
- **The navigator** loses its collapsed open-pill, because Search lives in the bottom bar and opens the navigator focused on its search field. The panel is `min(248px, 84vw)` wide.
- **The web-demo notice** is narrow and centered between the corner controls (`max-width: calc(100vw − 120px)`), wraps its text, and drops the desktop download button.
- **The command palette** anchors to the top with the input first and the results below, because the on-screen keyboard owns the bottom half; desktop keeps the input at the bottom. Rows get touch-sized padding, and shortcut hints are hidden.
- **The Add menu** is compact enough that a standard 12-item menu renders without scrolling (rows of about 30px), capped at `92vw` and `min(86dvh, 448px)` so an open from the ➕ never runs off the screen.
- **The docked Conduit toolbar** pins 12px from the left, lifted `39px` over the bottom bar.
- **The table editor pop-up** caps its scroll area at `48dvh`, so the on-screen keyboard leaves the active row visible.
- **The Function Reference** panel is `92vw` by `88dvh`, leaving a tappable backdrop margin on every side. Its tabs scroll sideways with a 52px reserve on the right for the pinned 40px close chip; its first header row wraps so search keeps a full line; the stats legend is hidden; the table pans sideways with a 240px Notes column; and each row's + is always visible, since touch has no hover.
- **Settings** rows carrying a wide control (a text input, the palette stack) stack the control full width under the text, with the palette's swatches left-aligned; below 540px the shortcuts grid is one column.
- Node chrome, the Connection dialog and the Settings and Shortcuts overlays get finger-sized versions of their small buttons and switches.

## Push or overlay: how the pieces interact

- **Navigator open** sets `body.solenoid-nav-open` (toggled in `OutlinePanel.tsx`). The navigator overlays the canvas; it does not push the canvas or the right-side chrome. Its only effect is to shove the two left-anchored floating toolbars right so they clear the panel (12px + 248px): the docked Conduit toolbar (`conduit.css`) and the cable inspector (`cableInspector.css`). Desktop only (`html:not(.is-mobile)`). The nav pill, HUD, legend and minimap (all right- or bottom-anchored) don't move.
- **Minimap hidden or moved to the top.** The `minimapPosition` setting (`"bottom"`, `"top"` or `"hide"`, `settingsStore.ts`) stamps `html.minimap-top` or `html.minimap-hidden`. The only thing that reflows is the socket legend, which drops from `bottom: chrome-bottom + 129px` (stacked above the minimap) to `bottom: chrome-bottom + 11px` (into the freed corner; `SocketLegend.css`). At the top, the minimap sits below the zoom pill. Nothing else keys off the minimap. On mobile the minimap is always hidden, so the legend already sits low.
- **Report undocked** (desktop): the modal backdrop starts at `--chrome-top`, so the menu and top bar stay visible and usable above it (`ReportOverlay.css`); on mobile it is full-screen.
- **Report docked** (desktop): `html.sol-report-docked` (`reportStore.ts`). This is a real push. It defines `--report-dock-w: 440px`, with `--report-dock-top` and `--report-dock-bottom` derived from `--chrome-top` and `--chrome-bottom`, and then (`ReportOverlay.css`):
  - shrinks the main canvas (`.sol-rf-appcanvas`) by `--report-dock-w`, which carries the minimap and the Add menu, since they live inside it;
  - shifts `.solenoid-nav`, `.solenoid-hud-stack` and `.solenoid-legend` (fixed to the app, not inside the canvas wrapper) right by their gutter plus `--report-dock-w`;
  - re-centers `.solenoid-cmdpalette` on the canvas, at a width of `clamp(340px, 42% of the canvas, 480px)`.
  The header, the status bar and the left navigator are full-width or left-anchored and untouched.
- **Inspector docked** (desktop and tablet): `html.sol-inspector-docked` (`inspectorStore.ts`), the same push scaled to `--inspector-w: 340px` (`InspectorPanel.css`). The canvas wrapper shrinks; the nav pill, HUD stack and socket legend shift; the command palette re-centers on the canvas. It is the report dock's full set, kept in step. The two right docks are mutually exclusive: the one opened last takes the slot and the other closes, because the author ruled side by side too big. So their squeeze rules never stack.
- **Presenting**: `html.solenoid-presenting` (`PresentationOverlay.tsx`) hides nearly all chrome: the header, nav pill, status bar, navigator and its open-pill, legend, minimap, mobile bar and HUD (`PresentationOverlay.css`). The canvas is the slide.
- **Drilled into a composite**: `html.sol-drilled-in` (`flow/FlowCompositeOverlay.tsx`). The app frame stays. It hides the main minimap (the drill-in host renders its own) and the navigator and its open-pill (`compositeEditor.css`). The drill-in adds a top-left breadcrumb strip (`.solenoid-composite-editor__strip`, `top: 74px` on desktop and `88px + safe-area` on mobile) with a run-controls panel tucked under it (`top: 120px`). Its backdrop is z-index 4, above the canvas and below the chrome, so the app frame stays usable. The covered main canvas stops painting ([[html-in-canvas#The GPU texture budget]]).

## The z-index ladder

Chrome only; nodes are 0, and cables and overlay planes are negative.

```
1    .solenoid-topbar (local, inside the header)
2    .solenoid-menubar (local; 8 on mobile)
4    composite drill-in backdrop
5    nav pill / navigator / web-demo banner / docked report and inspector panels (under the header on purpose: the docks tuck beneath the bars)
6    header / status bar / apptools palette
7    align pill / isolate endpoints
20   menu-bar dropdown (local to the header) / Tidy options pop-over (local to the top bar, top: 100% + 6px under the layout group; it overflows onto the canvas)
60   docked Conduit toolbar / node-budget modal
100  minimap / socket legend / mobile bottom bar
110  HUD stack / cable inspector
150  persistent command palette
200  Add menu (201 submenu) / Settings / Shortcuts / document-title menu
300  command palette scrim
9999 socket context menu
```

The menu bar's 2 and the top bar's 1 are local values inside `.solenoid-header`, which is 6 at the app level. The canvas gets its own stacking context through `isolation: isolate` (`canvas.css`), which is why the minimap needs 100 to paint over node cards.

Rule of thumb: floating canvas pills take 5 to 7, corner panels 100 to 110, modals and menus 200 and up, and transient context menus the top. A new overlay picks its band by what it must sit above. Something above the HUD but below modals goes in the 110 to 199 gap.

**Notice toasts** (`.solenoid-notices`, `NoticeToasts`) stack transiently above the chrome. A notice may carry one optional action button (`NoticeAction`) beside its message and the dismiss ×; the network-permission prompt uses it for Allow (`connectionStore`). Keep it to a single verb button; anything richer belongs in a panel, not a toast.

## Before you add or move any chrome

1. **Which envelope does it clear?** Top-anchored: `var(--chrome-top, 66px)` (mobile is still the literal `safe-area + 82px`). Bottom-anchored: `var(--chrome-bottom, 19px)` on desktop, and `var(--chrome-bottom, calc(57px + env(safe-area-inset-bottom)))` plus a 27 or 39px FAB lift on mobile. Reuse the sibling overlay's expression; don't invent one.
2. **Does it need a mobile override?** `mobile.css` is gated on `html.is-mobile` and imported last, so it wins the cascade. The top envelope grows from 66 to 82 plus the inset, and there is a bottom action bar that desktop lacks. Almost every floating element needs a mobile `top` or `bottom`.
3. **Does it collide with a neighbor when something reflows?** A left-anchored element joins the `body.solenoid-nav-open` shove. A right-anchored one joins the `sol-report-docked` and `sol-inspector-docked` shifts. One that should vanish while presenting or drilled in joins those hide lists.
4. **Safe-area insets.** Any element touching a screen edge on mobile needs `env(safe-area-inset-*)` in its offset (the notch at the top, the home indicator at the bottom), unless it derives from `--chrome-bottom`, which already carries the bottom inset.
5. **Pick a z-index band** from the ladder; don't wedge an arbitrary value between two siblings.
6. **Grep the magic number** you are about to change (for example `rg '82px'` or `rg 'report-dock-top'`): the same height is written in several files, and they must move together.

## Node header label metrics

`LABEL_MAX_HEIGHT = 60` (`nodeKit.tsx`): the label textarea's maximum height is 4 lines (4 × a 13px line height) plus 6px of symmetric padding, 58, plus a 2px buffer. It must stay in step with the 4-line clamp on `.solenoid-node__label-display`, or an editing title and the static title disagree in height.
