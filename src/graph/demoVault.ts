// dte:C1,D62
// The bundled, read-only demo vault, served through the fileBridge FsProvider seam so
// the Obsidian vault readers (Vault Folder, Import Obsidian Note) work with no real
// vault — the web app included. It is selected by a SENTINEL vault root: with no vault
// folder configured and the "Use demo vault" setting on, getVaultRoot() returns
// DEMO_VAULT_ROOT, the readers recognise it, and fileBridge's path-aware dispatch routes
// those paths here instead of the OS filesystem. Writes throw (the demo is not editable). The file contents are
// lazily code-split (demoVaultData.ts) so they never weigh down the main bundle. Under the
// dev server they are read live from disk instead (`/__demo-vault`, vite.config.ts), so an
// Obsidian edit to the repo's vault shows on refresh.
import type { FsProvider } from "./fileBridge";
import { settingsStore } from "./settingsStore";

/** The virtual vault root standing in for a real folder path. Carries a colon so it
 *  can never collide with an OS path a user could type. */
export const DEMO_VAULT_ROOT = "solenoid:demo-vault";

/** Is this path inside the bundled demo vault (so it routes to the in-memory provider,
 *  never the filesystem)? */
export function isDemoVaultPath(p: string | null | undefined): boolean {
  return !!p && (p === DEMO_VAULT_ROOT || p.startsWith(`${DEMO_VAULT_ROOT}/`));
}

// A non-persisted switch that pins every reader to the bundled demo vault, regardless
// of the user's settings. The marketing pages turn it on so their real scene canvases
// read the bundled notes (and CSV) on web, without touching or persisting the setting.
// One switch so a page forces and clears the vault root + data folder together, and the
// demo vault's own folder layout stays in here rather than leaking into the page.
let _forced = false;

/** Pin every reader to the bundled demo vault (true), or clear the pin (false). */
export function forceDemoVault(on: boolean): void {
  _forced = on;
}

/** The vault root the Obsidian nodes read: the forced demo vault (the marketing pages),
 *  else the user's folder, else the bundled demo vault when the setting allows it
 *  (dte:D62 demoVaultResolution), else "" (the readers say to set the folder). One resolver
 *  so every reader agrees. */
export function getVaultRoot(): string {
  if (_forced) return DEMO_VAULT_ROOT;
  const own = settingsStore.get("obsidianVault").trim();
  if (own !== "") return own;
  return settingsStore.get("useDemoVault") ? DEMO_VAULT_ROOT : "";
}

/** The Local File data folder: the demo vault's Data folder when forced (the marketing
 *  pages), else the user's configured folder. */
export function getCsvFolder(): string {
  return _forced ? `${DEMO_VAULT_ROOT}/Data` : settingsStore.get("csvFolder");
}

// A path under the sentinel → its vault-relative POSIX key ("" for the root itself).
function relOf(path: string): string {
  if (path === DEMO_VAULT_ROOT) return "";
  return path.slice(DEMO_VAULT_ROOT.length + 1);
}

// One-time lazy load of the bundled files into a rel-path → content map. The dynamic
// import keeps demoVaultData's chunk out of the main bundle until the demo is used.
let _files: Map<string, string> | null = null;
let _loading: Promise<Map<string, string>> | null = null;
function ensureLoaded(): Promise<Map<string, string>> {
  if (_files) return Promise.resolve(_files);
  if (!_loading) {
    _loading = import("./demoVaultData").then((m) => {
      const map = new Map<string, string>();
      for (const [abs, content] of Object.entries(m.DEMO_VAULT_FILES)) {
        // Glob keys are like "../../demo-vault/Notes/Deep Work.md" — keep the tail.
        map.set(abs.replace(/^.*\/demo-vault\//, ""), content);
      }
      _files = map;
      return map;
    });
  }
  return _loading;
}

// The dev server (not vitest, not a build) reads the vault from disk on every call.
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

/** An in-memory FsProvider over the bundled demo vault. Only the reads the vault nodes
 *  make are meaningful; every write throws, and there are no binaries. */
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
