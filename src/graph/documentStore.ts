// The documents library: the app's "file system". Multiple named graphs live in
// localStorage; one is current and shown on the canvas. Autosave writes the live
// graph into the current document; New / Open / Save As / Rename / Duplicate /
// Delete manage the set. Seeds are templates (New from template) rather than the
// working document, which closes the old seed↔autosave conflation.
//
// Pure library transforms live in documentStoreCore.ts (unit-tested). This file
// adds: the in-memory library + notifier, two-slot localStorage persistence
// (reusing the crash-safety from persistenceCore), one-time migration of the
// pre-documents single autosave, and the editor wiring (loadGraph / serializeGraph).

import { createNotifier } from "./storeKit";
import { serializeGraph, loadGraph, type SavedGraph } from "./persistence";
import { loadRevealStore } from "./loadReveal";
import { chooseWriteSlot, chooseReadSlot } from "./persistenceCore";
import { pushNotice, dismissNotice } from "./noticeStore";
import { SEEDS, DEFAULT_SEED_ID, type SeedId } from "./seeds";
import {
  emptyLibrary,
  getCurrent,
  uniqueName,
  addDocument,
  renameDocument,
  setCurrent,
  setDocPath,
  updateCurrentGraph,
  removeDocument,
  duplicateDocument,
  validateLibrary,
  type DocLibrary,
  type SolDoc,
} from "./documentStoreCore";

const LIB_SLOT_A = "solenoid.docs.lib.a";
const LIB_SLOT_B = "solenoid.docs.lib.b";

const EMPTY_GRAPH: SavedGraph = { v: 2, nodes: [], connections: [] };

interface LibSlot { seq: number; lib: DocLibrary }

const { notify, subscribe, version } = createNotifier();
let _lib: DocLibrary = emptyLibrary();
let _saveFailNoticeId: number | null = null;

function newId(): string {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── localStorage (two rotating slots, like the old autosave) ─────────────────

function readSlotSeq(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<LibSlot>;
    return typeof o?.seq === "number" ? o.seq : null;
  } catch {
    return null;
  }
}

function readSlotLib(key: string): DocLibrary | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<LibSlot>;
    return o?.lib ? validateLibrary(o.lib) : null;
  } catch {
    return null;
  }
}

/** Persist the in-memory library to the older slot; surface a sticky notice if
 *  storage rejects it (and clear that notice once a write next succeeds). */
function persist(): void {
  const slot = chooseWriteSlot(readSlotSeq(LIB_SLOT_A), readSlotSeq(LIB_SLOT_B));
  const key = slot === "a" ? LIB_SLOT_A : LIB_SLOT_B;
  let ok = false;
  try {
    localStorage.setItem(key, JSON.stringify({ seq: Date.now(), lib: _lib } satisfies LibSlot));
    ok = true;
  } catch {
    ok = false;
  }
  if (ok) {
    if (_saveFailNoticeId !== null) { dismissNotice(_saveFailNoticeId); _saveFailNoticeId = null; }
  } else if (_saveFailNoticeId === null) {
    _saveFailNoticeId = pushNotice(
      "Couldn't autosave — local storage may be full or disabled. Save your graph to a file (Ctrl+S) to be safe.",
      "error",
      0,
    );
  }
}

function readLibraryFromStorage(): DocLibrary | null {
  const seqA = readSlotSeq(LIB_SLOT_A);
  const seqB = readSlotSeq(LIB_SLOT_B);
  const order = chooseReadSlot(seqA, seqB) === "b" ? [LIB_SLOT_B, LIB_SLOT_A] : [LIB_SLOT_A, LIB_SLOT_B];
  for (const key of order) {
    const lib = readSlotLib(key);
    if (lib) return lib;
  }
  return null;
}

// ─── Public store ─────────────────────────────────────────────────────────────

function makeDoc(name: string, graph: SavedGraph): SolDoc {
  return { id: newId(), name: uniqueName(_lib, name), graph, updatedAt: Date.now() };
}

async function showCurrent(animate = false): Promise<void> {
  const cur = getCurrent(_lib);
  if (cur) await loadGraph(cur.graph, { animate });
}

export interface DocMeta { id: string; name: string; updatedAt: number; current: boolean }

