// Thin wrapper over Tauri's filesystem + dialog plugins, guarded so the browser
// dev build (no Tauri runtime) degrades gracefully instead of throwing. Local
// file connections only work in the desktop app; in the browser isDesktop() is
// false and every call here is a safe no-op, so the CSV-folder node can render a
// "desktop only" state rather than crash.
import { readTextFile, readDir, writeTextFile } from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";

const JSON_FILTER = [{ name: "Solenoid graph", extensions: ["json"] }];

/** True only inside the Tauri desktop shell (the fs/dialog plugins are live). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Open the OS folder picker; returns the chosen absolute path, or null if the
 *  user cancelled (or we're not on desktop). */
export async function pickFolderDialog(): Promise<string | null> {
  if (!isDesktop()) return null;
  const res = await open({ directory: true, multiple: false, title: "Choose a data folder" });
  return typeof res === "string" ? res : null;
}

/** List the file names directly inside `folder` matching `extension` (sorted,
 *  case-insensitive) — the shared listing behind every folder-scoped file-source
 *  node (CSV, Parquet, …). */
async function listFilesByExt(folder: string, extension: string): Promise<string[]> {
  if (!isDesktop() || !folder) return [];
  const entries = await readDir(folder);
  const re = new RegExp(`\\.${extension}$`, "i");
  return entries
    .filter((e) => e.isFile && re.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/** List the `.csv` file names directly inside `folder`. */
export function listCsvFiles(folder: string): Promise<string[]> {
  return listFilesByExt(folder, "csv");
}

/** List the `.parquet` file names directly inside `folder`. */
export function listParquetFiles(folder: string): Promise<string[]> {
  return listFilesByExt(folder, "parquet");
}

/** Read one file (by name) from the target folder as text. */
export async function readFileText(folder: string, name: string): Promise<string> {
  const path = await join(folder, name);
  return readTextFile(path);
}

// ─── Graph file save / open ───────────────────────────────────────────────────
// Desktop uses native dialogs + real file writes; the browser falls back to a
// blob download / file-input upload (no persistent path). Each returns the chosen
// absolute path on desktop (so the doc can be bound to it), or null in the browser.

/** Write `content` to `path` (desktop only — call only when isDesktop()). */
export async function writeTextFilePath(path: string, content: string): Promise<void> {
  await writeTextFile(path, content);
}

/** Show a Save dialog and write the file. Returns the chosen path, or null if the
 *  user cancelled. In the browser, downloads `suggestedName` and returns null. */
export async function saveTextFileDialog(suggestedName: string, content: string): Promise<string | null> {
  if (isDesktop()) {
    const path = await save({ defaultPath: suggestedName, filters: JSON_FILTER });
    if (!path) return null;
    await writeTextFile(path, content);
    return path;
  }
  downloadText(suggestedName, content);
  return null;
}

/** Show an Open dialog and read the file. Returns its path + text, or null if the
 *  user cancelled. In the browser, uses a file input (path is null). */
export async function openTextFileDialog(): Promise<{ path: string | null; content: string } | null> {
  if (isDesktop()) {
    const res = await open({ multiple: false, directory: false, filters: JSON_FILTER });
    const path = typeof res === "string" ? res : null;
    if (!path) return null;
    return { path, content: await readTextFile(path) };
  }
  return openTextFileBrowser();
}

/** Trigger a browser download of `content` as `name`. */
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

/** Browser file-input read, as a promise. Resolves null if the user cancels (the
 *  dialog refocuses the window without firing change). */
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

/** The file name (no directory, no .json extension) of an absolute path — the
 *  document's display name after a Save As / Open. */
export function fileNameFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.json$/i, "");
}

/** Open a URL in the user's browser. Desktop uses the Tauri opener (a bare
 *  target=_blank is blocked in the webview); the browser build falls back to
 *  window.open. */
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
