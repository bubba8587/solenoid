// Disk-file save/open — the primary file flow. On desktop these use native OS
// dialogs and write real .json files; in the browser they fall back to a download
// / file-input upload (no persistent path). The localStorage documents library
// (documentStore) stays the working store + crash-recovery + recents; a document
// can be bound to a disk path, and Save writes straight through to it.

import { serializeGraph, type SavedGraph } from "./persistence";
import { validateSavedGraph } from "./persistenceCore";
import { documentStore } from "./documentStore";
import {
  isDesktop,
  saveTextFileDialog,
  writeTextFilePath,
  openTextFileDialog,
  fileNameFromPath,
} from "./fileBridge";
import { pushNotice } from "./noticeStore";

function suggestedName(): string {
  const n = documentStore.currentName().trim() || "Untitled";
  return /\.json$/i.test(n) ? n : `${n}.json`;
}

/**
 * Save the current graph to disk. With an existing bound path and no forceDialog,
 * writes straight through (Ctrl+S on an already-saved file); otherwise shows a
 * Save dialog and binds the document to the chosen path. In the browser this
 * downloads a .json (no path to bind).
 */
export async function saveToDisk(opts: { forceDialog?: boolean } = {}): Promise<void> {
  documentStore.captureCurrent(); // freshen the localStorage copy first
  const g = serializeGraph();
  if (!g) return;
  const json = JSON.stringify(g, null, 2);
  const path = documentStore.currentFilePath();
  try {
    if (isDesktop() && path && !opts.forceDialog) {
      await writeTextFilePath(path, json);
      pushNotice(`Saved ${fileNameFromPath(path)}`, "info", 2500);
      return;
    }
    const chosen = await saveTextFileDialog(suggestedName(), json);
    if (chosen) {
      documentStore.bindCurrentToPath(chosen, fileNameFromPath(chosen));
      pushNotice(`Saved ${fileNameFromPath(chosen)}`, "info", 2500);
    }
    // browser: chosen is null (the file downloaded) — the browser's own download
    // UI is the confirmation, so no toast.
  } catch (e) {
    console.error("[solenoid] save failed", e);
    pushNotice("Couldn't save the file.", "error", 0);
  }
}

/** Open a graph from disk into a new document (bound to the file's path on desktop). */
export async function openFromDisk(): Promise<void> {
  let res: { path: string | null; content: string } | null;
  try {
    res = await openTextFileDialog();
  } catch (e) {
    console.error("[solenoid] open failed", e);
    pushNotice("Couldn't open the file picker.", "error", 0);
    return;
  }
  if (!res) return; // cancelled

  let graph: SavedGraph;
  try {
    graph = JSON.parse(res.content) as SavedGraph;
  } catch {
    pushNotice("That file isn't valid JSON — it can't be opened as a Solenoid graph.", "error", 0);
    return;
  }
  if (!validateSavedGraph(graph).ok) {
    pushNotice("That file isn't a valid Solenoid graph.", "error", 0);
    return;
  }
  const name = res.path ? fileNameFromPath(res.path) : "Imported";
  await documentStore.importAsDocument(graph, name, res.path ?? undefined);
}
