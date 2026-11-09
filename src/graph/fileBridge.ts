// [[C1]] demoVault, [[C103]] untrustedContentSeams
import { readTextFile, readDir, writeTextFile, rename, readFile, writeFile, mkdir, exists, stat } from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";
import { join, dirname, documentDir, homeDir } from "@tauri-apps/api/path";
import { requestConfirm } from "./confirmStore";
import { writtenElsewhere } from "./foreignCardStore";
import { demoVaultFs, isDemoVaultPath } from "./demoVault";
import { matchFiles } from "./fileGlob";
import { isTreePath, treeFs, treeLabel, pickTreeFolder } from "./androidFolders";

const JSON_FILTER = [{ name: "Solenoid graph", extensions: ["json"] }];
const HTML_FILTER = [{ name: "Web page", extensions: ["html"] }];
const CSV_FILTER = [{ name: "CSV", extensions: ["csv"] }];

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** The Tauri shell on an Android phone or tablet (`docs/android.md`): the files and network of the desktop app, a
 *  phone's chrome. Everything that is the app (fetching, reading and writing files) keys off `isDesktop()`; only a
 *  window's own frame and the operating system's pickers key off this. */
export function isAndroidApp(): boolean {
  return isDesktop() && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/** The folder Android documents live in: the documents folder setting when it is a granted folder, else one the user
 *  grants now (and it becomes the documents folder). Null when they back out. */
async function androidDocsFolder(): Promise<string | null> {
  const { settingsStore } = await import("./settingsStore");
  const docs = String(settingsStore.get("docsFolder") ?? "");
  if (isTreePath(docs)) return docs;
  const { pushNotice } = await import("./noticeStore");
  pushNotice("Choose the folder Solenoid keeps documents in. Android will remember it.", "info");
  const picked = await pickTreeFolder();
  if (picked) settingsStore.set("docsFolder", picked);
  return picked;
}

/** Why a granted folder can't be listed (the grant was revoked, or the folder moved), or undefined when it can. A
 *  refused listing would otherwise show as an empty picker. */
async function treeProblem(root: string): Promise<string | undefined> {
  try {
    await fs().readDir(root);
    return undefined;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return `Solenoid can't open this folder any more. Choose it again in Settings. (${why})`;
  }
}

/** Save As on Android: a folder inside the documents folder and a name, from the app's own picker. */
async function androidSaveAs(suggestedName: string, extension: string): Promise<string | null> {
  const root = await androidDocsFolder();
  if (!root) return null;
  const { chooseFile } = await import("./chooseFile");
  const rel = await chooseFile({
    title: "Save as",
    root,
    kind: "folder",
    current: "",
    rootLabel: treeLabel(root),
    list: () => listVaultFolders(root, 4),
    empty: "No folders here.",
    blocked: await treeProblem(root),
    recentKey: "android-save",
    save: { name: suggestedName.replace(/\.[^.]+$/, ""), extension },
  });
  if (!rel) return null;
  const path = await fs().join(root, ...rel.split("/"));
  if (await pathExists(path)) {
    const ok = await requestConfirm({ message: `${baseNameOf(rel)} already exists. Replace it?`, confirmLabel: "Replace" });
    if (!ok) return null;
  }
  return path;
}

/** Open on Android: a file inside the documents folder, from the app's own picker. */
async function androidOpenFile(title: string, extensions?: string[]): Promise<string | null> {
  const root = await androidDocsFolder();
  if (!root) return null;
  const { chooseFile } = await import("./chooseFile");
  const keep = extensions ? (n: string) => extensions.some((e) => n.toLowerCase().endsWith(`.${e}`)) : undefined;
  const rel = await chooseFile({
    title,
    root,
    kind: "file",
    extensions,
    rootLabel: treeLabel(root),
    list: () => listVaultFiles(root, 4, keep),
    readHead: (r, chars) => readFileHead(root, r, chars),
    empty: "No files here.",
    blocked: await treeProblem(root),
    recentKey: `android-open-${(extensions ?? ["any"]).join(",")}`,
  });
  return rel ? fs().join(root, ...rel.split("/")) : null;
}

/** A folder setting as a person reads it: a granted Android folder by its name on the phone, a path as it is. */
export function folderLabel(path: string): string {
  return isTreePath(path) ? treeLabel(path) : path;
}

export interface FsProvider {
  readTextFile(path: string): Promise<string>;
  /** At most the first `chars` characters, never the whole of a big file; a provider without it reads whole and cuts. */
  readTextHead?(path: string, chars: number): Promise<string>;
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
  /** Every path under `root`, `depth` folders deep, hidden names skipped: folders when `folders`, else files. A
   *  provider whose every call is a round trip (an Android granted folder) answers a whole walk in one. */
  walk?(root: string, depth: number, folders: boolean): Promise<string[]>;
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

/** Which files a path is: the demo vault's, an Android granted folder's, or the desktop's (or a test's provider). */
function providerFor(p: string): FsProvider {
  return isDemoVaultPath(p) ? demoVaultFs : isTreePath(p) ? treeFs : baseFs();
}

const fsDispatch: FsProvider = {
  readTextFile: (p) => providerFor(p).readTextFile(p),
  readTextHead: (p, chars) => {
    const f = providerFor(p);
    return f.readTextHead ? f.readTextHead(p, chars) : f.readTextFile(p).then((t) => t.slice(0, chars));
  },
  readDir: (p) => providerFor(p).readDir(p),
  writeTextFile: (p, c) => providerFor(p).writeTextFile(p, c),
  rename: (f, t) => (isDemoVaultPath(f) || isDemoVaultPath(t) ? demoVaultFs : providerFor(f)).rename(f, t),
  mkdir: (p, r) => providerFor(p).mkdir(p, r),
  exists: (p) => providerFor(p).exists(p),
  stat: (p) => providerFor(p).stat(p),
  join: (...parts) => providerFor(parts[0] ?? "").join(...parts),
  dirname: (p) => providerFor(p).dirname(p),
  readBinary: (p) => providerFor(p).readBinary(p),
  writeBinary: (p, b) => providerFor(p).writeBinary(p, b),
};

function fs(): FsProvider { return fsDispatch; }

function canReadRoot(root: string): boolean { return hasFs() || isDemoVaultPath(root); }

export async function pickFolderDialog(): Promise<string | null> {
  if (!isDesktop()) return null;
  // Android grants an app the folders the user picks in its own folder picker, and nothing else (docs/android.md).
  if (isAndroidApp()) return pickTreeFolder();
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

/** The CSV and Parquet files under the data folder a pattern names (`fileGlob.ts`), relative to it. */
export async function listLocalFilesMatching(folder: string, pattern: string): Promise<string[]> {
  if (!folder || !canReadRoot(folder)) return [];
  const readDir = async (rel: string) => fs().readDir(rel === "" ? folder : await fs().join(folder, ...rel.split("/")));
  return (await matchFiles(pattern, readDir)).filter((p) => /\.(csv|parquet)$/i.test(p));
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
  const walkAll = providerFor(root).walk;
  if (walkAll) {
    try { return (await walkAll(root, maxDepth, true)).sort((a, b) => a.localeCompare(b)); } catch { return []; }
  }
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
  const walkAll = providerFor(root).walk;
  if (walkAll) {
    try {
      return (await walkAll(root, maxDepth, false)).filter((p) => keep(p.slice(p.lastIndexOf("/") + 1))).sort((a, b) => a.localeCompare(b));
    } catch { return []; }
  }
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

/** The first `chars` characters of a vault file, for a preview: a big file is never read whole where its provider can
 *  read a head. */
export async function readVaultFileHead(root: string, relPath: string, chars: number): Promise<string> {
  if (!canReadRoot(root) || !isInsideVault(relPath)) throw new Error("outside the vault");
  return fs().readTextHead!(await fs().join(root, ...relPath.split("/")), chars);
}

/** The first `chars` characters of a file in `folder`, for a preview. */
export async function readFileHead(folder: string, name: string, chars: number): Promise<string> {
  return fs().readTextHead!(await fs().join(folder, ...name.split("/")), chars);
}

/** Needs the `fs:allow-stat` capability; null off desktop or when the platform omits a time. */
export async function statVaultFile(root: string, relPath: string): Promise<{ mtimeMs: number | null; birthtimeMs: number | null } | null> {
  if (!canReadRoot(root) || !isInsideVault(relPath)) return null;
  try {
    const path = await fs().join(root, ...relPath.split("/"));
    return await fs().stat(path);
  } catch {
    return null;
  }
}

/** Whether the vault holds the note, or null when this platform can't read the vault to tell. */
export async function vaultFileExists(root: string, relPath: string): Promise<boolean | null> {
  if (!canReadRoot(root) || !isInsideVault(relPath)) return null;
  try {
    return await fs().exists(await fs().join(root, ...relPath.split("/")));
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

/** The system's Documents folder (desktop), or `Documents` under the home folder where the system names none (a
 *  Linux without XDG user folders answers "unknown path"). */
export async function documentsDir(): Promise<string> {
  try {
    return await documentDir();
  } catch {
    return join(await homeDir(), "Documents");
  }
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
  return fs().readBinary(path);
}

export function writeBinaryFilePath(path: string, bytes: Uint8Array): Promise<void> {
  return fs().writeBinary(path, bytes);
}

export async function pickSaveFilePath(suggestedName: string, extensions: string[]): Promise<string | null> {
  if (!isDesktop()) return null;
  if (isAndroidApp()) return androidSaveAs(suggestedName, extensions[0] ?? "txt");
  const path = await save({ defaultPath: suggestedName, filters: [{ name: extensions.join("/").toUpperCase(), extensions }] });
  return typeof path === "string" ? path : null;
}

export async function pickSaveGraphPath(suggestedName: string): Promise<string | null> {
  if (!isDesktop()) return null;
  if (isAndroidApp()) return androidSaveAs(suggestedName, "json");
  const path = await save({ defaultPath: suggestedName, filters: JSON_FILTER });
  return typeof path === "string" ? path : null;
}

/** The chosen path; null on cancel, and always null in the browser, which downloads instead. */
export async function saveTextFileDialog(suggestedName: string, content: string): Promise<string | null> {
  if (isDesktop()) {
    const path = isAndroidApp() ? await androidSaveAs(suggestedName, "json") : await save({ defaultPath: suggestedName, filters: JSON_FILTER });
    if (!path) return null;
    await writeTextFileAtomic(path, content);
    return path;
  }
  downloadText(suggestedName, content);
  return null;
}

export async function saveCsvFileDialog(suggestedName: string, content: string): Promise<string | null> {
  if (isDesktop()) {
    const path = isAndroidApp() ? await androidSaveAs(suggestedName, "csv") : await save({ defaultPath: suggestedName, filters: CSV_FILTER });
    if (!path) return null;
    await writeTextFileAtomic(path, content);
    return path;
  }
  downloadText(suggestedName, content);
  return null;
}

export async function saveHtmlFileDialog(suggestedName: string, content: string): Promise<string | null> {
  if (isDesktop()) {
    const path = isAndroidApp() ? await androidSaveAs(suggestedName, "html") : await save({ defaultPath: suggestedName, filters: HTML_FILTER });
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
    const res = isAndroidApp() ? await androidOpenFile("Open a document", ["json"]) : await open({ multiple: false, directory: false, filters: JSON_FILTER });
    const path = typeof res === "string" ? res : null;
    if (!path) return null;
    return { path, content: await fs().readTextFile(path) };
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
  if (isAndroidApp()) return androidOpenFile("Choose a file to link");
  const res = await open({ multiple: false, directory: false, title: "Choose a file to link" });
  return typeof res === "string" ? res : null;
}

const EXECUTABLE_EXT = new Set([
  "exe", "bat", "cmd", "com", "msi", "ps1", "vbs", "js", "jse", "wsf", "scr", "lnk", "hta", "reg",
  "sh", "bash", "zsh", "desktop", "appimage", "run", "bin", "command", "app", "jar",
  "cpl", "pif", "msc", "url", "scf", "vbe", "wsh", "chm", "appref-ms", "library-ms", "settingcontent-ms", "xll",
  "py", "pyw", "pl", "rb", "ps1xml", "psm1", "msp", "gadget", "inf", "action", "workflow", "csh", "ksh",
]);

/** A path on another computer (`\\\\host\\share`, `//host/share`): opening one hands that computer the user's network login. */
export function isNetworkPath(path: string): boolean {
  return /^(\\\\|\/\/)[^\\/]/.test(path.trim());
}

export function isExecutablePath(path: string): boolean {
  const ext = baseNameOf(path).split(".").pop()?.toLowerCase() ?? "";
  return EXECUTABLE_EXT.has(ext);
}

/** Needs `opener:allow-open-path`; reveal-in-dir alone would not launch the file. */
/** `from` is the File Link: one pasted out of a shared document asks, as the shared document's own do. */
export async function openFilePath(path: string, from?: string): Promise<void> {
  if (!isDesktop() || !path) return;
  // The opener hands Android a file:// address, which Android refuses to share with another app (docs/android.md).
  if (isAndroidApp()) {
    const { pushNotice } = await import("./noticeStore");
    pushNotice("Opening a file in another app isn't available on Android yet.", "warn");
    return;
  }
  const runs = isExecutablePath(path), remote = isNetworkPath(path);
  if (runs || remote || writtenElsewhere(from)) {
    const why = runs ? "This link runs a program" : remote ? "This link opens a file on another computer" : "This link came with a shared document";
    const ok = await requestConfirm({ message: `${why}: ${remote ? path : baseNameOf(path)}. Open it?`, confirmLabel: "Open" });
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
