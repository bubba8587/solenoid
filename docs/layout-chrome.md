# Layout & chrome geometry (desktop + mobile)

Notes for future-me. The recurring bug class here is **a floating overlay that overlaps a
bar** — the offsets are hand-keyed magic numbers scattered across many CSS files, and they
all trace back to the same few bar heights. When you move or resize a bar, every dependent
offset has to move in lockstep or something ends up covering something. This file is the map:
what sits where, what each offset is measured from, and what to check before you add or move a
piece.

There is **no shared CSS var for the chrome envelope offsets/heights** — the only layout vars
that exist are the report dock's (`--report-dock-w/-top/-bottom`) and the shared
`--overlay-border-width`; the `22`/`44`/`19`/`80`/`12`/`16` px values are all literals with
explanatory comments. So the numbers below are duplicated by hand. Treat the tables as the source of truth for "what number
means what," and grep for the number before changing a bar height. (A real fix — hoist the
envelope into `--chrome-top` / `--chrome-bottom` vars on `:root` and `html.is-mobile` — is a
cross-cutting refactor; do it author-present, not as a drive-by.)

---

## Desktop stack (mouse / desktop UA, no `html.is-mobile`)

The header is one absolutely-positioned full-width column pinned top; the footer is pinned
bottom; everything else floats over the canvas.

| Element | Class | Anchor | z-index | File |
| --- | --- | --- | --- | --- |
| Header wrapper | `.solenoid-header` | `top:0`, full width, flex column | 6 | `Header.css:1` |
| — Menu bar (row 1) | `.solenoid-menubar` | height **22px** | 2 | `MenuBar.css:5,8` |
| — App/top toolbar (row 2) | `.solenoid-topbar` / `.solenoid-apptools` | height **44px** | 1 / 6 | `TopBar.css:9`, `AppToolbar.css:43` |
| — ↳ tablet touch actions (in row 2) | `.solenoid-topbar__group--tablet` | **inside** the 44px row — adds no height | — | `TopBar.css` (gated `html.is-tablet`) |
| Status bar (footer) | `.solenoid-statusbar` | `bottom:0`, height **19px**, full width | 6 | `StatusBar.css:3,6,10` |
| Nav/zoom pill | `.solenoid-nav` | `top:80px; right:12px` (upper-right) | 5 | `NavMenu.css:3,20` |
| Navigator (outline) | `.solenoid-outline` | `left:12px` (upper-left); open-pill also `top:80px` | 5 | `OutlinePanel.css:5` |
| Align/distribute pill | `.solenoid-selbar` | `top:76px; left:50%` (top-center), shown only when ≥2 nodes selected | 7 | `selectionActions.css:9` |
| Socket legend | `.solenoid-legend` | `bottom:148px; right:16px` (stacks above minimap) | 100 | `SocketLegend.css:5,6` |
| Minimap | `.solenoid-minimap` | `bottom:30px; right:16px`, ~105px tall | 100 | `Minimap.css:5,8` |
| HUD stack (alerts/pins/problems/comments) | `.solenoid-hud-stack` | `top:124px; right:12px` | 110 | `hudStack.css` |
| Cable inspector | `.solenoid-cable-inspector` | bottom-left | 110 | `cableInspector.css:10` |
| Command palette | `.solenoid-cmdk` | bottom-docked (`left:50%; bottom:40px`), full-screen scrim behind | 300 modal · **150 persistent** (the always-on bar yields to the 200 modal band: Settings/help/shortcuts) | `CommandPalette.css:4,12` |
| Docked report panel | `.report-panel--docked` | `top:66px; right:0; bottom:19px; width:440px` (via `--report-dock-*`) | 90 | `ReportOverlay.css:321` |

> **Tablet (`html.is-tablet` = coarse pointer, NOT mobile — `IS_TABLET` in `coarse.ts`):** a
> tablet runs this DESKTOP stack, so it gets no bottom action bar. The top bar grows the
> touch actions (palette · undo/redo · select · group · delete — `TabletActions.tsx`) as
> ordinary pill groups INSIDE the existing 44px row. **The envelope below is unchanged, and
> must stay so:** all four offsets in it are hand-keyed against 66px, so a taller bar would
> push the bar's bottom edge under every one of them at once. Reach comes from a
> pseudo-element tap target, not from padding.

**The header envelope is 66px** (22 + 44), plus a 2px accent underline ≈ **68px** to the
canvas. That 66 is what `--report-dock-top` encodes and what the nav pill's `top:80px`
(66 + border + gap) and the selbar's `top:76px` both clear. The HUD's `top:124px` = the nav
pill's `80 + 34 (pill height) + 10 (gap)`.

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
| Row A — accent menu bar | `.solenoid-menubar` | `padding-top: safe-area`, ~30px content, z-index **8** | Doc name + caret only; carries the notch inset (`mobile.css:126`) |
| Row B — neutral tools bar | `.solenoid-topbar` | **52px** | menu · navigator · layout tools … accent · reference · settings (`mobile.css:41`) |
| Bottom action bar | `.solenoid-mobile-bar` | `bottom:0`, full width, ~57px + `safe-area-inset-bottom`, z-index 100 | Undo · Redo · ➕FAB · Select · Delete; `display:flex` only on mobile (`MobileControls.css`, shown at `mobile.css:23`) |

**Mobile top-chrome bottom edge = `safe-area-inset-top + 82px`** (30 Row A + 52 Row B). This
is THE number every top-anchored mobile overlay clears. It's written literally in several
places — keep them in sync:

