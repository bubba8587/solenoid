---
aliases: ["Bleeding-edge platform features"]
tags: [spec, bleeding-edge]
---
<!-- [[B23]] edgePlatformFeatures, [[B25]] edgeReadyToPort -->

# Spec: Platform features on the bleeding-edge branch

Serves [[B23]] edgePlatformFeatures and [[B25]] edgeReadyToPort. It lists every web-platform feature the bleeding-edge branch puts to use: what each replaced, whether the look changed, which engines lack it, and whether it's ready to port to a work branch. It also lists the features not yet tried that are within reason, and the ones that would change the look and wait for the author. How features are picked and checked is [[branch#Working on the branch]]. Each landed feature is one commit named `Edge: <feature>: …`, ported with `port.mjs` ([[branch#Porting a finding]]). A ported row says so, and the next rebase drops the edge commit as already in the base.

## Engines

Solenoid ships into Chromium (Chrome and Edge on the web, WebView2 in the Windows desktop app, Electron in the Obsidian plugin), WebKit (Safari, and WebKitGTK in the Linux desktop app) and Gecko (Firefox). "Lacks it" names the engines that MDN's compatibility data or the feature's release notes say don't have it; "unverified" means no source checked says either way.

The oldest engine is the Linux desktop app's WebKitGTK, which comes from the user's system and trails Safari. Ubuntu's LTS releases take each WebKitGTK stable release as an update a few months after it ships, so the floor is the stable release that has reached them: on 2026-10-30, 2.52.3 in Ubuntu 24.04's updates (May 2026). A feature Safari shipped after that release counts as lacking in the Linux app until the floor moves.

**Ready to port** follows [[B25]] edgeReadyToPort: the finding's commits port as they stand. Every engine has the feature, or each one without it was run with the feature taken away ([[branch#Working on the branch]], step 6) and behaves as the work branches do today; and its port check passes on the current base ([[branch#Porting a finding]]). "Without it" records what the run showed. Every landed feature was checked in Chrome 153.

## In use

| Feature | Where | What it replaced | Look | Lacks it | Without it | Ready to port |
|---|---|---|---|---|---|---|
| `sibling-index()` | The Dashboard board's intro: table rows and cards rise 20 ms apart, capped at 180 ms (`DashboardOverlay.css`) | Nine `:nth-child` rules, one delay each | Same | None: Baseline since 18 August 2026 (Firefox 154) | The delay is an invalid declaration and drops, so the rows rise together with no stagger; the animation still plays | **Ported** to rust-port 2026-10-30 (`f2cec7150`) |
| `text-fit: shrink` | A phone's half-width Dashboard box: its number set at 52 px (text at 34 px) and shrunk to 86% of the box's width, never below 38% (47% for text); a counting number is padded to its final length with figure spaces, so it fits once and holds still (`DashboardOverlay.css`, `DashboardOverlay.tsx`) | A font size estimated from the character count (`--chars`, a glyph taken as 0.6 em), set by three components | Better: neighboring values now draw at one width, where commas and currency signs used to throw the estimate off | Gecko and WebKit (MDN: Chrome 150 only) | The number stays at 52 px and overflows a half-width box on a phone | **Not ready**: waits for Gecko and WebKit, or a fallback that sizes the number as the work branches do |
| `light-dark()` with `color-scheme` | Twenty color tokens in `App.css`; the root sets `color-scheme: dark` and the light theme `light`. JS that needs the text color reads `body`'s resolved `color`, since the token now holds the function. | Each of those tokens declared twice, once per theme | Same, pixel for pixel on the canvas and the Dashboard in both themes | None: Baseline since 2024 (Chrome 123, Firefox 120, Safari 17.5) | Not run: every engine has it, the WebKitGTK floor included (WebKitGTK 2.44, the release matching Safari 17.5). An engine without it would lose all twenty colors | **Ported** to rust-port 2026-10-30 (`d7c58ed13`) |
| `popover="auto"`, `popovertarget` and CSS anchor positioning | The Documents menu: a popover in the top layer, the caret as its invoker, anchored under its own title; each of the two mounted titles names its anchor from React's `useId` (`DocumentTitle.tsx`, `documentTitle.css`, `mobile.css`) | A portal to `<body>`, the trigger's measured rect divided by the chrome zoom, and a window `pointerdown` listener | Same on desktop and phone | None on the web: popover is Baseline, and anchor positioning since January 2026 (Firefox 147, Safari 26). The Linux app's WebKitGTK: unverified | Run with anchor positioning taken away: `anchor()` drops, and the menu landed in the window's top-left corner, half off-screen. Fallback in the commit: `@supports not (anchor-name: --a)` centers the menu in the window, checked the same way (anchor positioning is in Safari 26; whether the WebKitGTK floor builds it is unverified) | **Ported** to rust-port 2026-10-30 (`6a5cc4839`, then the fallback `714750ff0`, which the edge commit lacked) |
| `focusgroup` | Every composite widget: the segmented switches (Settings, the Tidy options, the phone menu sheet), the Navigator's Files and Outline switch, the Report's tabs, the overflow, table, cell-kind and Files menus, and the Pivot view's toolbar; React's types learn the attribute in `src/focusgroup.d.ts` | Nothing: each button was its own Tab stop, with no arrow keys | Same; one Tab stop per widget and arrow keys inside it | Gecko and WebKit (Chrome 150; not yet in the HTML standard) | The attribute is ignored: one Tab stop per button and no arrow keys, as the work branches are today | **Ported** to rust-port 2026-10-30 (`06e6d2c56`) |

