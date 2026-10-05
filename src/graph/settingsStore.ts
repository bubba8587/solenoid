// [[D54]] relativeDatesOptIn

import { createNotifier, createToggleStore } from "./storeKit";

/** Display only: the stored label stays raw. */
export type HeaderTitleCase = "as-typed" | "upper" | "proper";

const LS_KEY = "solenoid.settings";

export interface Settings {
  groupPush: boolean;
  frontOnExpand: boolean;
  tidyAlign: "balanced" | "sockets" | "center" | "top";
  tidyDirection: "right" | "down";
  tidyDensity: "compact" | "normal" | "airy";
  /** A string so the segment control stores it directly; the call site maps it to the numeric cap. */
  tidyWidthCap: "off" | "2" | "3" | "4";
  /** An absolute path; desktop only. */
  csvFolder: string;
  /** Bookmark for the "open in file manager" action; never indexed or scanned. */
  docsFolder: string;
  /** Bypasses the per-document network gate ([[C103]] untrustedContentSeams). */
  alwaysAllowNetwork: boolean;
  obsidianVault: string;
  /** With no vault or TaskNotes URL set, the Obsidian nodes read the bundled read-only demo ([[D62]] demoVaultResolution). */
  useDemoVault: boolean;
  /** Empty means beside the note. */
  obsidianAssetSubfolder: string;
  /** Empty means http://localhost:8080. The bearer token lives in apiKeyStore, never here. */
  taskNotesUrl: string;
  /** Desktop: frame verbs run on the native Polars engine; off runs them on the JS oracle, as the web does. */
  nativeEngine: boolean;

  minimapPosition: "bottom" | "top" | "hide";
  hideGridDots: boolean;
  tablePopupSummary: boolean;
  tablePopupFrozen: boolean;

  quickWire: boolean;
  semanticZoom: boolean;
  headerTitleCase: HeaderTitleCase;
  commandPaletteAlwaysOn: boolean;
  relativeDates: boolean;
  /** How many decimal places a number with no format shows; a string so the segment control stores it directly. */
  numberDecimals: "2" | "3" | "4" | "6";
}

export const DEFAULT_SETTINGS: Settings = {
  groupPush: true,
  frontOnExpand: true,
  tidyAlign: "balanced",
  tidyDirection: "right",
  tidyDensity: "normal",
  tidyWidthCap: "off",
  csvFolder: "",
  docsFolder: "",
  alwaysAllowNetwork: false,
  nativeEngine: true,
  useDemoVault: true,
  obsidianVault: "",
  obsidianAssetSubfolder: "",
  taskNotesUrl: "",
  minimapPosition: "bottom",
  hideGridDots: false,
  tablePopupSummary: true,
  tablePopupFrozen: true,
  quickWire: false,
  semanticZoom: false,
  headerTitleCase: "upper",
  commandPaletteAlwaysOn: false,
  relativeDates: false,
  numberDecimals: "4",
};

