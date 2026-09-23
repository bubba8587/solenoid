---
aliases: ["Palette and theme"]
tags: [spec, canvas]
---
<!-- [[C62]] paletteAllOrNone -->

# Spec: Palette and theme

Serves [[C62]] paletteAllOrNone. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Every color the app paints comes from one of two places. A **palette** is a named set of twelve accent colors plus, optionally, a neutral ramp for the workbench around the graph. The **theme** is the user's accent choice and light or dark mode, which `appTheme.ts` writes onto `<html>` as CSS custom properties. The palette half lives in `palette.ts`; the theme half in `appTheme.ts` and `themeVars.ts`. What each built-in palette is meant to look like, and the structure every neutral ramp keeps, is in `DESIGN.md` §2 Colors. `palette.test.ts` and `chrome.test.ts` pin the behavior.

## Slots: how a color is stored

A card, group, note or drawn cable never stores a hex. It stores a **slot id**, one of the twelve keys of `PALETTE`, and the color is looked up at render time. The id is never an index either, because the swatch order can change while the id stays put. Ids are opaque names: in a given palette the `green` slot need not be green.

The twelve slots and their Default hexes:

| Slot | Default | Socket color it drives |
|---|---|---|
| `gray` | `#8a8f98` | `--sock-any` |
| `amber` | `#d9742b` | none (the input node kind) |
| `blue` | `#3173e0` | none (the math node kind) |
| `teal` | `#4fc89a` | none (the convert node kind) |
| `purple` | `#c05dd1` | the logical sockets (the logic node kind) |
| `green` | `#00b862` | `--sock-lambda`, `--sock-chart` |
| `gold` | `#f5b914` | `--sock-number`, `--sock-list`, `--sock-table` |
| `lime` | `#c8e040` | the string sockets |
| `pink` | `#de7cb0` | the date sockets |
| `sky` | `#56b4e9` | the complex sockets |
| `vermilion` | `#e0473a` | the semantic error red, `--sol-error` |
| `violet` | `#7b64ed` | `--sock-frame`, `--sock-cube` |

`COLOR_PALETTE` is the swatch picker's order, and also the order of the categorical chart series: gold, green, amber, blue, lime, purple, gray, vermilion, violet, pink, sky, teal. Gray sits seventh so the first six series stay vivid.

### Resolving a slot

`resolveColor(slot)` is the one place a slot becomes a hex. It checks the two neutral shades first, then the effective palette, and anything else (an unknown or stray string) falls back to the palette's gray. It is total so that a bad stored value can never crash a render; it is not a compatibility path for old values.

### The gray swatch's neutral cycle

The gray swatch cycles through three values: `neutral-white` (`#f3f4f6`, a hair off pure white so it reads as a swatch), `gray` (the real slot) and `neutral-dark` (`#3a3d42`). The two extremes are fixed sentinel ids, so a card stores and saves them like any slot, but no palette changes them. `nextNeutral` steps gray to dark to white to gray, and any real color steps to gray. `NEUTRAL_CYCLE` lists them in the order the split disc draws them: upper left white, middle gray, lower right dark. `NEUTRAL_HEX` has a null prototype, so a stored slot such as `"constructor"` reads as undefined rather than a function.

## Socket colors

`SOCKET_VARS` maps each `--sock-*` variable to a slot and a kind (`scalar`, `array` or `matrix`). App.css defines no `--sock-*` values: `themeVars` writes every one on each apply, so a palette or mode change retints socket dots, cables and the legend. Shared slots are told apart by glyph: `--sock-table` (a numeric matrix) shares gold with the number sockets and is known by its grid glyph, the cube shares the frame's violet and is known by its hexagon, and the chart shares lambda's green.

Each socket color is derived in this order:

1. Resolve the slot through the effective palette.
2. Apply the light-mode accent drop (`themeAccent`). This comes first so the drop compounds exactly once, not again on top of the shade.
3. Apply the kind's shade. `socketArrayShade` multiplies HSV value by 0.85. `socketMatrixShade` shifts hue by −11°, multiplies saturation by 1.18 (capped at 1) and value by 0.92. The hue shift is what tells a 2-D socket from its scalar; the saturation and value steps only keep it in the same weight class.
4. Write the result as `--sock-X` and a ring as `--sock-X-ring`: `socketRingShade`, a fixed HSV value drop of 0.23 off that same fill, so every glyph's border reads at the same contrast whatever the fill's lightness.

