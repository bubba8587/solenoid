// [[B12]] losslessSaves. Mechanics: tree/specs/documents/per-doc-autosave-persistence.md.

import type { SavedGraph } from "./persistence";
import { validateSavedGraph } from "./persistenceCore";

const CURRENT_LIBRARY_VERSION = 1;

export interface SolDoc {
  id: string;
  name: string;
  graph: SavedGraph;
  updatedAt: number;
  filePath?: string;
  fileSavedAt?: number;
  /** The folder path, `"Finance/2026"`; absent at the root. */
  folder?: string;
}

export interface DocLibrary {
  v: number;
  documents: SolDoc[];
  currentId: string | null;
  /** Folders the user made, kept so an empty one survives; a document's folder and its ancestors exist without a listing. */
  folders?: string[];
}

export function emptyLibrary(): DocLibrary {
  return { v: CURRENT_LIBRARY_VERSION, documents: [], currentId: null, folders: [] };
}

export function getCurrent(lib: DocLibrary): SolDoc | null {
  return lib.documents.find((d) => d.id === lib.currentId) ?? null;
}

export function uniqueName(lib: DocLibrary, base: string): string {
  const taken = new Set(lib.documents.map((d) => d.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function addDocument(lib: DocLibrary, doc: SolDoc): DocLibrary {
  return { ...lib, documents: [doc, ...lib.documents], currentId: doc.id };
}

export function renameDocument(lib: DocLibrary, id: string, name: string): DocLibrary {
  const trimmed = name.trim();
  if (!trimmed) return lib;
  return {
    ...lib,
    documents: lib.documents.map((d) => (d.id === id ? { ...d, name: trimmed } : d)),
  };
}

export function setCurrent(lib: DocLibrary, id: string): DocLibrary {
  if (!lib.documents.some((d) => d.id === id)) return lib;
  return { ...lib, currentId: id };
}

export function setDocPath(lib: DocLibrary, id: string, filePath: string, name?: string): DocLibrary {
  return {
    ...lib,
    documents: lib.documents.map((d) =>
      d.id === id ? { ...d, filePath, ...(name && name.trim() ? { name: name.trim() } : {}) } : d,
    ),
  };
}

export function setDocFileSaved(lib: DocLibrary, id: string, at: number): DocLibrary {
  return {
    ...lib,
    documents: lib.documents.map((d) => (d.id === id ? { ...d, fileSavedAt: at } : d)),
  };
}

/** Equal as JSON would write them: key order, keys holding `undefined` and the file's `savedAt` stamp don't count. */
function sameGraph(a: SavedGraph, b: SavedGraph): boolean {
  return sameJson({ ...a, savedAt: undefined }, { ...b, savedAt: undefined });
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  return ka.length === Object.keys(rb).filter((k) => rb[k] !== undefined).length && ka.every((k) => sameJson(ra[k], rb[k]));
}

/** Leaves the library as it was when the graph is unchanged, so the autosave clock marks the last real edit. */
export function updateCurrentGraph(lib: DocLibrary, graph: SavedGraph, now: number): DocLibrary {
  const cur = getCurrent(lib);
  if (!cur || sameGraph(cur.graph, graph)) return lib;
  const updated: SolDoc = { ...cur, graph, updatedAt: now };
  const rest = lib.documents.filter((d) => d.id !== cur.id);
  return { ...lib, documents: [updated, ...rest] };
}

/** The current document's graph as the load left it (a load may normalize a file's graph), keeping its time: a
 *  load is not an edit, so the first autosave after it moves the time only for a real change. */
export function adoptLoadedGraph(lib: DocLibrary, graph: SavedGraph): DocLibrary {
  const cur = getCurrent(lib);
  if (!cur || sameGraph(cur.graph, graph)) return lib;
  return { ...lib, documents: lib.documents.map((d) => (d.id === cur.id ? { ...d, graph } : d)) };
}

export function removeDocument(lib: DocLibrary, id: string): DocLibrary {
  const documents = lib.documents.filter((d) => d.id !== id);
  let currentId = lib.currentId;
  if (currentId === id) currentId = documents[0]?.id ?? null;
  return { ...lib, documents, currentId };
}

export function duplicateDocument(lib: DocLibrary, id: string, newId: string, newName: string): DocLibrary {
  const src = lib.documents.find((d) => d.id === id);
  if (!src) return lib;
  const copy: SolDoc = { id: newId, name: newName, graph: src.graph, updatedAt: src.updatedAt, ...(src.folder ? { folder: src.folder } : {}) };
  return addDocument(lib, copy);
}

// ── Folders ([[C132]] workspaceTree; tree/specs/documents/workspace-tree.md § Where the tree comes from) ──

/** Trimmed, empty segments dropped; `""` is the root. */
export function normalizeFolder(path: string | undefined): string {
  return (path ?? "").split("/").map((p) => p.trim()).filter(Boolean).join("/");
}

export function parentFolder(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** Every folder that exists: the listed ones, every document's folder, and all their ancestors; sorted. */
export function allFolders(lib: DocLibrary): string[] {
  const out = new Set<string>();
  const add = (p: string) => { for (let f = p; f; f = parentFolder(f)) out.add(f); };
  for (const f of lib.folders ?? []) add(f);
  for (const d of lib.documents) if (d.folder) add(d.folder);
  return [...out].sort();
}

function uniqueFolderName(lib: DocLibrary, parent: string, base: string, except?: string): string {
  const taken = new Set(allFolders(lib).filter((f) => parentFolder(f) === parent && f !== except).map((f) => f.slice(parent ? parent.length + 1 : 0)));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function addFolder(lib: DocLibrary, parent: string, name: string): { lib: DocLibrary; path: string } {
  const base = name.replace(/\//g, " ").trim() || "New folder";
  const par = normalizeFolder(parent);
  const leaf = uniqueFolderName(lib, par, base);
  const path = par ? `${par}/${leaf}` : leaf;
  return { lib: { ...lib, folders: [...(lib.folders ?? []), path] }, path };
}

/** Moves a document into `folder` (`""` for the root); a document already there is left as it was. */
export function moveDocument(lib: DocLibrary, id: string, folder: string): DocLibrary {
  const to = normalizeFolder(folder);
  const src = lib.documents.find((d) => d.id === id);
  if (!src || (src.folder ?? "") === to) return lib;
  return {
    ...lib,
    documents: lib.documents.map((d) => {
      if (d.id !== id) return d;
      const { folder: _old, ...rest } = d;
      return to ? { ...rest, folder: to } : rest;
    }),
  };
}

function rehome(lib: DocLibrary, from: string, to: string): DocLibrary {
  const swap = (p: string) => (to + p.slice(from.length)).replace(/^\//, "");
  return {
    ...lib,
    documents: lib.documents.map((d) => {
      if (!d.folder || !within(d.folder, from)) return d;
      const next = swap(d.folder);
      const { folder: _old, ...rest } = d;
      return next ? { ...rest, folder: next } : rest;
    }),
    folders: [...new Set((lib.folders ?? []).map((f) => (within(f, from) ? swap(f) : f)).filter(Boolean))],
  };
}

/** Renames the last segment of `path`, carrying every folder and document under it along. */
export function renameFolder(lib: DocLibrary, path: string, name: string): { lib: DocLibrary; path: string } {
  const from = normalizeFolder(path);
  const base = name.replace(/\//g, " ").trim();
  if (!from || !base) return { lib, path: from };
  const par = parentFolder(from);
  const leaf = uniqueFolderName(lib, par, base, from);
  const to = par ? `${par}/${leaf}` : leaf;
  if (to === from) return { lib, path: from };
  return { lib: rehome(lib, from, to), path: to };
}

/** Moves a folder under `parent`; a move into itself or its own subfolder is refused. */
export function moveFolder(lib: DocLibrary, path: string, parent: string): { lib: DocLibrary; path: string } {
  const from = normalizeFolder(path);
  const par = normalizeFolder(parent);
  if (!from || within(par, from) || parentFolder(from) === par) return { lib, path: from };
  const leaf = uniqueFolderName(lib, par, from.slice(from.lastIndexOf("/") + 1));
  const to = par ? `${par}/${leaf}` : leaf;
  return { lib: rehome(lib, from, to), path: to };
}

/** The documents a folder holds, its subfolders' included. */
export function documentsIn(lib: DocLibrary, path: string): SolDoc[] {
  const f = normalizeFolder(path);
  return f ? lib.documents.filter((d) => d.folder && within(d.folder, f)) : [];
}

/** Drops the folder and its subfolders from the listing and every document under them from the library. */
export function removeFolder(lib: DocLibrary, path: string): DocLibrary {
  const f = normalizeFolder(path);
  if (!f) return lib;
  let next: DocLibrary = { ...lib, folders: (lib.folders ?? []).filter((x) => !within(x, f)) };
  for (const d of documentsIn(lib, f)) next = removeDocument(next, d.id);
  return next;
}

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
    ...(typeof dd.folder === "string" && normalizeFolder(dd.folder) ? { folder: normalizeFolder(dd.folder) } : {}),
  };
}

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
  const folders = Array.isArray(lib.folders)
    ? [...new Set(lib.folders.filter((f): f is string => typeof f === "string").map(normalizeFolder).filter(Boolean))]
    : [];
  return { v: CURRENT_LIBRARY_VERSION, documents, currentId, folders };
}
