// Persisted app-wide settings, a module singleton so any React root can read them.
// A new toggle = `Settings` + `DEFAULTS` + a SETTINGS_SCHEMA entry.

import { createNotifier, createToggleStore } from "./storeKit";

const LS_KEY = "solenoid.settings";

export interface Settings {
  /** Push neighboring groups aside on expand, sliding back unless they were moved. */
  groupPush: boolean;
  /** Tidy's vertical alignment: "center" levels centers, "top" levels top edges. */
  tidyAlign: "center" | "top";
  /** Absolute path local CSV connections read from; desktop only. */
  csvFolder: string;
  /** Bookmark for the "open in file manager" action; never indexed or scanned. */
  docsFolder: string;
  /** Obsidian vault root the Obsidian nodes read/write `.md` under; desktop only. */
  obsidianVault: string;
  /** Vault-relative subfolder for written image assets; empty = beside the note. */
  obsidianAssetSubfolder: string;

  /** Minimap corner: "bottom" (default), "top", or "hide"; the socket legend slides
   *  down into the freed corner whenever this isn't "bottom". */
  minimapPosition: "bottom" | "top" | "hide";
  /** Hide the canvas background dot grid. */
  hideGridDots: boolean;

  /** Drop a cable on empty canvas → the Add menu opens filtered to compatible
   *  node types, pre-wired to whichever one gets picked. */
  quickWire: boolean;
  /** Swap node cards for simplified placeholders once zoomed far out. */
  semanticZoom: boolean;
  /** Keep the command palette docked instead of opening on Enter; desktop only. */
  commandPaletteAlwaysOn: boolean;
  /** Date Input reads relative phrases (today / next friday / in 3 days), re-resolved on every
   *  recalculation, with an Alert when the resolved day shifts. Off = every date is a fixed day. */
  relativeDates: boolean;
}

const DEFAULTS: Settings = {
  groupPush: true,
  tidyAlign: "center",
  csvFolder: "",
  docsFolder: "",
  obsidianVault: "",
  obsidianAssetSubfolder: "",
  minimapPosition: "bottom",
  hideGridDots: false,
  quickWire: false,
  semanticZoom: false,
  commandPaletteAlwaysOn: false,
  relativeDates: false,
};

export interface SettingField {
  key: keyof Settings;
  label: string;
  help?: string;
  /** Control kind. "boolean" (default) renders a toggle; "folder" renders a
   *  read-only path + a Choose button (OS folder picker, desktop only);
   *  "segment" renders a row of mutually-exclusive buttons from `options`;
   *  "text" renders a free-text input (e.g. a relative subfolder name). */
  type?: "boolean" | "folder" | "segment" | "text";
  /** Placeholder for a "text" field. */
  placeholder?: string;
  /** Choices for a "segment" field. */
  options?: { value: string; label: string }[];
  /** No mobile counterpart exists: consumers must BOTH gray the control and skip
   *  the behavior, never silently do nothing. */
  disabledOnMobile?: boolean;
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
        help: "Drop a cable on empty canvas to pick a compatible node and connect it",
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
      {
        key: "relativeDates",
        label: "Relative dates",
        help: "Date Input understands today, next Friday, in 3 days — resolved again on every recalculation, with an Alert when the day moves",
      },
    ],
  },
  {
    title: "Obsidian",
    fields: [
      {
        key: "obsidianVault",
        label: "Vault folder",
        help: "The Write to Obsidian and Import from Obsidian nodes read and write .md files under this folder",
        type: "folder",
      },
      {
        key: "obsidianAssetSubfolder",
        label: "Asset subfolder",
        help: "Where chart or image assets go when writing a note, relative to the vault. Blank = beside the note",
        type: "text",
        placeholder: "assets",
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
        // The minimap isn't rendered on mobile at all, so every position is a no-op.
        disabledOnMobile: true,
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
        // The palette is top-anchored on mobile — no bottom strip to dock to.
        disabledOnMobile: true,
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

// CSS-driven toggles → a class on <html>, so any React root's CSS can respond.
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
subscribe(syncPerfClasses);

/** Read persisted settings (if any). Call once at startup. */
export function initSettings(): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _settings = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* ignore malformed */ }
  syncPerfClasses();
}

export const settingsPanel = createToggleStore();
