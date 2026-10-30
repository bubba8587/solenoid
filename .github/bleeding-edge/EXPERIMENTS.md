# Experiments ledger

Every web-platform feature tried on this branch, per `.github/bleeding-edge/GUIDELINES.md`. "Lacks it" lists the engines Solenoid ships into that the feature's release notes or MDN's compatibility data say don't have it; "unverified" means no source checked says either way. Everything here was checked in Chrome 153 (the container's Chrome for Testing). Port a row by cherry-picking its commit.

Solenoid's engines: Chromium (Chrome and Edge on the web, WebView2 in the Windows desktop app, Electron in the Obsidian plugin), WebKit (Safari, and WebKitGTK in the Linux desktop app) and Gecko (Firefox).

## Landed

| Feature | Commit | Replaced | Look | Lacks it |
|---|---|---|---|---|
| `sibling-index()` | Edge: sibling-index() | The Dashboard cascade's nine `:nth-child` delay rules | Same | Gecko; WebKit unverified |
| `text-fit: shrink` | Edge: text-fit | A phone half box's font size estimated from the character count (`--chars`, a glyph as 0.6 em) | Better: neighbors now draw at one width, where commas and currency signs used to throw the estimate off | Gecko and WebKit (MDN: Chrome 150 only) |
| `light-dark()` with `color-scheme` | Edge: light-dark() | Twenty color tokens declared twice, once per theme | Same, pixel for pixel on the canvas and the Dashboard in both themes | None for the function (Chrome 123, Firefox 120, Safari 17.5); WebKitGTK depends on the system's version |
| Popover (`popover=auto`, `popovertarget`) and CSS anchor positioning | Edge: popover and anchor positioning | The Documents menu's portal to `<body>`, its measured rect divided by the chrome zoom, and its window `pointerdown` listener | Same on desktop and phone | Popover: none. Anchor positioning: Gecko and WebKitGTK unverified; landscape phones in fullscreen (chrome zoom) unverified |
| `focusgroup` | Edge: focusgroup | Nothing: about a dozen menus, tab lists, radio groups and a toolbar had a Tab stop per button and no arrow keys | Same; keyboard better | Gecko and WebKit (Chrome 150; not yet in the HTML standard) |

## Fixes for what the dependency bump broke

| Breakage | Commit |
|---|---|
| js-sys 0.3.107 made `Object` generic, so `Object::keys` over `unchecked_ref()` no longer infers; wasm-bindgen 0.2.130 writes its glue differently, so the trap-reset patch in `build-wasm.mjs` found none of its anchors | Fix: wasm-bindgen 0.2.130 and js-sys 0.3.107 |

## Next, within reason

- Popover and anchor positioning for the other hand-placed menus: the phone Tidy dropdown and the Tidy options (`useClickaway`), the Navigator's row menus, the value peek's placement after render, and the ⋮ sheet's own `pointerdown` close.
- `light-dark()` through the component stylesheets: 36 `[data-theme="light"]` blocks still restate colors.
- Anchored container queries for any tooltip that flips sides.
- `field-sizing: content` wherever an input's width or a textarea's height is measured in script.

## Candidates out of reason (they change the look; the author's call)

| Feature | What it would change |
|---|---|
| `contrast-color()` | Would replace `contrastInk()` in `palette.ts`, but it picks black or white by WCAG AA contrast, where Solenoid uses Android's 3:1 rule and a dark grey (#1a1a1a) ink, so some accents' ink would flip. |
| `text-box-trim` / `text-box-edge` | Optically centered text in pills, buttons and the node header label; every pill's text would move a pixel or two. |
| `corner-shape: squircle` | Card and pill corners. |
| `border-shape` | Non-rectangular cards or connectors. |
| Gap decorations (`column-rule` on grid) | Grid lines in the Table popup drawn by the grid instead of cell borders; worth trying where it can match the current lines exactly. |
| `background-clip: border-area` | Gradient borders, which the app doesn't use. |
| Element-scoped view transitions | A card growing into a composite's inner canvas or into its popup: new motion. |
| `interestfor` with `popover=hint` | Styled tooltips in place of 234 native `title` tooltips. |
| `appearance: base-select` | Styled dropdown lists for every `<select>` on the cards. |
| Scroll-driven and scroll-triggered animations | Nothing in the app scrolls into view with motion today. |
