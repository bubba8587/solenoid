import { hexToRgba, contrastInk, themeAccent, resolveColor, paletteStore, initPalette, SOCKET_VARS, socketArrayShade, socketMatrixShade, socketRingShade } from "./palette";
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
  root.style.setProperty("--accent-ink", contrastInk(hex)); // readable text on the accent
  root.setAttribute("data-theme", _mode);
  root.style.colorScheme = _mode;

  // Tint the mobile browser chrome to the accent via `theme-color`. This works on
  // the Android FULLSCREEN status bar, iOS, an installed PWA's system bars, and the
  // normal-tab toolbar when the BROWSER UI is in light theme. When the browser UI is
  // dark (phone system dark / Chrome theme setting / battery saver), Chrome for
  // Android paints its own dark toolbar and ignores theme-color — long-standing
  // documented behavior, NOT something we can override from the page (the 2026-07-07
  // "a Chrome auto-update dropped it" note was wrong: the variable was the phone's
  // dark mode, invisible to a git diff). Don't re-chase via color-scheme moves or
  // media-variant metas (Chrome ignores media on theme-color; that's Safari) — the
  // one real lever for the dark-toolbar case is a PWA manifest, author-declined.
  let themeMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeMeta) {
    themeMeta = document.createElement("meta");
    themeMeta.setAttribute("name", "theme-color");
    document.head.appendChild(themeMeta);
  }
  themeMeta.setAttribute("content", hex);

  // Match the native Windows 11 window border to the accent (desktop only).
  syncNativeAccent(hex);

  // Every socket color is built from the palette (App.css does not define --sock-*).
  // Scalars = the slot color (mode-shifted); arrays = a darker sibling; matrices = a
  // punchier hue-shifted sibling. Written on every apply so a palette/mode change
  // retints the whole socket family — dots, cables and the legend all read these vars.
  for (const { var: varName, slot, kind } of SOCKET_VARS) {
    const base = themeAccent(resolveColor(slot), _mode);
    const val = kind === "array" ? socketArrayShade(base) : kind === "matrix" ? socketMatrixShade(base) : base;
    root.style.setProperty(varName, val);
    // Per-fill ring/border: a fixed-step darker shade of THIS fill (see socketRingShade),
    // so every glyph's border reads at the same contrast. Consumed as `var(--sock-*-ring)`
    // — each glyph points its `--socket-ring` at the ring matching its own fill.
    root.style.setProperty(`${varName}-ring`, socketRingShade(val));
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
