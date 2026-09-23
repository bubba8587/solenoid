// [[C1]], [[D62]]
import type { FsProvider } from "./fileBridge";
import { settingsStore } from "./settingsStore";

export const DEMO_VAULT_ROOT = "solenoid:demo-vault";

export function isDemoVaultPath(p: string | null | undefined): boolean {
  return !!p && (p === DEMO_VAULT_ROOT || p.startsWith(`${DEMO_VAULT_ROOT}/`));
}

let _forced = false;

export function forceDemoVault(on: boolean): void {
  _forced = on;
}

export function getVaultRoot(): string {
  if (_forced) return DEMO_VAULT_ROOT;
  const own = settingsStore.get("obsidianVault").trim();
  if (own !== "") return own;
  return settingsStore.get("useDemoVault") ? DEMO_VAULT_ROOT : "";
}

export function getCsvFolder(): string {
  if (_forced) return `${DEMO_VAULT_ROOT}/Data`;
  const own = settingsStore.get("csvFolder").trim();
  if (own !== "") return own;
  return settingsStore.get("useDemoVault") ? `${DEMO_VAULT_ROOT}/Data` : "";
}

function relOf(path: string): string {
  if (path === DEMO_VAULT_ROOT) return "";
  return path.slice(DEMO_VAULT_ROOT.length + 1);
}

let _files: Map<string, string> | null = null;
let _loading: Promise<Map<string, string>> | null = null;
function ensureLoaded(): Promise<Map<string, string>> {
  if (_files) return Promise.resolve(_files);
  if (!_loading) {
    _loading = import("./demoVaultData").then((m) => {
      const map = new Map<string, string>();
      for (const [abs, content] of Object.entries(m.DEMO_VAULT_FILES)) {
        map.set(abs.replace(/^.*\/demo-vault\//, ""), content);
      }
      _files = map;
      return map;
    }, (e: unknown) => {
      _loading = null; // a failed load (a dropped chunk) retries on the next read
      throw e;
    });
  }
  return _loading;
}

const LIVE = import.meta.env.MODE === "development";
async function listKeys(): Promise<Iterable<string>> {
  if (!LIVE) return (await ensureLoaded()).keys();
  const r = await fetch("/__demo-vault");
  if (!r.ok) throw new Error("The demo vault listing failed.");
  return (await r.json()) as string[];
}
async function readText(rel: string): Promise<string | undefined> {
  if (!LIVE) return (await ensureLoaded()).get(rel);
  const r = await fetch(`/__demo-vault?p=${encodeURIComponent(rel)}`);
  return r.ok ? await r.text() : undefined;
}

const readOnly = async (): Promise<never> => {
  throw new Error("The demo vault is read-only.");
};

export const demoVaultFs: FsProvider = {
  async readTextFile(path) {
    const content = await readText(relOf(path));
    if (content === undefined) throw new Error(`Not in the demo vault: ${relOf(path)}`);
    return content;
  },
  async readDir(path) {
    const keys = await listKeys();
    const base = relOf(path);
    const prefix = base ? `${base}/` : "";
    const fileNames = new Set<string>();
    const dirNames = new Set<string>();
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) fileNames.add(rest);
      else dirNames.add(rest.slice(0, slash));
    }
    return [
      ...[...dirNames].map((name) => ({ name, isDirectory: true, isFile: false })),
      ...[...fileNames].map((name) => ({ name, isDirectory: false, isFile: true })),
    ];
  },
  async exists(path) {
    const rel = relOf(path);
    if (rel === "") return true;
    const prefix = `${rel}/`;
    for (const key of await listKeys()) if (key === rel || key.startsWith(prefix)) return true;
    return false;
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async stat() {
    return { mtimeMs: null, birthtimeMs: null };
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async join(...parts) {
    return parts.filter((p) => p !== "").join("/").replace(/\/{2,}/g, "/");
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async dirname(path) {
    const i = path.lastIndexOf("/");
    return i === -1 ? path : path.slice(0, i);
  },
  async readBinary() {
    throw new Error("The demo vault has no binary files.");
  },
  writeTextFile: readOnly,
  writeBinary: readOnly,
  rename: readOnly,
  mkdir: readOnly,
};
