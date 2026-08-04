// The documents library: the app's "file system". Multiple named graphs live in
// localStorage; one is current and shown on the canvas. Autosave writes the live
// graph into the current document; New / Open / Save As / Rename / Duplicate /
// Delete manage the set. Seeds are templates (New from template), NOT the
// working document.
//
// Pure library transforms live in documentStoreCore.ts (unit-tested). This file
// adds: the in-memory library + notifier, per-document two-slot localStorage
// persistence (crash-safety slots from persistenceCore), and the editor wiring
// (loadGraph / serializeGraph).

import { createNotifier } from "./storeKit";
import { serializeGraph, loadGraph, type SavedGraph } from "./persistence";
import { isGraphRebuilding } from "./process";
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
  validateDoc,
  type DocLibrary,
  type SolDoc,
} from "./documentStoreCore";

const OLD_LIB_SLOT_A = "solenoid.docs.lib.a";
const OLD_LIB_SLOT_B = "solenoid.docs.lib.b";

const INDEX_SLOT_A = "solenoid.docs.index.a";
const INDEX_SLOT_B = "solenoid.docs.index.b";
const docSlotKey = (id: string, slot: "a" | "b") => `solenoid.docs.doc.${id}.${slot}`;

const EMPTY_GRAPH: SavedGraph = { v: 2, nodes: [], connections: [] };

interface IndexMeta { id: string; name: string; updatedAt: number; filePath?: string }
interface IndexSlot { seq: number; currentId: string | null; docs: IndexMeta[] }
interface DocSlot { seq: number; doc: SolDoc }

const { notify, subscribe, version } = createNotifier();
let _lib: DocLibrary = emptyLibrary();
let _saveFailNoticeId: number | null = null;
const _lastPersisted = new Map<string, SolDoc>();
let _seq = Date.now();
const nextSeq = () => ++_seq;

