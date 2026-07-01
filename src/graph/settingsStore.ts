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

  /** Hide the minimap (it repaints on every pan). */
  perfHideMinimap: boolean;
}

const DEFAULTS: Settings = {
  groupPush: true,
  tidyAlign: "center",
  csvFolder: "",
  perfHideMinimap: false,
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
        help: "Groups you moved yourself stay put.",
      },
      {
        key: "tidyAlign",
        label: "Tidy alignment",
        help: "Center keeps node centres level; Top, their top edges.",
        type: "segment",
        options: [
          { value: "center", label: "Center" },
          { value: "top", label: "Top" },
        ],
      },
    ],
  },
  {
    title: "Data",
    fields: [
      {
        key: "csvFolder",
        label: "Target data folder",
        help: "Where CSV Connection nodes read .csv files from.",
        type: "folder",
      },
    ],
  },
  {
    title: "View",
    fields: [
      {
        key: "perfHideMinimap",
        label: "Hide minimap",
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
  ["perfHideMinimap", "perf-no-minimap"],
];
function syncPerfClasses(): void {
  if (typeof document === "undefined") return; // node/test env
  const html = document.documentElement;
  for (const [key, cls] of PERF_CLASS_MAP) html.classList.toggle(cls, Boolean(_settings[key]));
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
