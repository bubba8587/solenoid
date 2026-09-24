// [[C1]] demoVault, [[C103]] untrustedContentSeams
import { readTextFile, readDir, writeTextFile, rename, readFile, writeFile, mkdir, exists, stat } from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";
import { join, dirname } from "@tauri-apps/api/path";
import { requestConfirm } from "./confirmStore";
import { docMetaStore } from "./docMetaStore";
import { demoVaultFs, isDemoVaultPath } from "./demoVault";

const JSON_FILTER = [{ name: "Solenoid graph", extensions: ["json"] }];
const HTML_FILTER = [{ name: "Web page", extensions: ["html"] }];
const CSV_FILTER = [{ name: "CSV", extensions: ["csv"] }];

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}


export interface FsProvider {
  readTextFile(path: string): Promise<string>;
  readDir(path: string): Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]>;
  writeTextFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, recursive: boolean): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ mtimeMs: number | null; birthtimeMs: number | null }>;
  join(...parts: string[]): Promise<string>;
  dirname(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, bytes: Uint8Array): Promise<void>;
}

let _provider: FsProvider | null = null;

export function setFsProvider(p: FsProvider | null): void { _provider = p; }

export function hasFs(): boolean { return isDesktop() || _provider !== null; }

const tauriFs: FsProvider = {
  readTextFile: (path) => readTextFile(path),
  readDir: async (path) => (await readDir(path)).map((e) => ({ name: e.name, isDirectory: e.isDirectory, isFile: e.isFile })),
  writeTextFile: (path, content) => writeTextFile(path, content),
  rename: (from, to) => rename(from, to),
  mkdir: (path, recursive) => mkdir(path, { recursive }),
  exists: (path) => exists(path),
  stat: async (path) => { const i = await stat(path); return { mtimeMs: i.mtime ? i.mtime.getTime() : null, birthtimeMs: i.birthtime ? i.birthtime.getTime() : null }; },
  join: (...parts) => join(...parts),
  dirname: (path) => dirname(path),
  readBinary: (path) => readFile(path),
  writeBinary: (path, bytes) => writeFile(path, bytes),
};

function baseFs(): FsProvider { return _provider ?? tauriFs; }

const fsDispatch: FsProvider = {
  readTextFile: (p) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).readTextFile(p),
  readDir: (p) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).readDir(p),
  writeTextFile: (p, c) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).writeTextFile(p, c),
  rename: (f, t) => (isDemoVaultPath(f) || isDemoVaultPath(t) ? demoVaultFs : baseFs()).rename(f, t),
  mkdir: (p, r) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).mkdir(p, r),
  exists: (p) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).exists(p),
  stat: (p) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).stat(p),
  join: (...parts) => (isDemoVaultPath(parts[0]) ? demoVaultFs : baseFs()).join(...parts),
  dirname: (p) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).dirname(p),
  readBinary: (p) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).readBinary(p),
  writeBinary: (p, b) => (isDemoVaultPath(p) ? demoVaultFs : baseFs()).writeBinary(p, b),
};

function fs(): FsProvider { return fsDispatch; }

function canReadRoot(root: string): boolean { return hasFs() || isDemoVaultPath(root); }

export async function pickFolderDialog(): Promise<string | null> {
  if (!isDesktop()) return null;
  const res = await open({ directory: true, multiple: false, title: "Choose a data folder" });
  return typeof res === "string" ? res : null;
}

