# Layout & chrome geometry (desktop + mobile)

Notes for future-me. The recurring bug class here is **a floating overlay that overlaps a
bar** — the offsets are hand-keyed magic numbers scattered across many CSS files, and they
all trace back to the same few bar heights. When you move or resize a bar, every dependent
offset has to move in lockstep or something ends up covering something. This file is the map:
what sits where, what each offset is measured from, and what to check before you add or move a
piece. Citations are FILE + SELECTOR only — never line numbers, which rot on every edit;
grep the selector.

**BOTH envelopes are now vars.** `--chrome-top` is MEASURED by `Header.tsx` (2026-08-01);
`--chrome-bottom` by `chromeBottom.ts` (2026-08-05) — the status bar and the mobile action
bar each register with it and the var is the max of the visible bars' heights (a
display:none bar measures 0, so whichever bar owns the bottom edge wins; the mobile bar's
height INCLUDES its safe-area padding, so the var carries the inset). Every bottom-anchored
overlay now derives: desktop offsets are `calc(var(--chrome-bottom, 19px) + gap)`, and the
mobile overrides are `calc(var(--chrome-bottom, calc(57px + env(safe-area-inset-bottom)))
+ lift)` where the lift (27/39px) clears the raised FAB. Mobile overrides still win the
cascade as before — only their base number is measured now.

**Still hand-keyed:** the row heights themselves (`22`/`44`/`52`, the bars' own CSS), the
`12`/`16` gutters and per-overlay gaps, and **mobile's TOP overrides** (safe-area + `82px`
literals). Treat the tables below as the source of truth for "what number means what," and
grep for a number before changing a bar height.

---

## Desktop stack (mouse / desktop UA, no `html.is-mobile`)

The header is one absolutely-positioned full-width column pinned top; the footer is pinned
bottom; everything else floats over the canvas.

