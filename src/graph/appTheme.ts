// [[C62]]
import { hexToRgba, contrastInk, themeAccent, resolveColor, paletteStore, initPalette, SOCKET_VARS, socketArrayShade, socketMatrixShade, socketRingShade, chromeCssVars, adaptChrome, CHROME_VARS, DERIVED_CHROME_VARS } from "./palette";
import { createNotifier } from "./storeKit";
import { syncNativeAccent } from "./nativeAccent";

// App-wide accent + light/dark mode. The accent is a palette SLOT id, resolved to
// hex only when written to <html>'s custom properties.

export type ThemeMode = "dark" | "light";

const LS_KEY = "solenoid.theme";
const DEFAULT_ACCENT = "gold"; // palette slot — the brand coil's gold (#f5b914)

let _accent = DEFAULT_ACCENT;
let _mode: ThemeMode = "dark";
const { notify, subscribe, version } = createNotifier();

/** Every custom property the theme writes for one accent + mode; `null` clears one.
 *  Pure, so a host with no `<html>` of its own (the Obsidian plugin) scopes the same values. */
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

function apply() {
  const root = document.documentElement;
  const hex = resolveColor(_accent);
  for (const [name, value] of Object.entries(themeVars(_accent, _mode))) {
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  root.setAttribute("data-theme", _mode);
  root.style.colorScheme = _mode;

  // Tint the mobile browser chrome to the accent via `theme-color`.
  let themeMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeMeta) {
    themeMeta = document.createElement("meta");
    themeMeta.setAttribute("name", "theme-color");
    document.head.appendChild(themeMeta);
  }
  themeMeta.setAttribute("content", hex);

  // Match the native Windows 11 window border to the accent (desktop only).
  syncNativeAccent(hex);
}

const ALL_CHROME_VARS: string[] = [...CHROME_VARS.map((v) => v.var), ...DERIVED_CHROME_VARS];

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ accent: _accent, mode: _mode })); }
  catch { /* private mode / quota — non-fatal */ }
}

export const appThemeStore = {
  getAccent: () => _accent,
  getMode: () => _mode,
  version,
  setAccent(c: string) { if (c === _accent) return; _accent = c; apply(); persist(); notify(); },
  setMode(m: ThemeMode) { if (m === _mode) return; _mode = m; apply(); persist(); notify(); },
  toggleMode() { this.setMode(_mode === "dark" ? "light" : "dark"); },
  subscribe,
};

// Re-applying + notifying here reuses appThemeStore's subscriptions instead of
// wiring a palette subscription into every visual component (distinct notifiers).
paletteStore.subscribe(() => { apply(); notify(); });

/** Read the persisted theme (if any) and apply it. Call once at startup. */
export function initAppTheme() {
  initPalette(); // resolve the persisted palette base before the accent resolves through it
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<{ accent: string; mode: ThemeMode }>;
      if (typeof saved.accent === "string") _accent = saved.accent;
      if (saved.mode === "dark" || saved.mode === "light") _mode = saved.mode;
    }
  } catch { /* ignore malformed */ }
  apply();
}
