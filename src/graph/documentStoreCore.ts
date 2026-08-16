// Pure library transforms: callers pass ids and timestamps in, so keep this free of
// storage, rete, DOM and id/clock generation. Every transform must stay IMMUTABLE —
// documentStore's persist() diffs by object identity.

import type { SavedGraph } from "./persistence";
import { validateSavedGraph } from "./persistenceCore";

export const CURRENT_LIBRARY_VERSION = 1;

export interface SolDoc {
  id: string;
  name: string;
  graph: SavedGraph;
  updatedAt: number; // epoch ms of the last change — doubles as the autosave clock
  // Absolute disk path (desktop only); undefined for a never-saved doc. Save writes here.
  filePath?: string;
  // Epoch ms of the last Save / Save As to a file; undefined = never written.
  fileSavedAt?: number;
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

/** Bind a document to a disk path, optionally renaming it to the file's name. */
export function setDocPath(lib: DocLibrary, id: string, filePath: string, name?: string): DocLibrary {
  return {
    ...lib,
    documents: lib.documents.map((d) =>
      d.id === id ? { ...d, filePath, ...(name && name.trim() ? { name: name.trim() } : {}) } : d,
    ),
  };
}

/** Stamp a document as written to a file (Save / Save As). */
export function setDocFileSaved(lib: DocLibrary, id: string, at: number): DocLibrary {
  return {
    ...lib,
    documents: lib.documents.map((d) => (d.id === id ? { ...d, fileSavedAt: at } : d)),
  };
}

/** Write a graph into the current document, bumping updatedAt and floating it to the top. */
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

/** Copy a document under a new id + name; the copy must NOT inherit the source's disk
 *  path (or Save would overwrite the original file) — nor its fileSavedAt, since the
 *  copy has never been written anywhere. */
export function duplicateDocument(lib: DocLibrary, id: string, newId: string, newName: string): DocLibrary {
  const src = lib.documents.find((d) => d.id === id);
  if (!src) return lib;
  const copy: SolDoc = { id: newId, name: newName, graph: src.graph, updatedAt: src.updatedAt };
  return addDocument(lib, copy);
}

/** Structural validation of ONE parsed document blob — the per-doc autosave slots are
 *  validated one at a time, so this is standalone from validateLibrary. */
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
    ...(typeof dd.fileSavedAt === "number" ? { fileSavedAt: dd.fileSavedAt } : {}),
  };
}

/** Structural validation of a parsed library blob; the cleaned library, or null. */
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