export const documentStore = {
  subscribe,
  version,

  /** Documents, most-recent first, for menus. */
  list(): DocMeta[] {
    return _lib.documents.map((d) => ({
      id: d.id,
      name: d.name,
      updatedAt: d.updatedAt,
      current: d.id === _lib.currentId,
    }));
  },

  currentId: (): string | null => _lib.currentId,
  currentName: (): string => getCurrent(_lib)?.name ?? "Untitled",
  /** The current doc's disk path, or null (never-saved / browser). */
  currentFilePath: (): string | null => getCurrent(_lib)?.filePath ?? null,

  /** Bind the current document to a disk path (after Save As / Open), optionally
   *  renaming it to the file's name. */
  bindCurrentToPath(filePath: string, name?: string): void {
    if (!_lib.currentId) return;
    _lib = setDocPath(_lib, _lib.currentId, filePath, name);
    persist();
    notify();
  },

  /** Load the library on startup. Returns true if a document was shown; false
   *  means there was nothing to restore (caller should create a first doc). */
  async restore(): Promise<boolean> {
    const lib = readLibraryFromStorage();
    if (!lib || lib.documents.length === 0) return false;
    _lib = lib;
    persist(); // settle the restored library into the current write slot
    notify();
    await showCurrent(true); // startup → play the cinematic reveal
    return getCurrent(_lib) !== null;
  },

  /** Serialize the live graph into the current document (the autosave action). */
  captureCurrent(): void {
    if (!_lib.currentId) return;
    const g = serializeGraph();
    if (!g) return;
    _lib = updateCurrentGraph(_lib, g, Date.now());
    persist();
    notify();
  },

  /** Reload the current document from scratch — capture the live graph, then
   *  rebuild it from that snapshot with the cinematic load reveal. This is a
   *  genuine reload (full teardown + rebuild, same path as a startup load), NOT
   *  an animation-only replay; a browser refresh doesn't re-run the reveal, so
   *  this is the in-app way to do it. */
  async reloadCurrent(): Promise<void> {
    if (loadRevealStore.isActive()) return; // a load/reveal is already running
    this.captureCurrent();
    await showCurrent(true);
  },

  /** New empty document, made current and shown. */
  async newBlank(): Promise<void> {
    this.captureCurrent();
    _lib = addDocument(_lib, makeDoc("Untitled", { ...EMPTY_GRAPH }));
    persist();
    notify();
    await loadGraph({ ...EMPTY_GRAPH });
  },

  /** New document from a seed template, made current and shown. `animate` is used
   *  by the fresh-user first-run path so startup reveals consistently; the in-app
   *  "New from template" action snaps (it's neither startup nor a file open). */
  async newFromTemplate(seedId: SeedId, animate = false): Promise<void> {
    const seed = SEEDS[seedId];
    if (!seed) return;
    this.captureCurrent();
    _lib = addDocument(_lib, makeDoc(seed.label, seed.graph));
    persist();
    notify();
    await loadGraph(seed.graph, { animate });
  },

  /** Switch to an existing document. */
  async open(id: string): Promise<void> {
    if (id === _lib.currentId) return;
    this.captureCurrent(); // keep the doc we're leaving up to date
    _lib = setCurrent(_lib, id);
    persist();
    notify();
    await showCurrent();
  },

  /** Fork the live graph into a new named document, made current. */
  saveAs(name: string): void {
    this.captureCurrent(); // freeze the doc we're forking from
    const g = serializeGraph() ?? { ...EMPTY_GRAPH };
    _lib = addDocument(_lib, makeDoc(name.trim() || "Untitled", g));
    persist();
    notify();
  },

  rename(id: string, name: string): void {
    _lib = renameDocument(_lib, id, name);
    persist();
    notify();
  },

  renameCurrent(name: string): void {
    if (_lib.currentId) this.rename(_lib.currentId, name);
  },

  /** Duplicate a document (defaults to current), made current and shown. */
  async duplicate(id: string = _lib.currentId ?? ""): Promise<void> {
    const src = _lib.documents.find((d) => d.id === id);
    if (!src) return;
    if (id === _lib.currentId) this.captureCurrent();
    _lib = duplicateDocument(_lib, id, newId(), uniqueName(_lib, `${src.name} copy`));
    persist();
    notify();
    await showCurrent();
  },

  /** Delete a document. If it was current, the next one is shown (or a fresh
   *  blank if none remain). */
  async remove(id: string): Promise<void> {
    const wasCurrent = id === _lib.currentId;
    _lib = removeDocument(_lib, id);
    if (_lib.documents.length === 0) {
      // Never leave the user with no document.
      _lib = addDocument(_lib, makeDoc("Untitled", { ...EMPTY_GRAPH }));
      persist();
      notify();
      await loadGraph({ ...EMPTY_GRAPH });
      return;
    }
    persist();
    notify();
    if (wasCurrent) await showCurrent();
  },

  /** Adopt an imported graph as a new document, made current and shown. A
   *  `filePath` binds the new doc to the file it came from (desktop Open). */
  async importAsDocument(graph: SavedGraph, name: string, filePath?: string): Promise<void> {
    this.captureCurrent();
    const doc = makeDoc(name, graph);
    if (filePath) doc.filePath = filePath;
    _lib = addDocument(_lib, doc);
    persist();
    notify();
    await loadGraph(graph, { animate: true }); // File → Open / import → reveal
  },
};

// Fresh user (no library, nothing to migrate): seed the first document from the
// default template so the canvas is never empty on first run.
export async function ensureFirstDocument(): Promise<void> {
  await documentStore.newFromTemplate(DEFAULT_SEED_ID, true); // first run is "startup"
}
