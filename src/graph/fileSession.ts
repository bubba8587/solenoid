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

export async function saveToDisk(opts: { forceDialog?: boolean } = {}): Promise<void> {
  documentStore.captureCurrent();
  try {
    if (isDesktop()) {
      // Resolve the destination first: bundling images stamps assetPaths that the JSON serialized afterwards must carry.
      let path = documentStore.currentFilePath();
      let fresh = false;
      if (!path || opts.forceDialog) {
        path = await pickSaveGraphPath(suggestedName());
        if (!path) return;
        fresh = true;
      }
      const { failed } = await bundleLocalImages(path);
      const g = serializeGraph();
      if (!g) return;
      // One instant for the file bytes and the library clock, so a round trip through another machine reads the same stamp.
      const at = Date.now();
      g.savedAt = at;
      await writeTextFilePath(path, JSON.stringify(g, null, 2));
      if (fresh) documentStore.bindCurrentToPath(path, fileNameFromPath(path));
      documentStore.captureCurrent(); // the localStorage copy carries assetPaths too
      documentStore.markCurrentFileSaved(at);
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
    documentStore.markCurrentFileSaved(at);
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
