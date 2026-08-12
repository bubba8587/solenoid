// Disk save/open: native dialogs on desktop, download / file-input in the browser. The
// documentStore library stays the working store; a doc bound to a path saves through to it.

import { serializeGraph, type SavedGraph } from "./persistence";
import { validateSavedGraph } from "./persistenceCore";
import { documentStore } from "./documentStore";
import {
  isDesktop,
  saveTextFileDialog,
  writeTextFilePath,
  openTextFileDialog,
  fileNameFromPath,
  pickSaveGraphPath,
} from "./fileBridge";
import { bundleLocalImages } from "./imageAssets";
import { pushNotice } from "./noticeStore";

function suggestedName(): string {
  const n = documentStore.currentName().trim() || "Untitled";
  return /\.json$/i.test(n) ? n : `${n}.json`;
}

/** Writes straight through when a path is bound and forceDialog is off; otherwise prompts
 *  and binds the document to the chosen path. */
export async function saveToDisk(opts: { forceDialog?: boolean } = {}): Promise<void> {
  documentStore.captureCurrent(); // freshen the localStorage copy first
  try {
    if (isDesktop()) {
      // Resolve the destination FIRST — bundling images stamps assetPaths that the JSON
      // serialized afterwards must carry.
      let path = documentStore.currentFilePath();
      let fresh = false;
      if (!path || opts.forceDialog) {
        path = await pickSaveGraphPath(suggestedName());
        if (!path) return; // canceled
        fresh = true;
      }
      const { failed } = await bundleLocalImages(path);
      const g = serializeGraph();
      if (!g) return;
      await writeTextFilePath(path, JSON.stringify(g, null, 2));
      if (fresh) documentStore.bindCurrentToPath(path, fileNameFromPath(path));
      documentStore.captureCurrent(); // the localStorage copy carries assetPaths too
      pushNotice(`Saved ${fileNameFromPath(path)}`, "info", 2500);
      if (failed > 0) {
        pushNotice(`${failed} image${failed === 1 ? "" : "s"} couldn't be written to the images folder.`, "warn");
      }
      return;
    }
    // No filesystem to bundle into; the browser's own download UI is the confirmation.
    const g = serializeGraph();
    if (!g) return;
    await saveTextFileDialog(suggestedName(), JSON.stringify(g, null, 2));
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
  if (!res) return; // canceled

  let graph: SavedGraph;
  try {
    graph = JSON.parse(res.content) as SavedGraph;
  } catch {
    pushNotice("That file isn't valid JSON, so it can't be opened as a Solenoid graph.", "error", 0);
    return;
  }
  if (!validateSavedGraph(graph).ok) {
    pushNotice("That file isn't a valid Solenoid graph.", "error", 0);
    return;
  }
  const name = res.path ? fileNameFromPath(res.path) : "Imported";
  await documentStore.importAsDocument(graph, name, res.path ?? undefined);
}