async function listFilesByExt(folder: string, extensions: string | string[]): Promise<string[]> {
  if (!folder || (!isDesktop() && !isDemoVaultPath(folder))) return [];
  const entries = await fs().readDir(folder);
  const re = new RegExp(`\\.(${(Array.isArray(extensions) ? extensions : [extensions]).join("|")})$`, "i");
  return entries
    .filter((e) => e.isFile && re.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

export function listLocalFiles(folder: string): Promise<string[]> {
  return listFilesByExt(folder, ["csv", "parquet"]);
}

export async function readFileText(folder: string, name: string): Promise<string> {
  const path = await fs().join(folder, name);
  return fs().readTextFile(path);
}

export function listMarkdownFiles(folder: string): Promise<string[]> {
  return listFilesByExt(folder, "md");
}

export async function listVaultFolders(root: string, maxDepth = 6): Promise<string[]> {
  if (!root || !canReadRoot(root)) return [];
  const out: string[] = [];
  async function walk(abs: string, rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await fs().readDir(abs); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory || e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      out.push(childRel);
      await walk(await fs().join(abs, e.name), childRel, depth + 1);
    }
  }
  await walk(root, "", 0);
  return out.sort((a, b) => a.localeCompare(b));
}

export function listVaultMarkdownFiles(root: string, maxDepth = 6): Promise<string[]> {
  return listVaultFiles(root, maxDepth, (name) => /\.md$/i.test(name));
}

/** Vault-relative paths, hidden entries skipped. */
export async function listVaultFiles(root: string, maxDepth = 6, keep: (name: string) => boolean = () => true): Promise<string[]> {
  if (!root || !canReadRoot(root)) return [];
  const out: string[] = [];
  async function walk(abs: string, rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await fs().readDir(abs); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) await walk(await fs().join(abs, e.name), childRel, depth + 1);
      else if (keep(e.name)) out.push(childRel);
    }
  }
  await walk(root, "", 0);
  return out.sort((a, b) => a.localeCompare(b));
}

/** A saved document can carry any string here, so this is the vault-escape guard. */
export function isInsideVault(relPath: string): boolean {
  if (relPath === "" || /^[\\/]/.test(relPath) || /^[A-Za-z]:/.test(relPath)) return false;
  return relPath.split(/[\\/]/).every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

export async function readVaultFile(root: string, relPath: string): Promise<string> {
  if (!isInsideVault(relPath)) throw new Error(`"${relPath}" is not inside the vault`);
  const path = await fs().join(root, ...relPath.split("/"));
  return fs().readTextFile(path);
}

/** Needs the `fs:allow-stat` capability; null off desktop or when the platform omits a time. */
export async function statVaultFile(root: string, relPath: string): Promise<{ mtimeMs: number | null; birthtimeMs: number | null } | null> {
  if (!canReadRoot(root)) return null;
  try {
    const path = await fs().join(root, ...relPath.split("/"));
    return await fs().stat(path);
  } catch {
    return null;
  }
}

export async function readTextFilePath(path: string): Promise<string> {
  return fs().readTextFile(path);
}

async function writeTextFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  try {
    await fs().writeTextFile(tmp, content);
    await fs().rename(tmp, path);
  } catch {
    await fs().writeTextFile(path, content);
  }
}

export async function writeTextFilePath(path: string, content: string): Promise<void> {
  await writeTextFileAtomic(path, content);
}

export function dirOfPath(path: string): Promise<string> {
  return fs().dirname(path);
}

export function joinPath(...parts: string[]): Promise<string> {
  return fs().join(...parts);
}

export async function pathExists(path: string): Promise<boolean> {
  try { return await fs().exists(path); } catch { return false; }
}

export async function ensureDir(path: string): Promise<void> {
  if (!(await pathExists(path))) await fs().mkdir(path, true);
}

export function readBinaryFilePath(path: string): Promise<Uint8Array> {
  if (_provider) return _provider.readBinary(path);
  return readFile(path);
}

export function writeBinaryFilePath(path: string, bytes: Uint8Array): Promise<void> {
  if (_provider) return _provider.writeBinary(path, bytes);
  return writeFile(path, bytes);
}

export async function pickSaveFilePath(suggestedName: string, extensions: string[]): Promise<string | null> {
  if (!isDesktop()) return null;
  const path = await save({ defaultPath: suggestedName, filters: [{ name: extensions.join("/").toUpperCase(), extensions }] });
  return typeof path === "string" ? path : null;
}