function newId(): string {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── localStorage (two rotating slots per doc + per index) ────────────────────

function readSlotSeq(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const m = /^\{"seq":(\d+)/.exec(raw);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function readParsed<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

/** Write `value` to the OLDER of the two slots (persistenceCore's crash-safety
 *  rotation). Returns false when storage rejects it. */
function writeToOlderSlot(keyA: string, keyB: string, value: unknown): boolean {
  const slot = chooseWriteSlot(readSlotSeq(keyA), readSlotSeq(keyB));
  try {
    localStorage.setItem(slot === "a" ? keyA : keyB, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Read the newest structurally-valid value from a slot pair. `validate` maps
 *  the raw parsed slot to the value we actually want (or null = try the other
 *  slot) — for docs that's the unwrapped SolDoc, not the slot envelope. */
function readNewestSlot<T, R>(keyA: string, keyB: string, validate: (o: Partial<T>) => R | null): R | null {
  const order = chooseReadSlot(readSlotSeq(keyA), readSlotSeq(keyB)) === "b" ? [keyB, keyA] : [keyA, keyB];
  for (const key of order) {
    const o = readParsed<T>(key);
    if (!o) continue;
    const v = validate(o);
    if (v) return v;
  }
  return null;
}

function removeDocSlots(id: string): void {
  try {
    localStorage.removeItem(docSlotKey(id, "a"));
    localStorage.removeItem(docSlotKey(id, "b"));
  } catch { /* storage disabled — nothing to remove */ }
}

/** Persist the library: the index always (it's tiny), plus ONLY the documents
 *  whose object changed since the last persist, plus key removal for documents
 *  that left the library. Surfaces a sticky notice if storage rejects any
 *  write (cleared once a persist next fully succeeds). */
function persist(): void {
  let ok = true;

  const index: IndexSlot = {
    seq: nextSeq(),
    currentId: _lib.currentId,
    docs: _lib.documents.map((d) => ({
      id: d.id,
      name: d.name,
      updatedAt: d.updatedAt,
      ...(d.filePath ? { filePath: d.filePath } : {}),
    })),
  };
  if (!writeToOlderSlot(INDEX_SLOT_A, INDEX_SLOT_B, index)) ok = false;

  const liveIds = new Set<string>();
  for (const d of _lib.documents) {
    liveIds.add(d.id);
    if (_lastPersisted.get(d.id) === d) continue; // unchanged since last write
    const slot: DocSlot = { seq: nextSeq(), doc: d };
    if (writeToOlderSlot(docSlotKey(d.id, "a"), docSlotKey(d.id, "b"), slot)) {
      _lastPersisted.set(d.id, d);
    } else {
      ok = false;
    }
  }
  for (const id of [..._lastPersisted.keys()]) {
    if (!liveIds.has(id)) {
      removeDocSlots(id); // deleted doc — free its quota
      _lastPersisted.delete(id);
    }
  }

  if (ok) {
    if (_saveFailNoticeId !== null) { dismissNotice(_saveFailNoticeId); _saveFailNoticeId = null; }
  } else if (_saveFailNoticeId === null) {
    _saveFailNoticeId = pushNotice(
      "Couldn't autosave: local storage may be full or disabled. Save your graph to a file (Ctrl+S) to be safe.",
      "error",
      0,
    );
  }
}

function readLibraryFromStorage(): DocLibrary | null {
  const index = readNewestSlot<IndexSlot, IndexSlot>(INDEX_SLOT_A, INDEX_SLOT_B, (o) => {
    if (!Array.isArray(o.docs)) return null;
    return { seq: typeof o.seq === "number" ? o.seq : 0, currentId: typeof o.currentId === "string" ? o.currentId : null, docs: o.docs as IndexMeta[] };
  });
  if (!index) return null;

  const documents: SolDoc[] = [];
  for (const meta of index.docs) {
    if (typeof meta?.id !== "string") continue;
    const doc = readNewestSlot<DocSlot, SolDoc>(docSlotKey(meta.id, "a"), docSlotKey(meta.id, "b"), (o) => (o.doc ? validateDoc(o.doc) : null));
    if (doc) documents.push(doc); // a missing/corrupt doc is skipped, not fatal
  }
  if (documents.length === 0) return null;
  const currentId = documents.some((d) => d.id === index.currentId) ? index.currentId : documents[0].id;
  const lib = validateLibrary({ documents, currentId });
  if (lib) {
    _lastPersisted.clear();
    for (const d of lib.documents) _lastPersisted.set(d.id, d);
  }
  return lib;
}

// ─── Public store ─────────────────────────────────────────────────────────────

function makeDoc(name: string, graph: SavedGraph): SolDoc {
  return { id: newId(), name: uniqueName(_lib, name), graph, updatedAt: Date.now() };
}

async function showCurrent(animate = false): Promise<boolean> {
  const cur = getCurrent(_lib);
  if (!cur) return false;
  return loadGraph(cur.graph, { animate });
}

/** Show the current doc, keeping the session SAFE when the load is refused or
 *  rolled back (loadGraph → false): the canvas then still shows the previous
 *  graph, so `currentId` must not stay pointing at the doc that never loaded —
 *  one edit later, autosave would write doc A's graph into doc B.
 *  Revert to `revertTo` when it still exists (the doc the canvas shows), else
 *  park the session on a fresh blank document (startup restore / post-delete,
 *  where there is nothing to revert to). */
async function showCurrentSafe(animate = false, revertTo?: string | null): Promise<void> {
  if (await showCurrent(animate)) return;
  if (revertTo && _lib.documents.some((d) => d.id === revertTo)) {
    _lib = setCurrent(_lib, revertTo);
    persist();
    notify();
    return;
  }
  _lib = addDocument(_lib, makeDoc("Untitled", { ...EMPTY_GRAPH }));
  persist();
  notify();
  await loadGraph({ ...EMPTY_GRAPH });
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
    try {
      localStorage.removeItem(OLD_LIB_SLOT_A);
      localStorage.removeItem(OLD_LIB_SLOT_B);
    } catch { /* storage disabled */ }
    const lib = readLibraryFromStorage();
    if (!lib || lib.documents.length === 0) return false;
    _lib = lib;
    persist(); // settle the restored library into the current write slot
    notify();
    await showCurrentSafe(true); // startup → play the cinematic reveal
    return getCurrent(_lib) !== null;
  },

  /** Serialize the live graph into the current document (the autosave action). */
  captureCurrent(): void {
    if (!_lib.currentId) return;
    // Never capture while a load/rebuild is mid-flight — it would serialize the
    // half-built canvas into the current doc. The autosave timer already checks
    // suspension at fire time; this closes the DIRECT call paths (open/newBlank/
    // saveAs/duplicate/import all captureCurrent unconditionally).
    if (isGraphRebuilding()) return;
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
    if (isGraphRebuilding()) return; // a doc op during a load races the rebuild
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
    if (isGraphRebuilding()) return;
    this.captureCurrent();
    _lib = addDocument(_lib, makeDoc(seed.label, seed.graph));
    persist();
    notify();
    await loadGraph(seed.graph, { animate });
  },

  async open(id: string): Promise<void> {
    if (id === _lib.currentId) return;
    if (isGraphRebuilding()) return;
    this.captureCurrent(); // keep the doc we're leaving up to date
    const prevId = _lib.currentId;
    _lib = setCurrent(_lib, id);
    persist();
    notify();
    await showCurrentSafe(false, prevId);
  },

  /** Fork the live graph into a new named document, made current. */
  saveAs(name: string): void {
    if (isGraphRebuilding()) return; // would fork a half-built canvas
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
    if (isGraphRebuilding()) return;
    if (id === _lib.currentId) this.captureCurrent();
    const prevId = _lib.currentId;
    _lib = duplicateDocument(_lib, id, newId(), uniqueName(_lib, `${src.name} copy`));
    persist();
    notify();
    await showCurrentSafe(false, prevId);
  },

  /** Delete a document. If it was current, the next one is shown (or a fresh
   *  blank if none remain). */
  async remove(id: string): Promise<void> {
    if (isGraphRebuilding()) return;
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
    // No revert target — the doc the canvas showed was just deleted, so a
    // failed load parks on a blank doc rather than autosaving the deleted
    // graph into the next doc.
    if (wasCurrent) await showCurrentSafe();
  },

  /** Adopt an imported graph as a new document, made current and shown. A
   *  `filePath` binds the new doc to the file it came from (desktop Open). */
  async importAsDocument(graph: SavedGraph, name: string, filePath?: string): Promise<void> {
    if (isGraphRebuilding()) return;
    this.captureCurrent();
    const prevId = _lib.currentId;
    const doc = makeDoc(name, graph);
    if (filePath) doc.filePath = filePath;
    _lib = addDocument(_lib, doc);
    persist();
    notify();
    // File → Open / import → reveal. A refused import (newer save version)
    // reverts to the doc the canvas still shows.
    if (!(await loadGraph(graph, { animate: true })) && prevId) {
      _lib = setCurrent(_lib, prevId);
      persist();
      notify();
    }
  },
};

// Fresh user (no library, nothing to migrate): seed the first document from the
// default template so the canvas is never empty on first run.
export async function ensureFirstDocument(): Promise<void> {
  await documentStore.newFromTemplate(DEFAULT_SEED_ID, true); // first run is "startup"
}
