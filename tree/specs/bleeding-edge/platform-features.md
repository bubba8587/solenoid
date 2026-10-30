---
aliases: ["Bleeding-edge platform features"]
tags: [spec, bleeding-edge]
---
<!-- [[B23]] edgePlatformFeatures, [[B25]] edgeReadyToPort -->

# Spec: Platform features on the bleeding-edge branch

Serves [[B23]] edgePlatformFeatures and [[B25]] edgeReadyToPort. It lists every web-platform feature the bleeding-edge branch puts to use: what each replaced, whether the look changed, which engines lack it, and whether it's ready to port to a work branch. It also lists the features not yet tried that are within reason, and the ones that would change the look and wait for the author. How features are picked and checked is [[branch#Working on the branch]]. Each landed feature is one commit named `Edge: <feature>: …`, ported by cherry-picking it.

Solenoid's engines: Chromium (Chrome and Edge on the web, WebView2 in the Windows desktop app, Electron in the Obsidian plugin), WebKit (Safari, and WebKitGTK in the Linux desktop app) and Gecko (Firefox). "Lacks it" names the engines the feature's release notes or MDN's compatibility data say don't have it; "unverified" means no source checked says either way. Every landed feature was checked in Chrome 153.

**Ready to port** follows [[B25]] edgeReadyToPort: ready when every engine Solenoid ships into supports the feature, or when an engine without it behaves exactly as the work branches do today; otherwise not ready, with what it waits for. Baseline (the web-features project's mark that Chrome, Edge, Firefox and Safari all ship a feature) stands in for every engine, with one caveat that applies to every row: the Linux desktop app runs on the system's WebKitGTK, which can trail Safari, so a Linux machine on an old WebKitGTK may lack a feature Safari has.

## In use

| Feature | Where | What it replaced | Look | Lacks it | Ready to port |
|---|---|---|---|---|---|
| `sibling-index()` | The Dashboard board's intro: table rows and cards rise 20 ms apart, capped at 180 ms (`DashboardOverlay.css`) | Nine `:nth-child` rules, one delay each | Same | None: Baseline since 18 August 2026 (Firefox 154) | **Ready** |
| `text-fit: shrink` | A phone's half-width Dashboard box: its number set at 52 px (text at 34 px) and shrunk to 86% of the box's width, never below 38% (47% for text); a counting number is padded to its final length with figure spaces, so it fits once and holds still (`DashboardOverlay.css`, `DashboardOverlay.tsx`) | A font size estimated from the character count (`--chars`, a glyph taken as 0.6 em), set by three components | Better: neighboring values now draw at one width, where commas and currency signs used to throw the estimate off | Gecko and WebKit (MDN: Chrome 150 only) | **Not ready**: without it the number stays at 52 px and overflows the box; waits for Gecko and WebKit |
| `light-dark()` with `color-scheme` | Twenty color tokens in `App.css`; the root sets `color-scheme: dark` and the light theme `light`. JS that needs the text color reads `body`'s resolved `color`, since the token now holds the function. | Each of those tokens declared twice, once per theme | Same, pixel for pixel on the canvas and the Dashboard in both themes | None: Baseline since 2024 (Chrome 123, Firefox 120, Safari 17.5) | **Ready** |
| `popover="auto"`, `popovertarget` and CSS anchor positioning | The Documents menu: a popover in the top layer, the caret as its invoker, anchored under its own title; each of the two mounted titles names its anchor from React's `useId` (`DocumentTitle.tsx`, `documentTitle.css`, `mobile.css`) | A portal to `<body>`, the trigger's measured rect divided by the chrome zoom, and a window `pointerdown` listener | Same on desktop and phone | None: popover is Baseline, and anchor positioning since January 2026 (Firefox 147, Safari 26). Checked under the chrome zoom of a sideways phone in fullscreen: the menu sits under its title, centered | **Ready** |
| `focusgroup` | Every composite widget: the segmented switches (Settings, the Tidy options, the phone menu sheet), the Navigator's Files and Outline switch, the Report's tabs, the overflow, table, cell-kind and Files menus, and the Pivot view's toolbar; React's types learn the attribute in `src/focusgroup.d.ts` | Nothing: each button was its own Tab stop, with no arrow keys | Same; one Tab stop per widget and arrow keys inside it | Gecko and WebKit (Chrome 150; not yet in the HTML standard) | **Ready**: an engine without it ignores the attribute and behaves exactly as today |

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
| `appearance: base-select` | Styled dropdown lists for every `<select>` on the cards. |
| Scroll-driven and scroll-triggered animations | Nothing in the app scrolls into view with motion today. |
