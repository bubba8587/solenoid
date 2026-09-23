// [[C62]] paletteAllOrNone
import { resolveColor, paletteStore, initPalette } from "./palette";
import { themeVars, type ThemeMode } from "./themeVars";
import { createNotifier } from "./storeKit";
import { syncNativeAccent } from "./nativeAccent";

const LS_KEY = "solenoid.theme";
const DEFAULT_ACCENT = "gold";

let _accent = DEFAULT_ACCENT;
let _mode: ThemeMode = "dark";
const { notify, subscribe, version } = createNotifier();

function apply() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const hex = resolveColor(_accent);
  for (const [name, value] of Object.entries(themeVars(_accent, _mode))) {
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  root.setAttribute("data-theme", _mode);
  root.style.colorScheme = _mode;

  let themeMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeMeta) {
    themeMeta = document.createElement("meta");
    themeMeta.setAttribute("name", "theme-color");
    document.head.appendChild(themeMeta);
  }
  themeMeta.setAttribute("content", hex);

  syncNativeAccent(hex);
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

paletteStore.subscribe(() => { apply(); notify(); });

/** Call once at startup. */
export function initAppTheme() {
  initPalette(); // must run first: the accent resolves through the persisted palette
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