All of these steps run in HSV (`DESIGN.md` §Tertiary). A canvas renderer (the minimap, the HTML-in-Canvas snapshot) cannot read a CSS variable, so `socketVarHex(expr, mode)` runs the same derivation without the DOM. It accepts a bare `--sock-*` name or a `var(--sock-*)` expression, passes a bare hex through unchanged, and returns gray for anything it does not recognize.

## Accent helpers

- `themeAccent(hex, mode)`: in light mode, drops HSV value by 0.045; in dark mode, returns the hex unchanged. The caller passes the mode because `palette.ts` cannot import the theme store (the import would be circular).
- `darkenAccent(hex)`: HSV value −0.07, for light-mode outside borders on cards, groups and popups.
- `hexToRgba(hex, alpha)`: falls back to `rgba(139,124,246,alpha)` for a bad hex.
- `contrastInk(hex)`: the text or icon color for a solid fill: `#1a1a1a` when the fill's luma (0.299 R + 0.587 G + 0.114 B, over 255) is above 0.62, else `#fff`, and `#fff` for a bad hex. Results are cached per hex, because a card asks for its ink on every render. Each palette change bakes the ink for every slot of the effective palette in its raw form and in both theme modes (`bakeInks`), since the light-mode drop can move a color across the threshold.

## The built-in palettes

`BUILTIN_PALETTES` holds seven palettes, and `PALETTE_NAMES` lists them in this order:

- **Default**: `PALETTE` itself.
- **Muted**: the Default hues at about 0.62 of their saturation, with lightness nudged toward the middle.
- **Colorblind-safe**: the Okabe-Ito set. The eight slots that drive sockets (gray, gold, lime, pink, sky, vermilion, violet, green) each take a different Okabe-Ito color, so the type system stays separable; gray is `#999999`, since Okabe-Ito has no gray. The four slots that only color node kinds reuse the matching one: amber takes number's orange, blue takes frame's blue, teal takes complex's sky, purple takes date's reddish purple.
- **Solarized**: Solarized's eight accents, plus base1 gray (`#93a1a1`) and three hues blended into its gaps (a leafy green, a light azure, a muted purple), with gold brightened off Solarized yellow. Every slot stays a distinct color.
- **Equinox**: every slot the same gray, `#8a8f98`, so type is told apart by socket shape alone. This neutralizes the error red too, by design.
- **Orchard**: lifted from the Pear design system, a warm cream ground under orchard hues. Pear ships no cool hue, so teal, sky, blue, violet and purple are blended into its gaps at Pear's own saturation and value band (saturation about 0.40 to 0.56, value about 0.62 to 0.71), the same technique Solarized uses.
- **Blueprint**: a cyanotype drafting table. The slots are chalky mid-value pencil colors that hold up on deep blue and on the light whiteprint; `blue` and `sky` stay clearly separated from the ground by value.

## The neutral chrome ramp

Besides its slots, a palette may author the **chrome ramp**: the neutral workbench around the graph, per theme mode. It is a separate map from the slots (`BUILTIN_CHROME`, keyed by palette name) and never a slot a card can point at. The thirteen keys (`ChromeKey`) and the App.css tokens they write (`CHROME_VARS`):

| Key | Token | Key | Token |
|---|---|---|---|
| `appBg` | `--app-bg` | `borderStrong` | `--border-strong` |
| `canvasBg` | `--canvas-bg` | `borderSubtle` | `--border-subtle` |
| `canvasDot` | `--canvas-dot` | `text` | `--text` |
| `surface` | `--surface` | `textBright` | `--text-bright` |
| `surfaceSunken` | `--surface-sunken` | `textDim` | `--text-dim` |
| `surfaceRaised` | `--surface-raised` | `textMuted` | `--text-muted` |
| `border` | `--border` | | |

A ramp is all or nothing ([[C62]] paletteAllOrNone). Default authors none (`NO_CHROME`), because it is App.css's own ramp; every other built-in authors all thirteen keys in both modes. The rest of the neutral chrome follows the ramp two ways: through App.css's own `var()` chains (`--btn-bg` from `--surface-sunken`, `--panel-border` from `--border`, `--panel-bg` and `--overlay-bg` from `--surface`), and through the derived tokens below.

`DEFAULT_CHROME` is a hand-kept copy of App.css's two `:root` ramps. It is never written to the DOM. It seeds the Custom palette's ramp and the custom palette editor's chrome wells, so an author edits away from what they see. No test can read the stylesheet, so keep it in step with App.css by hand.

