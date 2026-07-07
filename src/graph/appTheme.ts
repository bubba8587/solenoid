import { hexToRgba, contrastInk, themeAccent, resolveColor, paletteStore, initPalette, SOCKET_VARS, socketArrayShade, socketMatrixShade } from "./palette";
import { createNotifier } from "./storeKit";
import { syncNativeAccent } from "./nativeAccent";

// App-wide theme: an accent color (drives chrome highlights) and a light/dark
// mode. The accent is stored as a palette SLOT id (like every other color in the
// app), resolved to a hex only when written to the CSS custom properties on
// <html> so any stylesheet can read it. Persisted to localStorage. Module-level
// singleton (like cableShapeStore) so it's readable from Rete's separate React
// root too.

export type ThemeMode = "dark" | "light";

const LS_KEY = "solenoid.theme";
const DEFAULT_ACCENT = "sky"; // palette slot (the old #56b4e9)

let _accent = DEFAULT_ACCENT;
let _mode: ThemeMode = "dark";
const { notify, subscribe, version } = createNotifier();

/** Ensure a `<meta name="theme-color">` for the given media (null = the media-less
 *  fallback) exists in <head> and set its content. Keyed on the exact media string
 *  so the three variants stay distinct and each updates in place. */
function setThemeColorMeta(media: string | null, hex: string): void {
  const sel = media
    ? `meta[name="theme-color"][media="${media}"]`
    : 'meta[name="theme-color"]:not([media])';
  let m = document.head.querySelector<HTMLMetaElement>(sel);
  if (!m) {
    m = document.createElement("meta");
    m.setAttribute("name", "theme-color");
    if (media) m.setAttribute("media", media);
    document.head.appendChild(m);
  }
  m.setAttribute("content", hex);
}

function apply() {
  const root = document.documentElement;
  const hex = resolveColor(_accent);
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-soft", hexToRgba(hex, 0.14));
  root.style.setProperty("--accent-mid", hexToRgba(hex, 0.4));
  root.style.setProperty("--accent-ink", contrastInk(hex)); // readable text on the accent
  root.setAttribute("data-theme", _mode);
  // color-scheme goes on BODY, not <html>. Content form controls / scrollbars still
  // theme to the mode (the used value propagates down the cascade from body), but the
  // ROOT stays neutral — so Android Chrome's normal-tab toolbar honors the accent
  // `theme-color` above instead of reading a dark root color-scheme and painting
  // itself dark (which overrode it: the accent status-bar tint survived ONLY in
  // fullscreen, where there's no browser toolbar to steal it).
  root.style.colorScheme = "";
  if (document.body) document.body.style.colorScheme = _mode;

  // Tint the mobile browser chrome (Android Chrome status bar; iOS PWA) to the
  // accent, matching the accent doc-title row directly beneath it. `theme-color`
  // only drives the TOP status bar in a normal browser tab — the bottom system nav
  // bar isn't web-controllable there (it follows the page only in an installed
  // standalone PWA), so this is a best-effort top-edge match.
  //
  // Newer Chrome for Android IGNORES a single media-less `theme-color` in a dark-mode
  // normal tab (the toolbar goes dark and eats it) — this used to work and stopped
  // when Chrome auto-updated (the committed config is byte-identical to when it did).
  // The fix is explicit `media` variants; set the SAME accent on the media-less
  // fallback + both prefers-color-scheme variants so whichever Chrome honors is the
  // accent. (Fullscreen was always fine — it has no toolbar.)
  setThemeColorMeta(null, hex);
  setThemeColorMeta("(prefers-color-scheme: light)", hex);
  setThemeColorMeta("(prefers-color-scheme: dark)", hex);

  // Match the native Windows 11 window border to the accent (desktop only).
  syncNativeAccent(hex);

  // Every socket color is built from the palette (App.css no longer defines --sock-*).
  // Scalars = the slot color (mode-shifted); arrays = a darker sibling; matrices = a
  // punchier hue-shifted sibling. Written on every apply so a palette/mode change
  // retints the whole socket family — dots, cables and the legend all read these vars.
  for (const { var: varName, slot, kind } of SOCKET_VARS) {
    const base = themeAccent(resolveColor(slot), _mode);
    const val = kind === "array" ? socketArrayShade(base) : kind === "matrix" ? socketMatrixShade(base) : base;
    root.style.setProperty(varName, val);
  }

  // The semantic ERROR/Problems red derives from the palette's `vermilion` slot
  // (freed from the Table socket 2026-07-06), so there's ONE red and a custom
  // palette retints errors too. errorChip.css keeps a static fallback for before
  // this first runs; this inline root var wins over it.
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

// When the active palette changes (app switcher or a doc's declared palette), the
// accent CSS vars must re-resolve AND everything that subscribes to appThemeStore
// for retinting (node cards, notes, groups, minimap, …) must re-render. Re-applying
// + notifying here reuses those existing subscriptions instead of wiring a palette
// subscription into every visual component. (Distinct notifiers, so no loop.)
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
