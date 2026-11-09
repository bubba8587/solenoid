// [[B18]] safeToShare, [[C103]] untrustedContentSeams
// Cards someone else wrote: a foreign card keeps asking wherever it is pasted until the user allows its scripts
// (scriptGate.ts) and fetches (connectionStore.ts); a foreign document asks for all its cards at once and marks none.
// `elsewhere` says only who wrote the card, so no Allow clears it: its File Link asks before opening and its fetches
// never reach this computer or the local network, as the foreign document's own do.
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { docMetaStore } from "./docMetaStore";

export interface ForeignMark { scripts?: true; network?: true; elsewhere?: true }

const marked = (m: ForeignMark): boolean => !!(m.scripts || m.network || m.elsewhere);

const _marks = new Map<string, ForeignMark>();
const { notify, subscribe, version } = createNotifier();

export const foreignCardStore = {
  subscribe,
  version,
  get: (id: string): ForeignMark | undefined => _marks.get(id),
  holds: (id: string, what: keyof ForeignMark): boolean => _marks.get(id)?.[what] === true,
  any: (what: keyof ForeignMark): boolean => [..._marks.values()].some((m) => m[what]),
  set(id: string, mark: ForeignMark | undefined) {
    if (!mark || !marked(mark)) { if (_marks.delete(id)) notify(); return; }
    _marks.set(id, {
      ...(mark.scripts ? { scripts: true } : {}),
      ...(mark.network ? { network: true } : {}),
      ...(mark.elsewhere ? { elsewhere: true } : {}),
    });
    notify();
  },
  /** The user allowed `what` for every card someone else wrote. */
  allow(what: "scripts" | "network") {
    let changed = false;
    for (const [id, m] of _marks) {
      if (!m[what]) continue;
      changed = true;
      const rest: ForeignMark = { ...m };
      delete rest[what];
      if (marked(rest)) _marks.set(id, rest); else _marks.delete(id);
    }
    if (changed) notify();
  },
};

/** Whether someone else wrote this: the foreign document, or with `id`, a card pasted out of one. */
export function writtenElsewhere(id?: string): boolean {
  return docMetaStore.isForeign() || (id !== undefined && foreignCardStore.holds(id, "elsewhere"));
}

registerNodeForget((id) => { if (_marks.delete(id)) notify(); });
registerNodeForgetAll(() => { if (_marks.size) { _marks.clear(); notify(); } });
