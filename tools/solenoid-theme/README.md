# solenoid-theme

Solenoid's palette system, for any page. Not a look-alike: the palette code is Solenoid's own, generated from its
TypeScript, so every rule the app follows is here and stays here.

- **Nine palettes** (Default, Muted, Colorblind-safe, Solarized, Equinox, Orchard, Blueprint, Neon, Dawn and Dusk) and
  **Custom**, each twelve color slots plus a thirteen-key workbench ramp per light and dark mode.
- **The chrome derives from the ramp**: overlay borders, button hover, light-mode shadows in the ink's own hue. Under
  Default the stylesheet's own tokens are the ramp.
- **The accent is a slot**, picked from the swatches. Orchard and Blueprint retint their whole workbench to follow it
  (in OKLCh, holding every key's luminance), so a vermilion accent turns Blueprint into a red-line print.
- **The ink rule**: text on a filled color is white when white clears 3:1 against it, else near-black.
- **The status tokens** (`--sol-error`, `--sol-ok`, `--sol-warn`), the socket colors (`--sock-*`), the neutral cycle
  (white, gray, dark), the light-mode accent drop: all of it, as Solenoid has it.
- **The controls**, as Solenoid draws them: the toolbar pill (the paintbrush with the accent dot, opening the swatches;
  the moon or sun beside it, moving into the swatch popup on a phone), round tool buttons, the Settings dialog with its
  Appearance section (palette select, Edit custom…, the accent swatches), and the Custom palette editor.

The rules, and why each is what it is, are in Solenoid's `tree/specs/canvas/palette-and-theme.md` and `DESIGN.md` §2
Colors and §5 Components.

## Use

```html
<link rel="stylesheet" href="solenoid-theme/theme.css">     <!-- the tokens (App.css) -->
<link rel="stylesheet" href="solenoid-theme/controls.css">  <!-- the controls' own CSS (generated) -->
<link rel="stylesheet" href="solenoid-theme/kit.css">       <!-- the dialog layer and the editor's sample -->
<script type="module">
  import { initTheme, appTools, toolButton, openSettings, switchRow, ICONS } from './solenoid-theme/index.js';
  initTheme();                       // the saved palette and theme, the slot variables, the phone flag
  const tools = appTools({ buttons: [toolButton({ title: 'Settings', icon: ICONS.settings, onClick: () => openSettings() })] });
  document.querySelector('header').append(tools.el);
</script>
```

Then style with the tokens: `--surface`, `--surface-sunken`, `--surface-raised`, `--border`, `--text`, `--text-dim`,
`--accent`, `--accent-ink`, `--btn-bg`, `--btn-hover`, `--overlay-border`, the mix rungs (`--mix-edge`, `--mix-ring`…),
the status tokens, and `--slot-<id>` / `--slot-<id>-ink` for anything colored by slot (`initTheme` writes these, light
drop applied). Store slot ids, never hexes, and the palette can change under them.

| Export | What it is |
|---|---|
| `initTheme({ slotRoles, isMobile })` | Start-up, once. `slotRoles` names the slots in the Custom editor (`[{ slot, label }]`, Solenoid's by default); `isMobile` overrides the phone test. |
| `appThemeStore` | The accent slot and the mode: `getAccent`, `setAccent`, `getMode`, `setMode`, `toggleMode`, `subscribe`. Saved as `solenoid.theme`. |
| `paletteStore` | The palette: `names`, `activeBase`, `setActiveBase`, `chrome`, `customMap`, `setCustomMap`, `subscribe`. Saved as `solenoid.palette`. |
| `resolveColor(slot)`, `resolveAccent(slot)`, `themeAccent(hex, mode)`, `contrastInk(hex)` | A slot to a hex, the light-mode drop, the ink for a fill. |
| `themeVars(accent, mode)` | Every variable the theme writes, as a map (null means remove), for a host that scopes them itself. |
| `appTools`, `toolButton`, `swatchGrid`, `openSettings`, `switchRow` | The controls. |
| `setNativeAccentHook(fn)` | Called with the accent hex on each change, for a desktop window border. |

## How it's made

`sync.mjs` builds everything marked generated from a Solenoid checkout:

| Generated | From |
|---|---|
| `core/palette.js`, `storeKit.js`, `colormaps.js`, `themeVars.js`, `appTheme.js` | `src/graph/*.ts`, types stripped by Node, nothing else changed |
| `theme.css` | `src/App.css`'s two `:root` token blocks and `errorChip.css`'s status fallbacks |
| `controls.css` | `AppToolbar.css`, `SwatchGrid.css`, `PaletteEditor.css`, the Appearance dialog's rules from `Settings.css`, the pill's phone rules from `mobile.css` |

Hand-written: `controls.js` (the React components, as plain DOM, with Solenoid's class names), `core/nativeAccent.js`
(the hook in place of Tauri), `kit.css`, `index.js`.

```
node tools/solenoid-theme/sync.mjs           # after a palette change in Solenoid
node tools/solenoid-theme/sync.mjs --check   # fails when the kit is behind Solenoid (the tests run it)
node --test tools/solenoid-theme/test/kit.test.js
```

`sync.mjs` also refreshes any vendored copies listed in its `VENDOR` (none at present), so an app that has to stay
one folder can carry its own copy and still not drift.

## Moving it out

The folder is self-contained (no dependencies; Node 22.13+ only to sync). To make it its own package: copy the folder
to a new repository, set `SOLENOID_ROOT` to a Solenoid checkout when syncing, publish. The natural last step is the
other way round: Solenoid imports `solenoid-theme` and the generated files become the source. Until then Solenoid is
the source, and `--check` is what keeps the two one system.

Icons are Lucide's (ISC): paintbrush, chevron-down, settings.