export async function pickSaveGraphPath(suggestedName: string): Promise<string | null> {
  if (!isDesktop()) return null;
  const path = await save({ defaultPath: suggestedName, filters: JSON_FILTER });
  return typeof path === "string" ? path : null;
}

/** The chosen path; null on cancel, and always null in the browser, which downloads instead. */
export async function saveTextFileDialog(suggestedName: string, content: string): Promise<string | null> {
  if (isDesktop()) {
    const path = await save({ defaultPath: suggestedName, filters: JSON_FILTER });
    if (!path) return null;
    await writeTextFileAtomic(path, content);
    return path;
  }
  downloadText(suggestedName, content);
  return null;
}

export async function saveCsvFileDialog(suggestedName: string, content: string): Promise<string | null> {
  if (isDesktop()) {
    const path = await save({ defaultPath: suggestedName, filters: CSV_FILTER });
    if (!path) return null;
    await writeTextFileAtomic(path, content);
    return path;
  }
  downloadText(suggestedName, content);
  return null;
}

export async function saveHtmlFileDialog(suggestedName: string, content: string): Promise<string | null> {
  if (isDesktop()) {
    const path = await save({ defaultPath: suggestedName, filters: HTML_FILTER });
    if (!path) return null;
    await writeTextFileAtomic(path, content);
    return path;
  }
  downloadHtml(suggestedName, content);
  return null;
}

function downloadHtml(name: string, content: string): void {
  const blob = new Blob([content], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function openTextFileDialog(): Promise<{ path: string | null; content: string } | null> {
  if (isDesktop()) {
    const res = await open({ multiple: false, directory: false, filters: JSON_FILTER });
    const path = typeof res === "string" ? res : null;
    if (!path) return null;
    return { path, content: await readTextFile(path) };
  }
  return openTextFileBrowser();
}

function downloadText(name: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// The file dialog fires no event on cancel, so a refocus with no change resolves null.
function openTextFileBrowser(): Promise<{ path: null; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    let done = false;
    input.onchange = async () => {
      done = true;
      const file = input.files?.[0];
      resolve(file ? { path: null, content: await file.text() } : null);
    };
    window.addEventListener(
      "focus",
      () => setTimeout(() => { if (!done) resolve(null); }, 300),
      { once: true },
    );
    input.click();
  });
}

export function fileNameFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.json$/i, "");
}

/** Desktop needs the Tauri opener, because the webview blocks a bare target=_blank. */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** revealItemInDir is covered by `opener:default`; openPath would need extra fs scope. */
export async function openInFileManager(path: string): Promise<void> {
  if (!isDesktop() || !path) return;
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  } catch {
  }
}

export async function pickFileLinkDialog(): Promise<string | null> {
  if (!isDesktop()) return null;
  const res = await open({ multiple: false, directory: false, title: "Choose a file to link" });
  return typeof res === "string" ? res : null;
}

const EXECUTABLE_EXT = new Set(["exe", "bat", "cmd", "com", "msi", "ps1", "vbs", "js", "jse", "wsf", "scr", "lnk", "hta", "reg"]);

export function isExecutablePath(path: string): boolean {
  const ext = baseNameOf(path).split(".").pop()?.toLowerCase() ?? "";
  return EXECUTABLE_EXT.has(ext);
}

/** Needs `opener:allow-open-path`; reveal-in-dir alone would not launch the file. */
export async function openFilePath(path: string): Promise<void> {
  if (!isDesktop() || !path) return;
  if (isExecutablePath(path) || docMetaStore.isForeign()) {
    const ok = await requestConfirm({
      message: isExecutablePath(path) ? "This link runs a program. Open it?" : "This link came with a shared document. Open it?",
      confirmLabel: "Open",
    });
    if (!ok) return;
  }
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(path);
  } catch {
  }
}

export function baseNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}
