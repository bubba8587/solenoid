// [[C132]] workspaceTree. The documents menu lists this device's last opened documents; the Navigator's Files tree lists them all.
import { createNotifier } from "./storeKit";

const KEY = "solenoid.recentDocs";
const KEPT = 12;
/** How many recents the documents menu shows. */
export const RECENTS_SHOWN = 5;

/** `id` moved to the front, newest first, the list capped. */
export function touchRecent(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, KEPT);
}

/** The recents that still name a document, in order, at most `n`. */
export function recentDocs<D extends { id: string }>(list: readonly string[], docs: readonly D[], n = RECENTS_SHOWN): D[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  return list.map((id) => byId.get(id)).filter((d): d is D => !!d).slice(0, n);
}

function read(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

const _stored = typeof localStorage === "undefined" ? null : read();
let _ids: string[] = _stored ?? [];
let _seeded = _stored !== null;
const { notify, subscribe, version } = createNotifier();

function set(next: string[]) {
  _ids = next;
  _seeded = true;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  notify();
}

export const recentDocsStore = {
  subscribe,
  version,
  ids: (): readonly string[] => _ids,
  /** A device with no list yet starts from the library's last edited documents, newest first. */
  seed(ids: readonly string[]) { if (!_seeded && ids.length > 0) set(ids.slice(0, KEPT)); },
  touch(id: string) { if (_ids[0] !== id) set(touchRecent(_ids, id)); },
  /** Takes it off the list only; the document stays in the library. */
  clear(id: string) { if (_ids.includes(id)) set(_ids.filter((x) => x !== id)); },
};
