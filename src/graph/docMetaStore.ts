import { createNotifier, createToggleStore } from "./storeKit";

// The OPEN document's author + tags, a module singleton so Rete's separate React root
// can read it. The document TITLE stays the documentStore name, never duplicated here.

export interface DocMeta {
  author?: string;
  tags?: string[];
}

let _author = "";
let _tags: string[] = [];
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
  /** Apply the open document's metadata (on graph load). Null/empty clears it. */
  setDocMeta(m?: DocMeta | null) {
    _author = typeof m?.author === "string" ? m.author : "";
    _tags = Array.isArray(m?.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [];
    notify();
  },
  /** The doc's metadata block for serialization — undefined when nothing is set. */
  docMeta(): DocMeta | undefined {
    const author = _author.trim();
    const tags = _tags.map((t) => t.trim()).filter(Boolean);
    if (!author && tags.length === 0) return undefined;
    const out: DocMeta = {};
    if (author) out.author = author;
    if (tags.length) out.tags = tags;
    return out;
  },
};