### App.css: the fallback tokens and the ramp's roles

App.css holds the fallback values of the theme tokens. `appThemeStore` overwrites the accent at runtime, and `appTheme.ts` writes every `--sock-*` from the active palette, so beside the ramp App.css keeps only the selection-ring and selected-cable tokens and the chrome literals.

- **Ramp roles.** `--surface` is raised chrome (the node body, menus, popovers), `--surface-sunken` is a recessed field (inputs, value and result boxes), and `--surface-raised` is a hover or selected fill inside chrome.
- **Chrome fills are opaque.** Bars, panels and floating overlays are the surface, never a window onto the graph behind them.
- **Floating overlay chrome** (socket legend, minimap, pins, alerts) uses the opaque surface with a stronger always-on border (`--overlay-border`, 2 px through `--overlay-border-width`) and a layered shadow, so it reads above a busy graph. The border defines it more than the shadow does, which stays lighter and tighter, because a wide soft shadow spreads heavier on a larger panel such as the socket legend. The border width is theme-agnostic, and the light ramp only softens the shadow tint.
- **The dock edge** (`--dock-shadow`) is a minimal leftward lift on the right docks (Inspector, Report), because cards scroll off under that edge and a border alone reads flat. It stays under the bars.
- **`--text-muted`** is set to clear WCAG AA 4.5:1 on the card and sunken surfaces (`#80868e` dark, `#6a717b` light) while staying a step below `--text-dim`.
- **The light theme.** The card body is a touch off-white, fields are the brightest layer (white) so number boxes and dropdowns read as familiar input fields, and the canvas is a shade grayer so cards lift off it. Its header tint is stronger (`--header-tint` 52% against 22% in dark mode), since pale on white needs more.
- **The selection ring** is the accent mixed toward a contrast pole (`color-mix(accent var(--mix-ring), var(--ring-into))`): 70% accent toward white in dark mode. Light mode flips the pole to black and raises the accent share to 80%, because a mix near 70% toward black reads as a harsh near-black frame over a pale card.
- **`--cable-selected`** is white on the dark canvas and a dark neutral in light mode. The wordmark is accent-tinted in dark mode and a dark neutral in light mode, so neither washes out on near-white.

### Mapping a lifted system onto the ramp

- **Orchard** maps Pear's neutrals by role, not position. Pear sinks its fields; Solenoid's light theme makes the field the brightest layer (`DESIGN.md` §2). So in light mode Pear white becomes `surfaceSunken`, Pear surface becomes `surface`, and Pear surface-sunken becomes `surfaceRaised`. Where Pear has no token (dark `surfaceRaised`, `borderSubtle` and `textBright`; light `borderStrong`), the value is one step off the nearest Pear token, inside its band.
- **Solarized** uses its base03 to base3 ladder in the canonical roles: background, background highlight, then the content tones in Solarized's own order. Its border tiers are blends in the gap between base02 and base01. Its body text sits near 3:1 contrast on purpose; do not raise it ([[C62]] limits the 4.5:1 requirement to Default and Colorblind-safe).
- **Muted** lifts off near-black onto a soft, barely warm charcoal and pulls the light ramp's contrast in a step.
- **Colorblind-safe** is fully achromatic and a step crisper than Default.
- **Equinox** is Default's contrast with Default's blue cast removed, fully achromatic.
- **Blueprint** is prussian blue in dark mode and cool whiteprint paper in light mode, cool end to end.

### Derived chrome tokens

`chromeCssVars(ramp, mode)` returns the map from token to value that a ramp produces: each of the thirteen keys that holds a valid `#rrggbb` hex, plus the tokens App.css writes as literals, rebuilt from the ramp. When `surface` or `text` is missing it returns only the authored keys and derives nothing. `mixHex(a, b, t)` blends per sRGB channel, with `t = 0` giving `a`.

| Token (`DERIVED_CHROME_VARS`) | Value | Needs |
|---|---|---|
| `--overlay-border` | `mixHex(borderStrong, text, 0.08)`: one step past the strong border toward the ink, since overlays are defined by their edge rather than a big shadow | `borderStrong` |
| `--btn-hover` | `mixHex(surfaceSunken, text, 0.08)`, the same in both modes because "toward the ink" already flips with the theme | `surfaceSunken` |
| `--gauge-track` | `mixHex(borderStrong, textMuted, 0.35)`: stronger than a border so the gauge's unfilled arc clears the card, short of a muted label | both |
| `--cable-selected` | dark: `textBright`, else `text`; light: `text` | |
| `--wordmark-color` | light only: `text`. Dark mode leaves App.css's accent-tinted wordmark alone | |
| `--shadow-card` | light only: `0 1px 2px` in `text` at alpha 0.1 | |
| `--shadow-pop` | light only: `0 4px 14px` in `text` at alpha 0.07 | |
| `--overlay-shadow` | light only: `0 4px 14px` at 0.1 plus `0 1px 4px` at 0.06, both in `text` | |

