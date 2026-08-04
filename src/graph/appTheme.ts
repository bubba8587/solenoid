import { hexToRgba, contrastInk, themeAccent, resolveColor, paletteStore, initPalette, SOCKET_VARS, socketArrayShade, socketMatrixShade, socketRingShade } from "./palette";
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

function apply() {
  const root = document.documentElement;
  const hex = resolveColor(_accent);
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-soft", hexToRgba(hex, 0.14));
  root.style.setProperty("--accent-mid", hexToRgba(hex, 0.4));
  root.style.setProperty("--accent-ink", contrastInk(hex));
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

  // Every socket color is built from the palette (App.css does not define --sock-*),
  // rewritten on every apply so a palette/mode change retints dots, cables and legend.
  for (const { var: varName, slot, kind } of SOCKET_VARS) {
    const base = themeAccent(resolveColor(slot), _mode);
    const val = kind === "array" ? socketArrayShade(base) : kind === "matrix" ? socketMatrixShade(base) : base;
    root.style.setProperty(varName, val);
    // Per-fill ring: a fixed-step darker shade of THIS fill, so every glyph's border
    // reads at the same contrast.
    root.style.setProperty(`${varName}-ring`, socketRingShade(val));
  }

  // The semantic ERROR red derives from the `vermilion` slot, so a custom palette
  // retints errors too; errorChip.css's static fallback covers the first paint.
  root.style.setProperty("--sol-error", themeAccent(resolveColor("vermilion"), _mode));
}

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
