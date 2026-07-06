// App-wide user settings: a small, persisted, flat key→value bag, readable from
// any React root (module singleton, like appThemeStore) so canvas-layer code can
// gate behavior on it. Extend `Settings` + `DEFAULTS` to add a new toggle; the
// Settings page renders whatever's declared in SETTINGS_SCHEMA below.

import { createNotifier, createToggleStore } from "./storeKit";

const LS_KEY = "solenoid.settings";

export interface Settings {
  /** Push neighbouring groups out of the way when a group expands, and slide
   *  them back on collapse (unless they were moved meanwhile). */
  groupPush: boolean;
  /** How Tidy lines connected nodes up vertically: "center" keeps their centres
   *  level (cables may slant a touch); "top" keeps their top edges level. */
  tidyAlign: "center" | "top";
  /** Absolute path to the folder local CSV connections read from. Empty until
   *  the user picks one. Desktop only (the browser build can't read files). */
  csvFolder: string;
  /** Absolute path to the user's chosen documents/library folder — where they
   *  keep saved .json graphs. Purely a bookmark for the "open in file manager"
   *  action (File menu + Settings row); Solenoid doesn't index or scan it. */
  docsFolder: string;

  /** Minimap corner behavior: "bottom" (default, above the socket legend),
   *  "top" (below the Zoom pill), or "hide" (it repaints on every pan). The
   *  socket legend slides down to fill the freed bottom-right corner whenever
   *  this isn't "bottom". */
  minimapPosition: "bottom" | "top" | "hide";
  /** Hide the canvas background dot grid. */
  hideGridDots: boolean;

  /** Drop a cable on empty canvas → the Add menu opens filtered to compatible
   *  node types, pre-wired to whichever one gets picked. */
  quickWire: boolean;
  /** Swap node cards for simplified placeholders once zoomed out past the point
   *  where the DOM/canvas renderer would be dropping mip levels anyway. */
  semanticZoom: boolean;
  /** Keep the command palette docked and always visible (a persistent command bar)
   *  instead of opening on Enter and closing on Escape. */
  commandPaletteAlwaysOn: boolean;
}

const DEFAULTS: Settings = {
  groupPush: true,
  tidyAlign: "center",
  csvFolder: "",
  docsFolder: "",
  minimapPosition: "bottom",
  hideGridDots: false,
  quickWire: false,
  semanticZoom: false,
  commandPaletteAlwaysOn: false,
};

// Declarative schema the Settings page renders from. Grouped into sections.
export interface SettingField {
  key: keyof Settings;
  label: string;
  help?: string;
  /** Control kind. "boolean" (default) renders a toggle; "folder" renders a
   *  read-only path + a Choose button (OS folder picker, desktop only);
   *  "segment" renders a row of mutually-exclusive buttons from `options`. */
  type?: "boolean" | "folder" | "segment";
  /** Choices for a "segment" field. */
  options?: { value: string; label: string }[];
}
export interface SettingsSection {
  title: string;
  fields: SettingField[];
}
export const SETTINGS_SCHEMA: SettingsSection[] = [
  {
    title: "Canvas",
    fields: [
      {
        key: "groupPush",
        label: "Auto-arrange groups on expand",
      },
      {
        key: "tidyAlign",
        label: "Tidy alignment",
        type: "segment",
        options: [
          { value: "center", label: "Center" },
          { value: "top", label: "Top" },
        ],
      },
      {
        key: "quickWire",
        label: "Quick-wire",
        help: "Drop a cable on empty canvas to pick a compatible node and wire it in",
      },
      {
        key: "semanticZoom",
        label: "Semantic zoom",
        help: "Simplify node cards when zoomed far out",
      },
    ],
  },
  {
    title: "Data",
    fields: [
      {
        key: "csvFolder",
        label: "Target data folder",
        type: "folder",
      },
      {
        key: "docsFolder",
        label: "Documents folder",
        help: "Where you keep saved graphs — File ▸ Open documents folder reveals it",
        type: "folder",
      },
    ],
  },
  {
    title: "View",
    fields: [
      {
        key: "minimapPosition",
        label: "Minimap position",
        type: "segment",
        options: [
          { value: "bottom", label: "Bottom" },
          { value: "top", label: "Top" },
          { value: "hide", label: "Hide" },
        ],
      },
      {
        key: "hideGridDots",
        label: "Hide grid dots",
      },
      {
        key: "commandPaletteAlwaysOn",
        label: "Always show command palette",
        help: "Keep it docked at the bottom instead of opening on Enter",
      },
    ],
  },
];

let _settings: Settings = { ...DEFAULTS };
const { notify, subscribe, version } = createNotifier();

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_settings)); }
  catch { /* private mode / quota — non-fatal */ }
}

export const settingsStore = {
  get: <K extends keyof Settings>(key: K): Settings[K] => _settings[key],
  set<K extends keyof Settings>(key: K, val: Settings[K]) {
    if (_settings[key] === val) return;
    _settings = { ..._settings, [key]: val };
    persist();
    notify();
  },
  toggle(key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]) {
    this.set(key, !_settings[key]);
  },
  version,
  subscribe,
};

// CSS-driven toggles → a class on <html>, so canvas/overlay CSS can respond from
// any React root. Kept in lockstep with the values.
const PERF_CLASS_MAP: Array<[keyof Settings, string]> = [
  ["hideGridDots", "perf-no-grid-dots"],
];
function syncPerfClasses(): void {
  if (typeof document === "undefined") return; // node/test env
  const html = document.documentElement;
  for (const [key, cls] of PERF_CLASS_MAP) html.classList.toggle(cls, Boolean(_settings[key]));
  html.classList.toggle("minimap-top", _settings.minimapPosition === "top");
  html.classList.toggle("minimap-hidden", _settings.minimapPosition === "hide");
}
// Re-apply on every settings change (cheap: classList.toggle is idempotent).
subscribe(syncPerfClasses);

/** Read persisted settings (if any). Call once at startup. */
export function initSettings(): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _settings = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* ignore malformed */ }
  syncPerfClasses();
}

// ─── Settings page open/close (separate from the values) ────────────────────────
export const settingsPanel = createToggleStore();