| Element | Class | Anchor | z-index | File |
| --- | --- | --- | --- | --- |
| Header wrapper | `.solenoid-header` | `top:0`, full width, flex column | 6 | `Header.css` |
| — Menu bar (row 1) | `.solenoid-menubar` | height **22px** | 2 | `MenuBar.css` |
| — App/top toolbar (row 2) | `.solenoid-topbar` / `.solenoid-apptools` | height **44px** | 1 / 6 | `TopBar.css`, `AppToolbar.css` |
| — ↳ tablet touch actions (in row 2) | `.solenoid-topbar__group--tablet` | **inside** the 44px row — adds no height | — | `TopBar.css` (gated `html.is-tablet`) |
| Status bar (footer) | `.solenoid-statusbar` | `bottom:0`, height **19px**, full width; publishes `--chrome-bottom` | 6 | `StatusBar.css` |
| Nav/zoom pill | `.solenoid-nav` | `top: chrome-top + 14px; right:12px` (upper-right) | 5 | `NavMenu.css` |
| Navigator (outline) | `.solenoid-outline` | `left:12px` (upper-left); open-pill also `top: chrome-top + 14px` | 5 | `OutlinePanel.css` |
| Align/distribute pill | `.solenoid-selbar` | `top: chrome-top + 10px; left:50%` (top-center), shown only when ≥2 nodes selected | 7 | `selectionActions.css` |
| Socket legend | `.solenoid-legend` | `bottom: chrome-bottom + 129px; right:16px` (stacks above minimap; drops to `+ 11px` when the minimap moves/hides) | 100 | `SocketLegend.css` |
| Minimap | `.solenoid-minimap` | `bottom: chrome-bottom + 11px; right:16px`, ~105px tall | 100 | `Minimap.css` |
| HUD stack (alerts/pins/problems/comments) | `.solenoid-hud-stack` | `top: chrome-top + 58px; right:12px` | 110 | `hudStack.css` |
| Cable inspector | `.solenoid-cable-inspector` | bottom-left | 110 | `cableInspector.css` |
| Command palette | `.solenoid-cmdpalette` (+`-scrim`, `--persistent`) | bottom-docked (`left:50%; bottom: chrome-bottom + 21px`), full-screen scrim behind | 300 modal · **150 persistent** (the always-on bar yields to the 200 modal band: Settings/help/shortcuts) | `CommandPalette.css` |
| Docked report panel | `.report-panel--docked` | `top: chrome-top; right:0; bottom: chrome-bottom; width:440px` (via `--report-dock-*`) | 90 | `ReportOverlay.css` |
| Node inspector panel | `.inspector-panel` | `top: chrome-top; right:0; bottom: chrome-bottom; width:340px` (via `--inspector-w`) | 90 (mobile sheet: **5**, beneath the header so the bar's popovers/sheets paint over it; align pill hides while open) | `InspectorPanel.css` |

> **Tablet (`html.is-tablet` = coarse pointer, NOT mobile — `IS_TABLET` in `coarse.ts`):** a
> tablet runs this DESKTOP stack, so it gets no bottom action bar. The top bar grows the
> touch actions (palette · undo/redo · select · group · delete — `TabletActions.tsx`), and
> because the desktop bar does not fit a tablet in PORTRAIT, the bar **wraps** below
> `1100px`: fill the line, push the overflow to the next one. Nothing is reordered and
> nothing is forced onto a chosen row.
>
> Two things are deliberately NOT carried over from the mobile bottom bar — do not
> "complete" the parity: **Add node** (Insert ▸ Add node… in the menu bar covers it;
> a ➕ up top would be the second), and the **raised FAB treatment** (a thumb-reach
> accommodation for a phone's bottom edge; up here it's just a loud button, and the
> Quiet Accent Rule says accent conveys type/state, not emphasis).
> Corrected 2026-08-06: this note used to claim a "canvas double-tap add" — no such
> gesture exists on any device (the canvas SWALLOWS dblclick in capture to disable
> rete's double-click zoom). The touch add gesture is LONG-PRESS on empty canvas
> (the browser's native long-press → `contextmenu`, routed by `canvasContextMenu.ts`).
> Full add paths: long-press/right-click canvas, mobile bar ➕, the `A` shortcut,
> Insert ▸ Add node…. The gesture inventory lives in `touch-gestures.md`.
>
> The exception is the **pinned trio** — theme · Reference · Settings
> (`.solenoid-apptools`) — which must hold the top-right corner. An in-flow flex item
> can't do that (it lands wherever its line ends), so it is `position:absolute` and the bar
> reserves its column with `padding-right: calc(12px + var(--tablet-pinned-w))`. Everything
> else then wraps normally against the narrower line. Reserving on every line costs a
> little width on row 2; that is the price of the corner staying put.
>
> **Do not "fix" this with a forced break.** A full-width zero-height break element ends the
> line whether or not more would have fit — that is a two-row SPLIT, not a wrap, and it
> shipped once (breaking after the layout pills with usable width left over). Likewise, do
> not add `order` rules here: they scrambled the LANDSCAPE row, which fits and needs no
> help. Dividers are hidden so none orphans at a row edge; touch reach comes from a
> pseudo-element tap target, not padding, so a wrapped row is still 30px.
>
> Measured in Chromium — 768/800: `SOLENOID file layout` + trio, then `cable palette
> undo/redo sel/grp/del`, bar 80px (envelope 102). 1024: row 1 also takes `cable` and the
> palette, only `sel/grp/del` wraps. 1280: one 44px row, trio flush at the padding edge.

**The header envelope is MEASURED, not written down (2026-08-01).** `Header.tsx` observes
its own height and publishes it as **`--chrome-top`** on `:root`; every top-anchored overlay
offsets from it:

| Overlay | Offset | Was |
|---|---|---|
| Nav/zoom pill · Navigator · web-demo banner | `calc(var(--chrome-top) + 14px)` | `80px` |
| Align pill | `calc(var(--chrome-top) + 10px)` | `76px` |
| HUD stack | `calc(var(--chrome-top) + 58px)` (pill top 14 + pill 34 + gap 10) | `124px` |
| Docked report | `var(--chrome-top)` | `66px` |

Each keeps a **static fallback** (`var(--chrome-top, 66px)`) so the first paint is correct
before the observer fires. Both envelopes publish **rounded DOWN** (`Math.floor`): `top:`/`bottom: var(...)`
puts a panel's edge AT the published height, so a value above the bar's true fractional
height lifts the edge off the bar — a 1px gap at fractional device pixel ratios (seen on
Chrome Android). Published at-or-under, panels tuck beneath the opaque bars, whose
z-index sits above the docked panels. On desktop the measured value is the old 66px (22 + 44), plus a
2px accent underline ≈ 68px to the canvas.

**Why this changed:** these were six hand-keyed numbers all encoding one envelope, which is
the bug this file was started for (below). The tablet wrap made the envelope CONDITIONAL —
two rows in portrait, one in landscape, the wrap point depending on the viewport — so it
stopped being a number anyone could write down at all. Pinned by `touchActions.test.ts`.
**Mobile keeps its own explicit overrides** (they carry `safe-area` insets and win later in
the cascade) — the table below is still the mobile truth.

## Tablets — the DESKTOP stack inside a mobile browser (2026-07-22)

A tablet gets the full desktop UI: `IS_MOBILE` requires a mobile UA, and tablet Chrome
reports non-mobile (`userAgentData.mobile === false`), so `html.is-mobile` never sets.
But the browser still has dynamic toolbars (URL bar) and the device a navigation bar —
the layout viewport (`100vh`) is TALLER than the usable screen. Three consequences,
all landed together:

- **`.solenoid-app` is `100dvh` app-wide** (`App.css`, with a `100vh` fallback line) —
  NOT gated on `is-mobile` anymore (the old mobile-only override left the desktop
  stack's bottom chrome — status bar, minimap, navigator — below the usable screen on
  tablets). Desktop browsers have no dynamic toolbars, so dvh == vh there.
- **Tall overlays carry `vh` + `dvh` declaration pairs** (Function Reference, Report
  window, Settings/Shortcuts/help dialogs, table/pivot popups, add menu, command
  palette, drill-in run-controls): the dvh line wins where supported and is always ≤
  the vh value, so it only ever shrinks. Keep the pair when adding a tall overlay.
- **The zoom pill's fullscreen button gates on `IS_COARSE`** (touch-primary), not
  `IS_MOBILE` — a tablet's desktop pill keeps it (no F11 key on a tablet; mouse
  desktops keep F11 / the browser's own).

## Mobile stack (`html.is-mobile`: coarse pointer AND mobile UA — set in `main.tsx`)

Top chrome becomes **two rows**, both defined in `mobile.css`:

| Element | Class | Height / anchor | Notes |
| --- | --- | --- | --- |
| Row A — accent menu bar | `.solenoid-menubar` | `padding-top: safe-area`, ~30px content, z-index **8** | Doc name + caret only; carries the notch inset (`mobile.css`) |
| Row B — neutral tools bar | `.solenoid-topbar` | **52px** | menu · navigator · layout tools … accent · reference · settings (`mobile.css`) |
| Bottom action bar | `.solenoid-mobile-bar` | `bottom:0`, full width, ~57px + `safe-area-inset-bottom`, z-index 100 | Undo · Redo · ➕FAB · Select · Delete; `display:flex` only on mobile (`MobileControls.css`, shown at `mobile.css`) |

**Mobile top-chrome bottom edge = `safe-area-inset-top + 82px`** (30 Row A + 52 Row B). This
is THE number every top-anchored mobile overlay clears. It's written literally in several
places — keep them in sync:

| Overlay | Mobile `top` | File |
| --- | --- | --- |
| Menu hamburger sheet | `82px + safe-area` (right at the edge) | `mobile.css` |
| Nav pill | `92px + safe-area` (edge + 10 gap) | `mobile.css` |
| Navigator panel | `88px + safe-area` (bottom derives: `chrome-bottom + 27px`) | `mobile.css` |
| **Align pill** (`.solenoid-selbar`) | `92px + safe-area` — level with the nav pill | `selectionActions.css` |
| Command palette (top-anchored on mobile) | `92px + safe-area` — level with the nav pill | `CommandPalette.css` |
| Web-demo notice | `48px + safe-area` | `mobile.css` |

The minimap and legend are **`display:none` on mobile** (`mobile.css`). Bottom-anchored
floating chrome (docked conduit toolbar, cable inspector, drill-in controls, toasts,
navigator) lifts off the MEASURED bar: `calc(var(--chrome-bottom, calc(57px +
env(safe-area-inset-bottom))) + 27px|39px)` — the lift clears the raised FAB and its
shadow; the safe-area rides inside the measured height.

> **The bug this file was started for:** the align pill's mobile override was `56px`, sized for
> a single-row top bar. The real two-row chrome ends at `82px`, so `56` landed *inside* Row B
> and the pill overlapped the toolbar. Fixed to `92px` (level with the nav pill). If you retune
> the two rows, this number and the four above move together.

---

## Push vs. overlay — the exact interactions

Answers to the questions that keep biting:

- **Navigator open** → `body.solenoid-nav-open` (toggled in `OutlinePanel.tsx`). The
  navigator **overlays** the canvas; it does **not** push the canvas or the right-side chrome.
  Its only job is to shove the two *left-anchored* floating toolbars right so they clear the
  panel (12px + 248px): the docked conduit toolbar (`conduit.css`) and the cable inspector
  (`cableInspector.css`). Desktop only (`html:not(.is-mobile)`). Nav pill, HUD, legend,
  minimap (all right/bottom-anchored) do not move.

- **Minimap hidden or moved to top** → the `minimapPosition` setting (`"bottom"|"top"|"hide"`,
  `settingsStore.ts`) stamps `html.minimap-top` / `html.minimap-hidden`. The **only** thing that
  reflows is the socket legend: it drops from `bottom: chrome-bottom + 129px` (stacked above
  the minimap) to `bottom: chrome-bottom + 11px` (into the freed corner) — `SocketLegend.css`.
  Nothing else keys off the
  minimap. On mobile the minimap is always hidden, so the legend already sits low.

- **Report undocked** (desktop) → the modal backdrop starts at `--chrome-top`, so the menu +
  top bar stay visible and usable above it (`ReportOverlay.css`); mobile is full-screen.
- **Report docked** (desktop) → `html.sol-report-docked` (`reportStore.ts`). This is a real
  **push**: it defines `--report-dock-w:440px`, `--report-dock-top:66px`, `--report-dock-bottom:19px`
  and then (`ReportOverlay.css`):
  - shrinks the main canvas (`.sol-rf-appcanvas`) width by `--report-dock-w` (carrying
    minimap/add-menu, which live inside it);
  - shifts `.solenoid-nav`, `.solenoid-hud-stack` and `.solenoid-legend` (app-fixed, NOT
    inside the canvas wrapper) `right` by their gutter + `--report-dock-w`.
  The header, status bar, and left navigator are full-width/left-anchored and untouched. Its
  `--report-dock-top`/`--report-dock-bottom` now derive from the measured
  `--chrome-top`/`--chrome-bottom`, so a bar change flows through on its own.

- **Inspector docked** (desktop/tablet) → `html.sol-inspector-docked` (`inspectorStore.ts`),
  the SAME push mechanics scaled to `--inspector-w:340px` (`InspectorPanel.css`): canvas
  wrapper shrinks, nav pill + HUD stack shift. The two right docks are mutually exclusive —
  opening either undocks/closes the other, so their squeeze rules never stack.

- **Presenting** → `html.solenoid-presenting` (`PresentationOverlay.tsx`) hides basically all
  chrome: header, nav pill, status bar, navigator + open-pill, legend, minimap, mobile bar, HUD
  (`PresentationOverlay.css`). The canvas is the slide.

- **Drilled into a composite** → `html.sol-drilled-in` (`flow/FlowCompositeOverlay.tsx`). The app
  frame stays; it hides the *main* minimap (the drill-in host renders its own) and hides the
  navigator + open-pill (`compositeEditor.css`). The drill-in adds a top-left breadcrumb
  strip (`.solenoid-composite-editor__strip`, desktop `top:74px`, mobile `88px + safe-area`) with
  a run-controls panel tucked under it (`top:120px`). Its backdrop is z-index 4 (above canvas,
  below chrome), so the app frame is what you keep.

---

## Z-index ladder (chrome only; nodes are 0, cables/overlay planes negative)

```
1    .solenoid-topbar (local, inside header)
2    .solenoid-menubar (local; 8 on mobile)
4    composite drill-in backdrop
5    nav pill / navigator / webdemo banner
6    header / statusbar / apptools palette
7    align pill / isolate endpoints
20   menubar dropdown (local to header) / tidy-options popover (`.solenoid-tidy-options`, local to topbar, `top:100%+6px` under the layout group; header doesn't clip so it overflows onto the canvas)
60   conduit docked toolbar / node-budget modal
90   docked report panel
100  minimap / socket legend / mobile bottom bar
110  HUD stack / cable inspector
200  add menu (201 submenu) / settings / shortcuts / doctitle menu
300  command palette scrim
9999 socket context menu
```

MenuBar (z2) and TopBar (z1) are *local* values inside `.solenoid-header` (itself z6 at app
level); TopBar is positioned with its own z-index, so it is a self-contained stacking context
(this is why the node-budget modal renders as an App-level sibling of the status bar). The canvas gets
its own context via `isolation:isolate` (`canvas.css`), which is why the minimap needs z100 to
paint over node cards.

Rule of thumb: **floating canvas pills 5–7**, **corner panels 100–110**, **modals/menus 200+**,
**transient context menus top**. A new overlay picks the band by what it must sit above. If you
need it above the HUD but below modals, you're in the 110–199 gap.

---

## Before you add or move any chrome — checklist

1. **Which envelope does it clear?** Top-anchored: `var(--chrome-top, 66px)` (mobile still
   literal `safe-area + 82px`). Bottom-anchored: `var(--chrome-bottom, 19px)` on desktop,
   `var(--chrome-bottom, calc(57px + env(safe-area-inset-bottom)))` + a 27/39px FAB lift on
   mobile. Reuse the sibling overlay's expression, don't invent one.
2. **Does it need a mobile override?** `mobile.css` is gated on `html.is-mobile` and imported last
   so it wins the cascade. The top envelope roughly doubles (66 → 82+) and there's a bottom action
   bar that isn't there on desktop. Almost every floating element needs a mobile `top`/`bottom`.
3. **Does it collide with a left/right neighbor under a reflow?** If it's left-anchored, add it to
   the `body.solenoid-nav-open` shove. If it's right-anchored, add it to the `sol-report-docked`
   shift. If it should vanish while presenting/drilled-in, add it to those hide lists.
4. **Safe-area insets**: any element touching a screen edge on mobile needs `env(safe-area-inset-*)`
   in its offset (notch top, home-indicator bottom).
5. **Pick a z-index band** from the ladder above; don't wedge an arbitrary value between two
   siblings.
6. **Grep the magic number** you're about to change (e.g. `rg '82px'`, `rg 'report-dock-top'`) —
   the same height is written in several files and they must move together.

## Node header label metrics

`LABEL_MAX_HEIGHT = 60` (`nodeKit.tsx`): the label textarea's max height is 4 lines
(4 × 13px line-height) + 6px symmetric padding = 58, plus a 2px buffer. It must stay
in step with the 4-line clamp on `.solenoid-node__label-display`, or an editing
title and the static title disagree in height.
