// Thin wrapper over Tauri's fs + dialog plugins. In the browser (no Tauri runtime)
// every call is a guarded no-op rather than a throw.
import { readTextFile, readDir, writeTextFile, rename, readFile, writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";
import { join, dirname } from "@tauri-apps/api/path";

const JSON_FILTER = [{ name: "Solenoid graph", extensions: ["json"] }];
const HTML_FILTER = [{ name: "Web page", extensions: ["html"] }];
const CSV_FILTER = [{ name: "CSV", extensions: ["csv"] }];

/** True only inside the Tauri desktop shell (the fs/dialog plugins are live). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Open the OS folder picker; returns the chosen absolute path, or null if the
 *  user canceled (or we're not on desktop). */
export async function pickFolderDialog(): Promise<string | null> {
  if (!isDesktop()) return null;
  const res = await open({ directory: true, multiple: false, title: "Choose a data folder" });
  return typeof res === "string" ? res : null;
}

/** File names directly inside `folder` matching any of `extensions` (sorted, case-insensitive). */
async function listFilesByExt(folder: string, extensions: string | string[]): Promise<string[]> {
  if (!isDesktop() || !folder) return [];
  const entries = await readDir(folder);
  const re = new RegExp(`\\.(${(Array.isArray(extensions) ? extensions : [extensions]).join("|")})$`, "i");
  return entries
    .filter((e) => e.isFile && re.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/** List the `.csv` + `.parquet` file names directly inside `folder` — the Local File node
 *  reads either, picking the reader by extension. */
export function listLocalFiles(folder: string): Promise<string[]> {
  return listFilesByExt(folder, ["csv", "parquet"]);
}

/** Read one file (by name) from the target folder as text. */
export async function readFileText(folder: string, name: string): Promise<string> {
  const path = await join(folder, name);
  return readTextFile(path);
}

/** List the `.md` file names directly inside `folder` (a vault subfolder). */
export function listMarkdownFiles(folder: string): Promise<string[]> {
  return listFilesByExt(folder, "md");
}

/** Vault-relative subfolder paths under `root` (POSIX-style, sorted), EXCLUDING the
 *  root itself; dot-folders skipped and depth bounded. Desktop only. */
export async function listVaultFolders(root: string, maxDepth = 6): Promise<string[]> {
  if (!isDesktop() || !root) return [];
  const out: string[] = [];
  async function walk(abs: string, rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readDir(abs); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory || e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      out.push(childRel);
      await walk(await join(abs, e.name), childRel, depth + 1);
    }
  }
  await walk(root, "", 0);
  return out.sort((a, b) => a.localeCompare(b));
}

/** Recursively collect the vault-relative `.md` file paths under `root` (POSIX-style,
 *  sorted). Same dot-folder skip + depth bound as listVaultFolders. Desktop only. */
export async function listVaultMarkdownFiles(root: string, maxDepth = 6): Promise<string[]> {
  if (!isDesktop() || !root) return [];
  const out: string[] = [];
  async function walk(abs: string, rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readDir(abs); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) await walk(await join(abs, e.name), childRel, depth + 1);
      else if (/\.md$/i.test(e.name)) out.push(childRel);
    }
  }
  await walk(root, "", 0);
  return out.sort((a, b) => a.localeCompare(b));
}

/** Read a vault-relative file ("notes/weekly.md") as text. Desktop only. */
export async function readVaultFile(root: string, relPath: string): Promise<string> {
  const path = await join(root, ...relPath.split("/"));
  return readTextFile(path);
}

/** Temp + rename so a crash mid-write can't destroy the previous good file; falls
 *  back to a direct write when the `.tmp` sibling is outside the granted fs scope. */
async function writeTextFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  try {
    await writeTextFile(tmp, content);
    await rename(tmp, path);
  } catch {
    await writeTextFile(path, content);
  }
}

/** Write `content` to `path` (desktop only — call only when isDesktop()). */
export async function writeTextFilePath(path: string, content: string): Promise<void> {
  await writeTextFileAtomic(path, content);
}

export function dirOfPath(path: string): Promise<string> {
  return dirname(path);
}

export function joinPath(...parts: string[]): Promise<string> {
  return join(...parts);
}

export async function pathExists(path: string): Promise<boolean> {
  return exists(path);
}

/** Create a directory (no-op if it already exists). */
export async function ensureDir(path: string): Promise<void> {
  if (!(await exists(path))) await mkdir(path, { recursive: true });
}

export function readBinaryFilePath(path: string): Promise<Uint8Array> {
  return readFile(path);
}

export function writeBinaryFilePath(path: string, bytes: Uint8Array): Promise<void> {
  return writeFile(path, bytes);
}

/** Choose a path WITHOUT writing anything; null on cancel and in the browser. */
export async function pickSaveFilePath(suggestedName: string, extensions: string[]): Promise<string | null> {
  if (!isDesktop()) return null;
  const path = await save({ defaultPath: suggestedName, filters: [{ name: extensions.join("/").toUpperCase(), extensions }] });
  return typeof path === "string" ? path : null;
}

/** Pick a graph save path WITHOUT writing — image assets must bundle into the
 *  destination folder before the JSON that references them is written. */
export async function pickSaveGraphPath(suggestedName: string): Promise<string | null> {
  if (!isDesktop()) return null;
  const path = await save({ defaultPath: suggestedName, filters: JSON_FILTER });
  return typeof path === "string" ? path : null;
}

/** Show a Save dialog and write the file. Returns the chosen path, or null if the
 *  user canceled. In the browser, downloads `suggestedName` and returns null. */
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

/** saveTextFileDialog with the CSV file-type filter. */
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

/** saveTextFileDialog with the HTML filter + download mime type. */
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

/** Show an Open dialog and read the file. Returns its path + text, or null if the
 *  user canceled. In the browser, uses a file input (path is null). */
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

/** Browser file-input read; resolves null on cancel, detected via the refocus (the
 *  dialog fires no change event). */
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

/** The file name of an absolute path, without directory or .json extension. */
export function fileNameFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.json$/i, "");
}

/** Open a URL externally — desktop needs the Tauri opener, since a bare
 *  target=_blank is blocked in the webview. */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // fall through to the browser path
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Open the OS file manager at `path` (desktop only). revealItemInDir is covered by
 *  the granted `opener:default` capability; openPath would need extra fs scope. */
export async function openInFileManager(path: string): Promise<void> {
  if (!isDesktop() || !path) return;
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  } catch {
    // best-effort — nothing to fall back to on desktop
  }
}

/** Pick ANY file and return its absolute path — the File Link node stores the path,
 *  not the bytes. Null on cancel and in the browser. Desktop only. */
export async function pickFileLinkDialog(): Promise<string | null> {
  if (!isDesktop()) return null;
  const res = await open({ multiple: false, directory: false, title: "Choose a file to link" });
  return typeof res === "string" ? res : null;
}

/** Open a file in its OS default app (desktop only). Needs `opener:allow-open-path`
 *  in the capability set — reveal-in-dir alone wouldn't launch the file. */
export async function openFilePath(path: string): Promise<void> {
  if (!isDesktop() || !path) return;
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(path);
  } catch {
    // best-effort — a missing/moved file just does nothing
  }
}

/** The base name of an absolute path, extension KEPT (unlike fileNameFromPath, which
 *  is graph-save specific and strips `.json`). Works for both `/` and `\` separators. */
export function baseNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}
