// [[B18]] safeToShare, [[C103]] untrustedContentSeams
// Cards someone else wrote: a foreign card keeps asking wherever it is pasted until the user allows its scripts
// (scriptGate.ts) and fetches (connectionStore.ts); a foreign document asks for all its cards at once and marks none.
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

export interface ForeignMark { scripts?: true; network?: true }

const _marks = new Map<string, ForeignMark>();
const { notify, subscribe, version } = createNotifier();

export const foreignCardStore = {
  subscribe,
  version,
  get: (id: string): ForeignMark | undefined => _marks.get(id),
  holds: (id: string, what: keyof ForeignMark): boolean => _marks.get(id)?.[what] === true,
  any: (what: keyof ForeignMark): boolean => [..._marks.values()].some((m) => m[what]),
  set(id: string, mark: ForeignMark | undefined) {
    if (!mark || (!mark.scripts && !mark.network)) { if (_marks.delete(id)) notify(); return; }
    _marks.set(id, { ...(mark.scripts ? { scripts: true } : {}), ...(mark.network ? { network: true } : {}) });
    notify();
  },
  /** The user allowed `what` for every card someone else wrote. */
  allow(what: keyof ForeignMark) {
    let changed = false;
    for (const [id, m] of _marks) {
      if (!m[what]) continue;
      changed = true;
      const rest: ForeignMark = { ...m };
      delete rest[what];
      if (rest.scripts || rest.network) _marks.set(id, rest); else _marks.delete(id);
    }
    if (changed) notify();
  },
};

registerNodeForget((id) => { if (_marks.delete(id)) notify(); });
registerNodeForgetAll(() => { if (_marks.size) { _marks.clear(); notify(); } });
