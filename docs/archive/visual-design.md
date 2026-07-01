# Solenoid — Visual Design & Theming

Living document for color, type, surface, and spacing decisions.
Update as decisions land. Implementation detail lives in
`dev-notes.md` → "Theme system (accent + light/dark)".

---

## Theme system (shipped)

- **Accent**: user-pickable from a swatch palette (`appTheme.ts` +
  `palette.ts` `COLOR_PALETTE`), applied as `--accent` /
  `--accent-soft` / `--accent-mid` / `--accent-ink` CSS vars on
  `<html>`. Picker lives in the AppToolbar (top-right).
- **Light/dark**: `data-theme="light|dark"` on `<html>`; both persisted
  to localStorage. `themeAccent()` nudges accents darker/more saturated
  in light mode so dark-tuned colors don't glow on white.
- **Selection** uses `--select-ring` / `--select-glow` — accent in dark
  mode, deliberately **neutral gray** in light mode (palette-colored
  glow looked wrong on white). The old sky-blue placeholder is gone.

## Surfaces — the token layer

All node + chrome CSS reads semantic tokens defined in `App.css`
(dark defaults on `:root`, light overrides on
`:root[data-theme="light"]`). Never hardcode a surface gray; use:

- `--surface` (raised chrome: cards, menus), `--surface-sunken`
  (inputs, value boxes), `--surface-raised` (hover/selected)
- `--border` / `--border-strong` / `--border-subtle`
- `--text` / `--text-bright` / `--text-dim` / `--text-muted`
- `--shadow-card` / `--shadow-pop`
- App-chrome aliases: `--app-bg`, `--canvas-bg` / `--canvas-dot`,
  `--panel-bg` / `--panel-border`, `--btn-*`

Light mode inverts the card/field relationship: cards soft off-white,
input fields **white**, canvas a shade grayer — fields read as familiar
white inputs, not gray recesses.

Deliberately hardcoded (semantic, theme-agnostic): Function Reference
category badges, parity oranges, the remove-red, the Slicer selection
blue, and the Conduit metallic grays (themed separately via
`--conduit-*`).

## Socket type palette

Colorblind-safe, anchored on Okabe-Ito. The single source of truth is
`SOCKET_COLORS` in `src/graph/sockets.ts` (values are `--sock-*` CSS
vars so light mode can lighten the dark array variants); the current
type table with colors and shapes is in `dev-notes.md` → "Socket types
(current)". Shape language: scalars are circles, list types squares,
scalar-or-list combos bicolor split squares, table/frame 2×2-grid
squares.

Socket colors are **not** theme-overridable — the type system is
universal. Keep new accent choices distinct from the socket palette so
"app accent" never reads as "socket type".

## Reserved styles for non-normal states

Patterns / colors kept out of the regular palette so they always read
as "something special is happening here".

### Cables

| State | Style |
|---|---|
| Normal | Solid stroke in the source socket's type color |
| Selected | Same color, thicker stroke |
| Ghost / incomplete | Dashed (`6 4`) + 50% opacity; hover previews solid, click commits (emitted after a 1-in/1-out node delete) |
| Ribbon trunk | Wide neutral gray (`#8a909c`) with flat butt caps — deliberately type-neutral; the per-lane fans carry type color |
| Flow beads (toggle) | Round-capped near-zero dashes riding the cable, tinted toward white |
| Error (future) | Reserved — wavy/squiggle pattern + warning color, distinct from ghost |

### Sockets

| State | Style |
|---|---|
| Normal | Filled shape in the type color, inset `--socket-ring` outline |
| Hover/lit | Flash overlay (`.solenoid-socket-lit`; stadium-shaped on pills) |
| Error (future) | Reserved — red ring + warning glyph, outside the socket palette |
| Required-unconnected (future) | Reserved — hollow variant of the shape |
