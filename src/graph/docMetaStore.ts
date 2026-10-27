// [[C103]] untrustedContentSeams
import { createNotifier, createToggleStore } from "./storeKit";

export interface DocMeta {
  author?: string;
  tags?: string[];
  foreign?: boolean;
  networkAllowed?: boolean;
}

let _author = "";
let _tags: string[] = [];
let _foreign = false;
let _networkAllowed: boolean | undefined = undefined;
const { notify, subscribe, version } = createNotifier();

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
  isForeign: (): boolean => _foreign,
  networkAllowed: (): boolean | undefined => _networkAllowed,
  markForeign() {
    if (_foreign) return;
    _foreign = true;
    notify();
  },
  setNetworkAllowed(v: boolean) {
    if (_networkAllowed === v) return;
    _networkAllowed = v;
    notify();
  },
  setDocMeta(m?: DocMeta | null) {
    _author = typeof m?.author === "string" ? m.author : "";
    _tags = Array.isArray(m?.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [];
    _foreign = m?.foreign === true;
    _networkAllowed = typeof m?.networkAllowed === "boolean" ? m.networkAllowed : undefined;
    notify();
  },
  /** `meta` with this document's trust in place of its own: a rewrite (the AI edit) can change the author and tags but
   *  never mark a foreign document as the user's or grant it the network. */
  keepTrust(meta?: DocMeta): DocMeta {
    const { foreign: _f, networkAllowed: _n, ...rest } = meta ?? {};
    const out: DocMeta = { ...rest };
    if (_foreign) out.foreign = true;
    if (_networkAllowed !== undefined) out.networkAllowed = _networkAllowed;
    return out;
  },
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
