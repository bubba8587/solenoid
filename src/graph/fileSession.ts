// [[C36]] captureBeforeSwap, [[C32]] autosaveSlotOrder
// Disk save and open. The documentStore library stays the working store; a document bound to a path saves through to it.

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

// A save belongs to the document current when it began; a switch during one of its awaits abandons it rather than writing the other document.
export async function saveToDisk(opts: { forceDialog?: boolean } = {}): Promise<void> {
  const docId = documentStore.currentId();
  if (!docId) return;
  const stillCurrent = (): boolean => {
    if (documentStore.currentId() === docId) return true;
    pushNotice("You switched documents before the save finished, so nothing was saved.", "warn");
    return false;
  };
  documentStore.captureCurrent();
  try {
    if (isDesktop()) {
      // Resolve the destination first: bundling images stamps assetPaths that the JSON serialized afterwards must carry.
      let path = documentStore.currentFilePath();
      let fresh = false;
      if (!path || opts.forceDialog) {
        path = await pickSaveGraphPath(suggestedName());
        if (!path) return;
        if (!stillCurrent()) return;
        fresh = true;
      }
      const { failed } = await bundleLocalImages(path);
      if (!stillCurrent()) return;
      const g = serializeGraph();
      if (!g) return;
      // One instant for the file bytes and the library clock, so a round trip through another machine reads the same stamp.
      const at = Date.now();
      g.savedAt = at;
      await writeTextFilePath(path, JSON.stringify(g, null, 2));
      if (fresh) documentStore.bindToPath(docId, path, fileNameFromPath(path));
      if (documentStore.currentId() === docId) documentStore.captureCurrent(); // the localStorage copy carries assetPaths too
      documentStore.markFileSaved(docId, at);
      pushNotice(`Saved ${fileNameFromPath(path)}`, "info", 2500);
      if (failed > 0) {
        pushNotice(`${failed} image${failed === 1 ? "" : "s"} couldn't be written to the images folder.`, "warn");
      }
      return;
    }
    const g = serializeGraph();
    if (!g) return;
    const at = Date.now();
    g.savedAt = at;
    await saveTextFileDialog(suggestedName(), JSON.stringify(g, null, 2));
    documentStore.markFileSaved(docId, at);
  } catch (e) {
    console.error("[solenoid] save failed", e);
    pushNotice("Couldn't save the file.", "error", 0);
  }
}

export async function openFromDisk(): Promise<void> {
  let res: { path: string | null; content: string } | null;
  try {
    res = await openTextFileDialog();
  } catch (e) {
    console.error("[solenoid] open failed", e);
    pushNotice("Couldn't open the file picker.", "error", 0);
    return;
  }
  if (!res) return;

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
