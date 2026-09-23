// [[C36]] captureBeforeSwap, [[C32]] autosaveSlotOrder. Mechanics: tree/specs/documents/per-doc-autosave-persistence.md.
import { createNotifier } from "./storeKit";
import { serializeGraph, loadGraph, type SavedGraph } from "./persistence";
import { isGraphRebuilding } from "./process";
import { loadRevealStore } from "./loadReveal";
import { chooseWriteSlot, chooseReadSlot, CURRENT_SAVE_VERSION } from "./persistenceCore";
import { pushNotice, dismissNotice } from "./noticeStore";
import { saveTimeStore } from "./saveTimeStore";
import { SEEDS, DEFAULT_SEED_ID, type SeedId } from "./seeds";
import {
  emptyLibrary,
  getCurrent,
  uniqueName,
  addDocument,
  renameDocument,
  setCurrent,
  setDocPath,
  setDocFileSaved,
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

const EMPTY_GRAPH: SavedGraph = { v: CURRENT_SAVE_VERSION, nodes: [], connections: [] };

interface IndexMeta { id: string; name: string; updatedAt: number; filePath?: string }
interface IndexSlot { seq: number; currentId: string | null; docs: IndexMeta[] }
interface DocSlot { seq: number; doc: SolDoc }

const { notify, subscribe, version } = createNotifier();
let _lib: DocLibrary = emptyLibrary();

function mirrorToDevServer(g: SavedGraph): void {
  if (!import.meta.env.DEV || typeof window === "undefined" || typeof fetch !== "function") return;
  if (typeof navigator !== "undefined" && navigator.webdriver) return;
  void fetch("/__dev-graph", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(g) })
    .catch(() => { /* no dev server behind this origin (tauri dev without vite, a preview) */ });
}
let _saveFailNoticeId: number | null = null;
const _lastPersisted = new Map<string, SolDoc>();
let _seq = Date.now();
const nextSeq = () => ++_seq;

function newId(): string {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}


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

