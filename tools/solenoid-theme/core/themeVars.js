// GENERATED from src/graph/themeVars.ts (3f258b4d909f) by tools/solenoid-theme/sync.mjs. Edit the source in Solenoid, then sync.
// [[A1]] visualGraphCalculator, [[components#The design system]]
import { hexToRgba, contrastInk, themeAccent, resolveColor, resolveAccent, paletteStore, SOCKET_VARS, socketArrayShade, socketMatrixShade, socketRingShade, chromeCssVars, adaptChrome, CHROME_VARS, DERIVED_CHROME_VARS } from "./palette.js";



const ALL_CHROME_VARS           = [...CHROME_VARS.map((v) => v.var), ...DERIVED_CHROME_VARS];

/** `null` means remove that property. */
export function themeVars(accentSlot        , mode           )                                {
  const vars                                = {};
  const hex = resolveAccent(accentSlot);
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
  vars["--sol-ok"] = themeAccent(resolveColor("green"), mode);
  vars["--sol-warn"] = themeAccent(resolveColor("gold"), mode);
  vars["--art-sun"] = themeAccent(resolveColor("gold"), mode);
  vars["--art-rain"] = themeAccent(resolveColor("sky"), mode);
  vars["--lasso-enclose"] = themeAccent(resolveColor("sky"), mode);
  vars["--lasso-touch"] = themeAccent(resolveColor("gold"), mode);

  const home = paletteStore.chromeHomeHex();
  const ramp = paletteStore.chrome()[mode];
  const chrome = chromeCssVars(home ? adaptChrome(ramp, home, hex, paletteStore.chromeBand(mode)) : ramp, mode);
  for (const name of ALL_CHROME_VARS) vars[name] = chrome[name] || null;
  return vars;
}
