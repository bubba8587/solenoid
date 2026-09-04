import { createNotifier, createToggleStore } from "./storeKit";

// The OPEN document's author + tags, a module singleton so Rete's separate React root
// can read it. The document TITLE stays the documentStore name, never duplicated here.

export interface DocMeta {
  author?: string;
  tags?: string[];
  /** This document was adopted from OUTSIDE the app (a file Open / import), so its
   *  connection nodes fetch nothing until the user allows it (C2 network permission,
   *  the sinkRunButtonOnly mirror). Absent on the user's own documents — never gated. */
  foreign?: boolean;
  /** The per-document network grant, remembered in the sidecar meta. Only consulted
   *  while `foreign`; `undefined` = not yet decided (still gated). */
  networkAllowed?: boolean;
}

let _author = "";
let _tags: string[] = [];
let _foreign = false;
let _networkAllowed: boolean | undefined = undefined;
const { notify, subscribe, version } = createNotifier();

/** The Document Properties modal open/close flag. */
export const docPropertiesPanel = createToggleStore();

export const docMetaStore = {
  subscribe,
  version,
  author: (): string => _author,
  tags: (): string[] => _tags,
  setAuthor(v: string) {
    if (v === _author) return;
    _author = v;
    notify();
  },
  setTags(v: string[]) {
    _tags = v;
    notify();
  },
  /** Is the OPEN document foreign (adopted from outside the app)? */
  isForeign: (): boolean => _foreign,
  /** The open document's network grant: true allowed, false/undefined not yet. */
  networkAllowed: (): boolean | undefined => _networkAllowed,
  /** Mark the open document foreign — set once at adoption (importAsDocument). */
  markForeign() {
    if (_foreign) return;
    _foreign = true;
    notify();
  },
  /** Grant (or revoke) the open document's network permission; persists via docMeta(). */
  setNetworkAllowed(v: boolean) {
    if (_networkAllowed === v) return;
    _networkAllowed = v;
    notify();
  },
  /** Apply the open document's metadata (on graph load). Null/empty clears it. */
  setDocMeta(m?: DocMeta | null) {
    _author = typeof m?.author === "string" ? m.author : "";
    _tags = Array.isArray(m?.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [];
    _foreign = m?.foreign === true;
    _networkAllowed = typeof m?.networkAllowed === "boolean" ? m.networkAllowed : undefined;
    notify();
  },
  /** The doc's metadata block for serialization — undefined when nothing is set. */
  docMeta(): DocMeta | undefined {
    const author = _author.trim();
    const tags = _tags.map((t) => t.trim()).filter(Boolean);
    if (!author && tags.length === 0 && !_foreign && _networkAllowed === undefined) return undefined;
    const out: DocMeta = {};
    if (author) out.author = author;
    if (tags.length) out.tags = tags;
    if (_foreign) out.foreign = true;
    if (_networkAllowed !== undefined) out.networkAllowed = _networkAllowed;
    return out;
  },
};