function writeToOlderSlot(keyA: string, keyB: string, value: unknown): boolean {
  const slot = chooseWriteSlot(readSlotSeq(keyA), readSlotSeq(keyB));
  try {
    localStorage.setItem(slot === "a" ? keyA : keyB, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

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
    if (_lastPersisted.get(d.id) === d) continue;
    const slot: DocSlot = { seq: nextSeq(), doc: d };
    if (writeToOlderSlot(docSlotKey(d.id, "a"), docSlotKey(d.id, "b"), slot)) {
      _lastPersisted.set(d.id, d);
    } else {
      ok = false;
    }
  }
  for (const id of [..._lastPersisted.keys()]) {
    if (!liveIds.has(id)) {
      removeDocSlots(id);
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
    if (doc) documents.push(doc);
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


function makeDoc(name: string, graph: SavedGraph): SolDoc {
  return { id: newId(), name: uniqueName(_lib, name), graph, updatedAt: Date.now() };
}

async function showCurrent(): Promise<boolean> {
  const cur = getCurrent(_lib);
  if (!cur) return false;
  return loadGraph(cur.graph);
}

async function showCurrentSafe(revertTo?: string | null): Promise<void> {
  if (await showCurrent()) return;
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
  currentFilePath: (): string | null => getCurrent(_lib)?.filePath ?? null,

  bindCurrentToPath(filePath: string, name?: string): void {
    if (!_lib.currentId) return;
    _lib = setDocPath(_lib, _lib.currentId, filePath, name);
    persist();
    notify();
  },

  markCurrentFileSaved(at: number = Date.now()): void {
    if (!_lib.currentId) return;
    _lib = setDocFileSaved(_lib, _lib.currentId, at);
    persist();
    notify();
  },

  async restore(): Promise<boolean> {
    try {
      localStorage.removeItem(OLD_LIB_SLOT_A);
      localStorage.removeItem(OLD_LIB_SLOT_B);
    } catch { /* storage disabled */ }
    const lib = readLibraryFromStorage();
    if (!lib || lib.documents.length === 0) return false;
    _lib = lib;
    persist();
    notify();
    await showCurrentSafe();
    return getCurrent(_lib) !== null;
  },

  captureCurrent(): void {
    if (!_lib.currentId) return;
    if (isGraphRebuilding()) return;
    const g = serializeGraph();
    if (!g) return;
    _lib = updateCurrentGraph(_lib, g, Date.now());
    persist();
    notify();
    mirrorToDevServer(g);
  },

  async reloadCurrent(): Promise<void> {
    if (loadRevealStore.isActive()) return;
    this.captureCurrent();
    await showCurrent();
  },

  async newBlank(): Promise<void> {
    if (isGraphRebuilding()) return;
    this.captureCurrent();
    _lib = addDocument(_lib, makeDoc("Untitled", { ...EMPTY_GRAPH }));
    persist();
    notify();
    await loadGraph({ ...EMPTY_GRAPH });
  },

  async newFromTemplate(seedId: SeedId): Promise<void> {
    const seed = SEEDS[seedId];
    if (!seed) return;
    if (isGraphRebuilding()) return;
    this.captureCurrent();
    _lib = addDocument(_lib, makeDoc(seed.label, seed.graph));
    persist();
    notify();
    await loadGraph(seed.graph);
  },

  async open(id: string): Promise<void> {
    if (id === _lib.currentId) return;
    if (isGraphRebuilding()) return;
    this.captureCurrent();
    const prevId = _lib.currentId;
    _lib = setCurrent(_lib, id);
    persist();
    notify();
    await showCurrentSafe(prevId);
  },

  saveAs(name: string): void {
    if (isGraphRebuilding()) return;
    this.captureCurrent();
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

  async duplicate(id: string = _lib.currentId ?? ""): Promise<void> {
    const src = _lib.documents.find((d) => d.id === id);
    if (!src) return;
    if (isGraphRebuilding()) return;
    if (id === _lib.currentId) this.captureCurrent();
    const prevId = _lib.currentId;
    _lib = duplicateDocument(_lib, id, newId(), uniqueName(_lib, `${src.name} copy`));
    persist();
    notify();
    await showCurrentSafe(prevId);
  },

  async remove(id: string): Promise<void> {
    if (isGraphRebuilding()) return;
    const wasCurrent = id === _lib.currentId;
    _lib = removeDocument(_lib, id);
    if (_lib.documents.length === 0) {
      _lib = addDocument(_lib, makeDoc("Untitled", { ...EMPTY_GRAPH }));
      persist();
      notify();
      await loadGraph({ ...EMPTY_GRAPH });
      return;
    }
    persist();
    notify();
    if (wasCurrent) await showCurrentSafe();
  },

  async importAsDocument(graph: SavedGraph, name: string, filePath?: string): Promise<void> {
    if (isGraphRebuilding()) return;
    this.captureCurrent();
    const prevId = _lib.currentId;
    graph.meta = { ...graph.meta, foreign: true, networkAllowed: undefined };
    const doc = makeDoc(name, graph);
    if (filePath) doc.filePath = filePath;
    if (typeof graph.savedAt === "number") {
      doc.fileSavedAt = graph.savedAt;
      doc.updatedAt = graph.savedAt;
    }
    _lib = addDocument(_lib, doc);
    persist();
    notify();
    if (!(await loadGraph(graph)) && prevId) {
      _lib = setCurrent(_lib, prevId);
      persist();
      notify();
    }
  },
};

saveTimeStore.setProvider(() => {
  const cur = getCurrent(_lib);
  return { autosavedAt: cur?.updatedAt ?? null, fileSavedAt: cur?.fileSavedAt ?? null };
});
subscribe(saveTimeStore.bump);

export async function ensureFirstDocument(): Promise<void> {
  await documentStore.newFromTemplate(DEFAULT_SEED_ID);
}
