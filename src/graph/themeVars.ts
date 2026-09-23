// [[C62]] paletteAllOrNone
import { hexToRgba, contrastInk, themeAccent, resolveColor, paletteStore, SOCKET_VARS, socketArrayShade, socketMatrixShade, socketRingShade, chromeCssVars, adaptChrome, CHROME_VARS, DERIVED_CHROME_VARS } from "./palette";

export type ThemeMode = "dark" | "light";

const ALL_CHROME_VARS: string[] = [...CHROME_VARS.map((v) => v.var), ...DERIVED_CHROME_VARS];

/** `null` means remove that property. */
export function themeVars(accentSlot: string, mode: ThemeMode): Record<string, string | null> {
  const vars: Record<string, string | null> = {};
  const hex = resolveColor(accentSlot);
  vars["--accent"] = hex;
  vars["--accent-soft"] = hexToRgba(hex, 0.14);
  vars["--accent-mid"] = hexToRgba(hex, 0.4);
  vars["--accent-ink"] = contrastInk(hex);

  for (const { var: varName, slot, kind } of SOCKET_VARS) {
    const base = themeAccent(resolveColor(slot), mode);
    const val = kind === "array" ? socketArrayShade(base) : kind === "matrix" ? socketMatrixShade(base) : base;
    vars[varName] = val;
    vars[`${varName}-ring`] = socketRingShade(val);
  }

  vars["--sol-error"] = themeAccent(resolveColor("vermilion"), mode);

  const home = paletteStore.chromeHomeHex();
  const ramp = paletteStore.chrome()[mode];
  const chrome = chromeCssVars(home ? adaptChrome(ramp, home, hex) : ramp, mode);
  for (const name of ALL_CHROME_VARS) vars[name] = chrome[name] || null;
  return vars;
}