export interface SettingField {
  key: keyof Settings;
  label: string;
  help?: string;
  type?: "boolean" | "folder" | "segment" | "text";
  /** What an empty field reads as; a function when it depends on another setting. */
  placeholder?: string | ((get: <K extends keyof Settings>(key: K) => Settings[K]) => string);
  options?: { value: string; label: string }[];
  accordion?: string;
  /** No mobile counterpart: consumers must both gray the control and skip the behavior. */
  disabledOnMobile?: boolean;
  /** Desktop app only: grayed on the web, where the behavior doesn't exist. */
  desktopOnly?: boolean;
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
        key: "frontOnExpand",
        label: "Bring a card to the front on expand",
        help: "So an expanded card isn't stuck behind its neighbors",
      },
      {
        key: "tidyAlign",
        label: "Tidy alignment",
        type: "segment",
        accordion: "Tidy",
        options: [
          { value: "balanced", label: "Balanced" },
          { value: "sockets", label: "Sockets" },
          { value: "center", label: "Center" },
          { value: "top", label: "Top" },
        ],
      },
      {
        key: "tidyDirection",
        label: "Tidy direction",
        type: "segment",
        accordion: "Tidy",
        options: [
          { value: "right", label: "Right" },
          { value: "down", label: "Down" },
        ],
      },
      {
        key: "tidyDensity",
        label: "Tidy density",
        type: "segment",
        accordion: "Tidy",
        options: [
          { value: "compact", label: "Compact" },
          { value: "normal", label: "Normal" },
          { value: "airy", label: "Airy" },
        ],
      },
      {
        key: "tidyWidthCap",
        label: "Tidy width cap",
        type: "segment",
        accordion: "Tidy",
        options: [
          { value: "off", label: "Off" },
          { value: "2", label: "2" },
          { value: "3", label: "3" },
          { value: "4", label: "4" },
        ],
      },
      {
        key: "quickWire",
        label: "Quick-wire",
        help: "Dropping a cable on empty canvas",
      },
      {
        key: "semanticZoom",
        label: "Semantic zoom",
        help: "Simplify node cards when zoomed far out",
      },
      {
        key: "headerTitleCase",
        label: "Header title case",
        type: "segment",
        options: [
          { value: "as-typed", label: "As typed" },
          { value: "upper", label: "UPPER" },
          { value: "proper", label: "Proper" },
        ],
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
        key: "numberDecimals",
        label: "Decimal places",
        help: "For numbers without a format. Trailing zeros are dropped.",
        type: "segment",
        options: [
          { value: "2", label: "2" },
          { value: "3", label: "3" },
          { value: "4", label: "4" },
          { value: "6", label: "6" },
        ],
      },
      {
        key: "commandPaletteAlwaysOn",
        label: "Always show Command Palette",
        help: "",
        disabledOnMobile: true,
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
        help: "",
        type: "folder",
      },
      {
        key: "relativeDates",
        label: "Relative dates",
        help: "Date Input fields can parse \"next Tuesday\". WARNING: this adds volatility!",
      },
      {
        key: "nativeEngine",
        label: "Polars engine",
        help: "Runs table operations on Polars. Turn it off to compare results with the web app's engine. Changing it reloads the document.",
        desktopOnly: true,
      },
      {
        key: "alwaysAllowNetwork",
        label: "Always allow network",
        help: "Opened and imported documents fetch without asking. Off: each foreign document asks once.",
      },
    ],
  },
  {
    title: "Obsidian",
    fields: [
      {
        key: "obsidianVault",
        label: "Vault folder",
        help: "For the Import from and Write To Obsidian nodes",
        type: "folder",
      },
      {
        key: "useDemoVault",
        label: "Use demo vault",
        help: "Use the demo vault on the web app and whenever no other vault is selected. Off with no vault configured, several nodes will not work.",
      },
      {
        key: "obsidianAssetSubfolder",
        label: "Asset subfolder",
        help: "Charts and images are saved here.",
        type: "text",
        placeholder: "assets",
      },
      {
        key: "taskNotesUrl",
        label: "TaskNotes API",
        help: "The TaskNotes plugin's HTTP API. Turn it on in the plugin's settings; the token goes on the TaskNotes card.",
        type: "text",
        // Blank reads the demo vault while Use demo vault is on ([[D62]] demoVaultResolution), else the plugin's default address.
        placeholder: (get) => (get("useDemoVault") ? "Demo vault" : "http://localhost:8080"),
      },
    ],
  },
];

let _settings: Settings = { ...DEFAULT_SETTINGS };
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

const PERF_CLASS_MAP: Array<[keyof Settings, string]> = [
  ["hideGridDots", "perf-no-grid-dots"],
];
function syncPerfClasses(): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  for (const [key, cls] of PERF_CLASS_MAP) html.classList.toggle(cls, Boolean(_settings[key]));
  html.classList.toggle("minimap-top", _settings.minimapPosition === "top");
  html.classList.toggle("minimap-hidden", _settings.minimapPosition === "hide");
  html.classList.toggle("hdr-case-upper", _settings.headerTitleCase === "upper");
  html.classList.toggle("hdr-case-proper", _settings.headerTitleCase === "proper");
  html.classList.toggle("hdr-case-as-typed", _settings.headerTitleCase === "as-typed");
}
subscribe(syncPerfClasses);

/** Call once at startup. */
export function initSettings(): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* ignore malformed */ }
  syncPerfClasses();
}

export const settingsPanel = createToggleStore();
