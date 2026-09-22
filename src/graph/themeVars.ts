// [[C62]]
import { hexToRgba, contrastInk, themeAccent, resolveColor, paletteStore, SOCKET_VARS, socketArrayShade, socketMatrixShade, socketRingShade, chromeCssVars, adaptChrome, CHROME_VARS, DERIVED_CHROME_VARS } from "./palette";

export type ThemeMode = "dark" | "light";

const ALL_CHROME_VARS: string[] = [...CHROME_VARS.map((v) => v.var), ...DERIVED_CHROME_VARS];

/** Every custom property the theme writes for one accent + mode; `null` clears one.
 *  Pure and in its own module, so a host with no `<html>` of its own (the Obsidian plugin)
 *  scopes the same values without the store that writes them. */
export function themeVars(accentSlot: string, mode: ThemeMode): Record<string, string | null> {
  const vars: Record<string, string | null> = {};
  const hex = resolveColor(accentSlot);
  vars["--accent"] = hex;
  vars["--accent-soft"] = hexToRgba(hex, 0.14);
  vars["--accent-mid"] = hexToRgba(hex, 0.4);
  vars["--accent-ink"] = contrastInk(hex);

  // Every socket color is built from the palette (App.css does not define --sock-*),
  // so a palette/mode change retints dots, cables and legend.
  for (const { var: varName, slot, kind } of SOCKET_VARS) {
    const base = themeAccent(resolveColor(slot), mode);
    const val = kind === "array" ? socketArrayShade(base) : kind === "matrix" ? socketMatrixShade(base) : base;
    vars[varName] = val;
    // Per-fill ring: a fixed-step darker shade of THIS fill, so every glyph's border
    // reads at the same contrast.
    vars[`${varName}-ring`] = socketRingShade(val);
  }

  // The semantic ERROR red derives from the `vermilion` slot, so a custom palette
  // retints errors too; errorChip.css's static fallback covers the first paint.
  vars["--sol-error"] = themeAccent(resolveColor("vermilion"), mode);

  // The neutral chrome, when the active palette authors a ramp. A palette that
  // doesn't must CLEAR every var, not skip it: an inline property beats App.css's
  // ramps, so leaving the last palette's behind would strand a cream workbench under
  // the Default palette. The hexes go through unshifted — themeAccent tunes an accent
  // AGAINST the chrome, and the chrome is what it's tuned against. An adaptive ramp
  // (CHROME_HOME) first follows the accent's hue, resolved through the live palette
  // so the tint tracks what the accent dot actually shows.
  const home = paletteStore.chromeHomeHex();
  const ramp = paletteStore.chrome()[mode];
  const chrome = chromeCssVars(home ? adaptChrome(ramp, home, hex) : ramp, mode);
  for (const name of ALL_CHROME_VARS) vars[name] = chrome[name] || null;
  return vars;
}