## Toolchain and dependency features in use

What a bump's release notes, read from the version the branch had to the new one, offered the app ([[branch#Working on the branch]]). Answers don't change; each ports alone.

| Feature | Where | What it replaced | Look | Ready to port |
|---|---|---|---|---|
| Rust 2024 edition (1.85) and let chains (1.88) | Every crate; 87 nested `if`/`if let` blocks | Nested blocks; extern blocks without `unsafe`; a `gen` binding | None (engine only) | **Ready**: the work branches pin Rust 1.99.1, port-checked onto rust-port 2026-10-31 |
| `cfg_select!` (1.95), `LocalKey<Cell>::update` (1.99), `map_or_default` (1.98), `rust-version = 1.99` | `random()` and `local_time` in the core; the call-depth counter; 39 `map_or` calls | Twin `#[cfg]` functions; `with(\|d\| d.set(d.get() - 1))`; a default value spelled out | None (engine only) | **Ready**, port-checked onto rust-port 2026-10-31 |
| pele 1.13 series theme variables and label inks | `MermaidView.tsx`: the palette's eight series colors as Mermaid theme variables, and `--pele-fg-on-light/-dark` from the palette's text colors | One label ink per theme on every slice, and pele's own `#1f1f1f`/`#fff` | Better: each slice's label takes the ink that reads on it (white on blue, dark on gold, in both themes) | **Ready** with `Upgrades: pele@1.13.0`, port-checked onto rust-port 2026-10-31 |
| tauri-plugin-fs 2.7 `scopeDroppedPaths: false` | `src-tauri/tauri.conf.json` | The plugin's default of adding every path dropped on the window (directories recursively) to the webview's file scope, which Solenoid never reads | None | **Ready**, port-checked onto rust-port 2026-10-31 (rust-port already locks the crate at 2.7.1) |

Read with nothing to use, on 2026-10-31 (each span from the branch's old version to its new one): React 19.3.1 (a server-transport fix), Vite 8.3.5, Vitest 5.0.5, puppeteer-core 25.14 to 25.16, marked 18.1.2, KaTeX 0.19.1, DOMPurify 3.4.17, chrono-node 2.10.3 (Arabic and Indonesian; the app parses English), magic-string 1.0 to 1.4 (the plugin build's overwrite-and-map use is unchanged), three r187 (the motion clips use none of its renames), the Tauri API and CLI 2.12.4, the dialog and opener plugins, and windows-sys 0.61 (`DwmSetWindowAttribute` and `DWMWA_BORDER_COLOR` keep the signatures the shell calls). @lezer/common 1.5.4 and 1.5.5 publish no notes. @types/react 19.3 is unread.

## Next, within reason

- Popover and anchor positioning for the other hand-placed menus: the phone Tidy dropdown and the Tidy options (`useClickaway`), the Navigator's row menus, the value peek's placement after render, and the phone menu sheet's own `pointerdown` close.
- `light-dark()` through the component stylesheets: 36 `[data-theme="light"]` blocks still restate colors.
- Anchored container queries for any tooltip that flips sides.
- `field-sizing: content` wherever an input's width or a textarea's height is measured in script.

## Candidates that change the look

These wait for the author ([[B23]] edgePlatformFeatures).

| Feature | What it would change |
|---|---|
| `contrast-color()` | It would replace `contrastInk()` in `palette.ts`, but it picks black or white by WCAG AA contrast, where Solenoid uses Android's 3:1 rule and a dark grey (#1a1a1a) ink, so some accents' ink would flip. |
| `text-box-trim` and `text-box-edge` | Optically centered text in pills, buttons and the node header label; every pill's text would move a pixel or two. |
| `corner-shape: squircle` | Card and pill corners. |
| `border-shape` | Non-rectangular cards or connectors. |
| Gap decorations (`column-rule` on a grid) | Grid lines in the Table popup drawn by the grid instead of cell borders, worth trying where it can match the current lines exactly. |
| `background-clip: border-area` | Gradient borders, which the app doesn't use. |
| Element-scoped view transitions | A card growing into a composite's inner canvas or into its popup: new motion. |
| `interestfor` with `popover="hint"` | Styled tooltips in place of 234 native `title` tooltips. |
| rustfmt `style_edition = "2024"` | The 2024 formatting style for every crate (the crates keep `style_edition = "2021"` for now): about 600 lines move across 124 files, no behavior. |
| ELK DisCo (elkjs 0.12.1 restores it) | Tidy with a flipped card: `INCLUDE_CHILDREN` turns off ELK's packing of disconnected components, so loose cards and collapsed groups stack in one tall column; DisCo could pack them as an unflipped layout does. Changes those layouts. |
| pele 1.11 `monospace` option | Class members, ER attributes, TreeView files and sequence messages in the monospace font. |
| `appearance: base-select` | Styled dropdown lists for every `<select>` on the cards. |
| Scroll-driven and scroll-triggered animations | Nothing in the app scrolls into view with motion today. |
