// Pure core for the documents library — no localStorage, no rete, no DOM, no
// id/clock generation (callers pass ids and timestamps in, so every function is
// deterministic and unit-testable). Mirrors persistenceCore.ts / groupPushCore.ts.
//
// The library is a list of named documents plus a pointer to the current one.
// documentStore.ts wraps these with localStorage persistence and the editor
// load/serialize wiring; this module only transforms the library value.

import type { SavedGraph } from "./persistence";
import { validateSavedGraph } from "./persistenceCore";

export const CURRENT_LIBRARY_VERSION = 1;

export interface SolDoc {
  id: string;
  name: string;
  graph: SavedGraph;
  updatedAt: number; // epoch ms of the last change
  // Absolute path on disk this document is bound to (desktop only). Set when the
  // doc was opened from, or last saved to, a file; undefined for a never-saved
  // doc or in the browser build. Save writes straight to this path; Save As (or a
  // first save) sets it from the native dialog.
  filePath?: string;
}

export interface DocLibrary {
  v: number;
  documents: SolDoc[];
  currentId: string | null;
}

export function emptyLibrary(): DocLibrary {
  return { v: CURRENT_LIBRARY_VERSION, documents: [], currentId: null };
}

export function getCurrent(lib: DocLibrary): SolDoc | null {
  return lib.documents.find((d) => d.id === lib.currentId) ?? null;
}

/** A name not already taken in the library — "Untitled", then "Untitled 2", … */
export function uniqueName(lib: DocLibrary, base: string): string {
  const taken = new Set(lib.documents.map((d) => d.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Add a document (most-recent first) and make it current. */
export function addDocument(lib: DocLibrary, doc: SolDoc): DocLibrary {
  return { ...lib, documents: [doc, ...lib.documents], currentId: doc.id };
}

export function renameDocument(lib: DocLibrary, id: string, name: string): DocLibrary {
  const trimmed = name.trim();
  if (!trimmed) return lib; // ignore empty rename
  return {
    ...lib,
    documents: lib.documents.map((d) => (d.id === id ? { ...d, name: trimmed } : d)),
  };
}

export function setCurrent(lib: DocLibrary, id: string): DocLibrary {
  if (!lib.documents.some((d) => d.id === id)) return lib;
  return { ...lib, currentId: id };
}

/** Bind a document to a disk path (and optionally rename it to the file's name).
 *  Used after a Save As / Open writes or reads a real file. */
export function setDocPath(lib: DocLibrary, id: string, filePath: string, name?: string): DocLibrary {
  return {
    ...lib,
    documents: lib.documents.map((d) =>
      d.id === id ? { ...d, filePath, ...(name && name.trim() ? { name: name.trim() } : {}) } : d,
    ),
  };
}

/** Write a freshly-serialized graph into the current document, bumping its
 *  updatedAt and floating it to the top of the list (most-recent first). */
export function updateCurrentGraph(lib: DocLibrary, graph: SavedGraph, now: number): DocLibrary {
  const cur = getCurrent(lib);
  if (!cur) return lib;
  const updated: SolDoc = { ...cur, graph, updatedAt: now };
  const rest = lib.documents.filter((d) => d.id !== cur.id);
  return { ...lib, documents: [updated, ...rest] };
}

/** Remove a document; if it was current, fall to the next most-recent (or null). */
export function removeDocument(lib: DocLibrary, id: string): DocLibrary {
  const documents = lib.documents.filter((d) => d.id !== id);
  let currentId = lib.currentId;
  if (currentId === id) currentId = documents[0]?.id ?? null;
  return { ...lib, documents, currentId };
}

/** Copy a document under a new id + name, made current. The copy is a NEW unsaved
 *  document — it does NOT inherit the source's disk path (Save would otherwise
 *  overwrite the original file). */
export function duplicateDocument(lib: DocLibrary, id: string, newId: string, newName: string): DocLibrary {
  const src = lib.documents.find((d) => d.id === id);
  if (!src) return lib;
  const copy: SolDoc = { id: newId, name: newName, graph: src.graph, updatedAt: src.updatedAt };
  return addDocument(lib, copy);
}

/** Structural validation of ONE parsed document blob — string id/name and a
 *  structurally-valid graph. The per-doc half of validateLibrary, standalone
 *  because the per-doc autosave keys store each document under its own
 *  localStorage key (documentStore.ts) and validate them one at a time. */
export function validateDoc(data: unknown): SolDoc | null {
  if (typeof data !== "object" || data === null) return null;
  const dd = data as Record<string, unknown>;
  if (typeof dd.id !== "string" || typeof dd.name !== "string") return null;
  if (!validateSavedGraph(dd.graph).ok) return null;
  return {
    id: dd.id,
    name: dd.name,
    graph: dd.graph as SavedGraph,
    updatedAt: typeof dd.updatedAt === "number" ? dd.updatedAt : 0,
    ...(typeof dd.filePath === "string" ? { filePath: dd.filePath } : {}),
  };
}

/** Structural validation of a parsed library blob — every document must have a
 *  string id/name and a structurally-valid graph; currentId must reference an
 *  existing document or be null. Returns the cleaned library, or null if the
 *  shape is unusable. */
export function validateLibrary(data: unknown): DocLibrary | null {
  if (typeof data !== "object" || data === null) return null;
  const lib = data as Record<string, unknown>;
  if (!Array.isArray(lib.documents)) return null;
  const documents: SolDoc[] = [];
  for (const d of lib.documents) {
    const doc = validateDoc(d);
    if (!doc) return null;
    documents.push(doc);
  }
  const rawCurrent = typeof lib.currentId === "string" ? lib.currentId : null;
  const currentId = documents.some((d) => d.id === rawCurrent) ? rawCurrent : documents[0]?.id ?? null;
  return { v: CURRENT_LIBRARY_VERSION, documents, currentId };
}
