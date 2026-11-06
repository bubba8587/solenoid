// [[C132]] workspaceTree, [[workspace-tree#Where the tree comes from]]
// On the desktop every document that isn't an example is a file under the Documents folder, and autosave writes
// through to it. The library stays the working store; this keeps each entry's file caught up with it.
import { documentStore } from "./documentStore";
import { settingsStore } from "./settingsStore";
import { isDesktop, isAndroidApp, ensureDir, pathExists, joinPath, writeTextFilePath, documentsDir } from "./fileBridge";
import { pushNotice } from "./noticeStore";

/** Desktop only: Android keeps documents in a folder the user granted, by its own rules. */
const diskBacked = (): boolean => isDesktop() && !isAndroidApp();

const DELAY = 800;

/** The Documents folder setting, or `Documents/Solenoid` under the home folder, then kept as the setting. */
async function root(): Promise<string> {
  const set = String(settingsStore.get("docsFolder") ?? "").trim();
  if (set) return set;
  const fallback = await joinPath(await documentsDir(), "Solenoid");
  settingsStore.set("docsFolder", fallback);
  return fallback;
}

/** A name a file can carry on every system: no separators or reserved characters, no leading dot (the desktop's file
 *  scope refuses hidden names), no trailing dot or space (Windows drops them), no Windows device name, never empty. */
export function fileStem(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/\.json$/i, "")
    .replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (!s) return "Untitled";
  return /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i.test(s) ? `${s} doc` : s;
}

/** Paths handed out this session, so two documents named alike never pick the same free name in one pass. */
const claimed = new Set<string>();

/** `<root>/<folder>/<name>.json`, numbered past a name already taken (`Untitled 2.json`); the folder is created. */
async function freshPath(folder: string, name: string): Promise<string> {
  const dir = await joinPath(await root(), ...folder.split("/").map((p) => p.trim()).filter(Boolean).map(fileStem));
  await ensureDir(dir);
  const stem = fileStem(name);
  for (let k = 1; ; k++) {
    const path = await joinPath(dir, `${k === 1 ? stem : `${stem} ${k}`}.json`);
    if (!claimed.has(path) && !(await pathExists(path))) {
      claimed.add(path);
      return path;
    }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;
const failed = new Set<string>();

/** One pass: each kept document without a file gets one, and each whose library copy is newer than its file is
 *  written. A document changed during its write is newer than the copy written and goes next pass. */
export async function syncFiles(): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  try {
    for (const d of documentStore.fileWork()) {
      if (d.filePath && d.updatedAt <= (d.fileSavedAt ?? 0)) continue;
      let fresh: string | undefined;
      try {
        if (!d.filePath) fresh = await freshPath(d.folder, d.name);
        const path = d.filePath ?? fresh!;
        await writeTextFilePath(path, JSON.stringify({ ...d.graph, savedAt: Date.now() }, null, 2));
        if (fresh) documentStore.bindToPath(d.id, fresh);
        // Saved as of the copy written: an edit made while the pass awaited is newer and goes next pass.
        documentStore.markFileSaved(d.id, d.updatedAt);
        failed.delete(d.id);
      } catch (e) {
        // A name claimed for a file that was never written is free again, so the retry takes it.
        if (fresh) claimed.delete(fresh);
        if (!failed.has(d.id)) pushNotice(`Couldn't write “${d.name}” to its file: ${e instanceof Error ? e.message : String(e)}`, "error", 0);
        failed.add(d.id);
      }
    }
  } finally {
    running = false;
    if (again) { again = false; schedule(); }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncFiles(); }, DELAY);
}

let started = false;

/** Starts keeping files after the library restores: a pass now (a launch after a quit mid-write catches up), then
 *  one after each burst of library changes. */
export function startDesktopDocs(): void {
  if (started || !diskBacked()) return;
  started = true;
  documentStore.subscribe(schedule);
  schedule();
}