| Overlay | Mobile `top` | File |
| --- | --- | --- |
| Menu hamburger sheet | `82px + safe-area` (right at the edge) | `mobile.css:157` |
| Nav pill | `92px + safe-area` (edge + 10 gap) | `mobile.css:229` |
| Navigator panel | `88px + safe-area` (and `bottom: 84px + safe-area-bottom`) | `mobile.css:261,264` |
| **Align pill** (`.solenoid-selbar`) | `92px + safe-area` — level with the nav pill | `selectionActions.css:66` |
| Command palette (top-anchored on mobile) | `92px + safe-area` — level with the nav pill | `CommandPalette.css:96` |
| Web-demo notice | `48px + safe-area` | `mobile.css:217` |

The minimap is **`display:none` on mobile** (`mobile.css:35`) — the corner is given to the
socket legend. Bottom-anchored floating chrome (docked conduit toolbar, cable inspector) is
lifted ~84–96px + `safe-area-bottom` to clear the bottom action bar and its raised FAB.

> **The bug this file was started for:** the align pill's mobile override was `56px`, sized for
> a single-row top bar. The real two-row chrome ends at `82px`, so `56` landed *inside* Row B
> and the pill overlapped the toolbar. Fixed to `92px` (level with the nav pill). If you retune
> the two rows, this number and the four above move together.

---

## Push vs. overlay — the exact interactions

Answers to the questions that keep biting:

- **Navigator open** → `body.solenoid-nav-open` (toggled in `OutlinePanel.tsx:281`). The
  navigator **overlays** the canvas; it does **not** push the canvas or the right-side chrome.
  Its only job is to shove the two *left-anchored* floating toolbars right so they clear the
  panel (12px + 248px): the docked conduit toolbar (`conduit.css:129`) and the cable inspector
  (`cableInspector.css:29`). Desktop only (`html:not(.is-mobile)`). Nav pill, HUD, legend,
  minimap (all right/bottom-anchored) do not move.

- **Minimap hidden or moved to top** → the `minimapPosition` setting (`"bottom"|"top"|"hide"`,
  `settingsStore.ts`) stamps `html.minimap-top` / `html.minimap-hidden`. The **only** thing that
  reflows is the socket legend: it drops from `bottom:148px` (stacked above the minimap) to
  `bottom:30px` (into the freed corner) — `SocketLegend.css:21`. Nothing else keys off the
  minimap. On mobile the minimap is always hidden, so the legend already sits low.

- **Report docked** (desktop) → `html.sol-report-docked` (`reportStore.ts:22`). This is a real
  **push**: it defines `--report-dock-w:440px`, `--report-dock-top:66px`, `--report-dock-bottom:19px`
  and then (`ReportOverlay.css:361`):
  - shrinks `.solenoid-canvas-wrapper` width by `--report-dock-w` (carrying minimap/legend/
    add-menu, which live inside it);
  - shifts `.solenoid-nav` and `.solenoid-hud-stack` `right` by `12px + --report-dock-w`.
  The header, status bar, and left navigator are full-width/left-anchored and untouched. This is
  the **one** place with named vars — the `66`/`19` in them are the same header/footer heights as
  above, so if those bars change, update the vars too.

- **Presenting** → `html.solenoid-presenting` (`PresentationOverlay.tsx:40`) hides basically all
  chrome: header, nav pill, status bar, navigator + open-pill, legend, minimap, mobile bar, HUD
  (`PresentationOverlay.css:4`). The canvas is the slide.

- **Drilled into a composite** → `html.sol-drilled-in` (`CompositeEditorOverlay.tsx:762`). The app
  frame stays; it hides the *main* minimap (the drill-in host renders its own) and hides the
  navigator + open-pill (`compositeEditor.css:205,210`). The drill-in adds a top-left breadcrumb
  strip (`.solenoid-composite-editor__strip`, desktop `top:74px`, mobile `88px + safe-area`) with
  a run-controls panel tucked under it (`top:120px`). Its backdrop is z-index 4 (above canvas,
  below chrome), so the app frame is what you keep.

---

## Z-index ladder (chrome only; nodes are 0, cables/overlay planes negative)

```
1    .solenoid-topbar (local, inside header)
2    .solenoid-menubar (local; 8 on mobile), htmlCanvasLayer
4    composite drill-in backdrop
5    nav pill / navigator / webdemo banner
6    header / statusbar / apptools palette
7    align pill / isolate endpoints
20   menubar dropdown (local to header)
60   conduit docked toolbar / node-budget modal
90   docked report panel
100  minimap / socket legend / mobile bottom bar
110  HUD stack / cable inspector
200  add menu (201 submenu) / settings / shortcuts / doctitle menu
300  command palette scrim
9999 socket context menu
```

MenuBar (z2) and TopBar (z1) are *local* values inside `.solenoid-header` (itself z6 at app
level); TopBar's `backdrop-filter` makes it a self-contained stacking context. The canvas gets
its own context via `isolation:isolate` (`canvas.css`), which is why the minimap needs z100 to
paint over node cards.

Rule of thumb: **floating canvas pills 5–7**, **corner panels 100–110**, **modals/menus 200+**,
**transient context menus top**. A new overlay picks the band by what it must sit above. If you
need it above the HUD but below modals, you're in the 110–199 gap.

---

## Before you add or move any chrome — checklist

1. **Which envelope does it clear?** Top-anchored: desktop `66px` header / mobile `safe-area + 82px`.
   Bottom-anchored: desktop `19px` status bar / mobile `~84px + safe-area-bottom` action bar.
   Reuse the sibling overlay's number, don't invent one.
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