Light shadows take the ink's hue, so a warm ramp casts a warm shadow; dark mode keeps App.css's black. The mix steps were calibrated by running the Default ramp through them and matching App.css's hand-tuned literals. Retune a step by redoing that comparison, never by nudging it until one palette looks right.

### Accent-adaptive ramps

`CHROME_HOME` names the slot a tinted ramp was authored against: Orchard `green`, Blueprint `blue`. Every other palette, Custom included, holds still. `adaptChrome(ramp, homeHex, accentHex)` retints such a ramp for the live accent:

1. If either hex is invalid, return the ramp unchanged.
2. If the accent's OKLCh chroma is below 0.05 (`ADAPT_MIN_CHROMA`), return the ramp unchanged: the accent has no hue worth following. The floor sits in the measured gap between the grayest guard case (Orchard's gray at chroma about 0.038) and the least chromatic real accent (Orchard's teal at about 0.072).
3. Take the hue difference from home to accent, 0 to 360°. Within 0.5° of zero, return the ramp unchanged.
4. Otherwise rotate every valid key's OKLCh hue by that difference (`rotateHueKeepLum`), holding its chroma, then bisect OK lightness (22 steps) until its WCAG relative luminance matches the authored value. Luminance rises steadily with OK lightness at fixed chroma and hue, so the bisection lands. Out-of-gamut results come back into gamut by bisecting chroma toward gray (16 steps) at fixed lightness and hue, so chroma can only drop, never grow.

Returning the ramp object itself, rather than a copy, means the authored hexes pass through byte-identical at home.

## Which palette is in effect

Three layers decide the palette:

- **The app base**, the user's switcher choice: a built-in name or `"Custom"`. It persists in `localStorage` under `solenoid.palette`.
- **The document pin**: a document may declare `palette: { base?, overrides? }` ([[save-format]]). The base must be a built-in name; `overrides` maps slot ids to hexes, and unknown slots or non-string values are dropped. The pin wins over the app base for that document and never changes it.
- **The report palette**: a document may also declare `reportPalette` in the same shape. It colors only report and export surfaces, never the canvas, so a brand override for an export does not retint the live graph ([[reports-and-notes]]).

From these, `recompute` builds:

- the effective slot map: the document base's slots if pinned, else the app base's, with the document overrides laid on top;
- the effective chrome: the document base's ramp if pinned, else the app base's. A pin picks the chrome as well, so a pinned document looks the same wherever it opens; document overrides touch slots only.

`recomputeReport` builds the report map from the report base, falling back to the document base and then the app base, with the report overrides on top. `reportPaletteStore.resolve` resolves a slot through that map, with the same neutral-shade and gray fallbacks as `resolveColor`.

`paletteStore` and `reportPaletteStore` have separate notifiers, so a report-only change never wakes canvas subscribers and the reverse. A change to the app base or the document pin updates and notifies both, since the report map falls back through them. `setDocPalette` and `setReportPalette` take `null` to clear; `docPalette()` and `reportPalette()` return `undefined` when the document declares nothing, which keeps the field out of the save.

`paletteStore.chromeHomeHex()` returns the home slot's hex from the built-in palette itself, never through document overrides, because the ramp was tuned against the palette's authored colors. It is null for Custom and for palettes with no home.

### The Custom palette

Custom is the user's own palette, and only the app base may be Custom. Its slot map (`solenoid.palette.custom`) starts as `PALETTE`. Its ramp (`solenoid.palette.custom.chrome`) is always complete, seeded from `DEFAULT_CHROME`, so choosing Custom always pins a ramp, one that starts identical to App.css.

- `setCustomSlot` edits one slot.
- `setCustomMap(map, chrome?)` commits a whole draft at once, laying valid hexes over the current map and ramp. The editor saves through it so the app retints once, not on every drag tick.
- `loadCustomTemplate(name)` copies a built-in's slots, and its ramp laid over `DEFAULT_CHROME`. A template that authors no ramp therefore resets the custom ramp to neutral rather than leaving the old one.

Each edit persists, and recomputes and notifies both stores only when Custom is actually on screen: the app base is Custom and no document pin overrides it. `paletteEditorPanel` is the editor's open flag. The Settings dialog's palette picker lists the built-ins plus Custom; picking one also rebuilds group membership, because the group member-dot store caches resolved hexes.

`initPalette()` runs once at startup. It reads the custom map and ramp (ignoring anything malformed, and keeping only valid hexes over the defaults), then the app base, recomputes, and notifies so subscribers pick up a persisted palette. Every `localStorage` read and write is wrapped in try/catch, so a private window still works.

## The theme

`appThemeStore` holds the accent, a slot id defaulting to `gold` (the brand coil's `#f5b914`), and the mode, `dark` by default. Both persist as one JSON object under `solenoid.theme`. Setters do nothing when the value would not change. `initAppTheme()` runs `initPalette()` first, so the accent resolves through the persisted palette, then reads the saved theme and applies it.

`themeVars(accentSlot, mode)` computes every custom property the theme writes, with `null` meaning "remove this property". It is pure and has its own module so a host with no `<html>` of its own (the Obsidian plugin, [[obsidian-plugin]]) can scope the same values without the store.

- `--accent` is the resolved accent hex; `--accent-soft` and `--accent-mid` are it at alpha 0.14 and 0.4; `--accent-ink` is its `contrastInk`.
- Every `--sock-*` and `--sock-*-ring`, as in Socket colors above.
- `--sol-error` is the `vermilion` slot through `themeAccent`, so a custom palette retints errors too. `errorChip.css` carries a static fallback for the first paint.
- Every chrome token, core and derived. For an adaptive palette the ramp first goes through `adaptChrome`, using the accent resolved through the live palette, so the tint tracks what the accent dot shows. Ramp hexes are not passed through `themeAccent`: that drop tunes an accent against the chrome, and the chrome is what it is tuned against. Any chrome token the ramp does not produce is `null`, so it is removed. An inline property beats App.css, and one left over from the previous palette would strand, for example, a cream workbench under Default.

`apply()` writes those properties onto `document.documentElement`, sets `data-theme` and `color-scheme` to the mode, sets the `theme-color` meta tag (created if missing) to the accent hex so mobile browsers tint their chrome, and calls `syncNativeAccent`. It does nothing when there is no `document`. It runs on every accent or mode change and on every palette notification; the palette notification also fires the theme store's own notifier, so a visual component subscribes to the theme store alone rather than to both.

`syncNativeAccent(hex)` sets the Windows 11 window border to the accent through the Tauri command `set_window_border` (`{ r, g, b }`). It does nothing on web, and the Rust command does nothing off Windows 11; a failed call is ignored.

## Palette-derived color for charts and chips

- **The height ramp** (`heightRampColor(t)`, for Surface, Contour and Vector Field): five stops from the slots violet, blue, teal, green and gold, each forced to HSL lightness 0.26, 0.38, 0.5, 0.62 and 0.78, so the ramp reads as height under any palette. `t` is clamped to 0 to 1 and interpolated linearly between stops. The stops are cached per palette version, since a draw calls this thousands of times.
- **Category chips** (`categoryColorIndex(values)` in `categoryColor.ts`): each distinct string gets an index by first appearance, skipping null and undefined. It is pure and order-deterministic, so a value keeps its index wherever it sits and a chip keeps its color when rows are reordered for display. The index maps to the chart series colors (`useSeriesColors`, modulo their count) at render time.

## Color math for canvas renderers

A `<canvas>` cannot evaluate `color-mix()` or `var(--…)`, so `cssColor.ts` does that math for the canvas renderers. It stays free of the DOM; resolving a `var()` needs `getComputedStyle` and is the caller's job.

- `parseColor` reads `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` (alpha as a fraction or a percentage), and `color(srgb r g b / a)`. Chromium serializes any `color-mix()` result in that last form, so without it header tints and group-tinted borders fall back to a flat body fill. Its channels are rounded after scaling to 0 to 255, because the serialized floats are truncated and a bare multiply lands one step low. Anything else returns null.
- `mixSrgb(a, b, t)` matches `color-mix(in srgb, …)`: a straight blend of the gamma-encoded channels, not linear light, with `t` the weight of `b`.
- `flowTint(base, p)` is `color-mix(in srgb, base p%, #fff)`, the cable flow tint; an unparseable base reads as light gray.
