// [[B18]] safeToShare, [[C103]] untrustedContentSeams
// A foreign document's Script cards wait until the user lets its scripts run, granted per document as the network is
// (connectionStore.ts); the worker has no network already (`script-sandbox.md`), this keeps the code from running.
import { docMetaStore } from "./docMetaStore";
import { foreignCardStore } from "./foreignCardStore";
import { pushNotice, dismissNotice } from "./noticeStore";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { createNotifier } from "./storeKit";

const _waiting = new Map<string, { edited(): void }>();
let _queued = false;
let _prompted = false;
let _notice: number | undefined;
let _generation = 0;
const { notify, subscribe, version } = createNotifier();

export const scriptGate = { subscribe, version, waiting: (id: string) => _waiting.has(id) };

/** With `id`, for that card: a script someone else wrote, pasted into the user's own document, asks too. */
export function scriptsAllowed(id?: string): boolean {
  if (id && foreignCardStore.holds(id, "scripts")) return false;
  return !docMetaStore.isForeign() || docMetaStore.scriptsAllowed() === true;
}

/** Whether anything here waits to run: the foreign document's scripts, or a pasted script someone else wrote. */
export function scriptsWait(): boolean {
  return (docMetaStore.isForeign() && docMetaStore.scriptsAllowed() !== true) || foreignCardStore.any("scripts");
}

/** True when the card may run; otherwise it waits, and one prompt asks for every waiting card. */
export function requestScript(id: string, card: { edited(): void }): boolean {
  if (scriptsAllowed(id)) { _waiting.delete(id); return true; }
  const fresh = !_waiting.has(id);
  _waiting.set(id, card);
  if (fresh) queueMicrotask(notify);
  if (!_prompted && !_queued) {
    _queued = true;
    setTimeout(() => {
      _queued = false;
      if (_prompted || !scriptsWait() || _waiting.size === 0) return;
      _prompted = true;
      const n = _waiting.size;
      const generation = _generation;
      _notice = pushNotice(
        `This document has ${n} ${n === 1 ? "script" : "scripts"} someone else wrote. Run ${n === 1 ? "it" : "them"}?`,
        "warn",
        0,
        { label: "Run", onClick: () => { if (generation === _generation) void allowScripts(); } },
      );
    }, 0);
  }
  return false;
}

export async function allowScripts(): Promise<void> {
  if (docMetaStore.isForeign()) docMetaStore.setScriptsAllowed(true);
  foreignCardStore.allow("scripts");
  const cards = [..._waiting.values()];
  _waiting.clear();
  if (_notice !== undefined) { dismissNotice(_notice); _notice = undefined; }
  notify();
  for (const c of cards) c.edited();
  const { processGraph } = await import("./process");
  await processGraph();
}

registerNodeForget((id) => { if (_waiting.delete(id)) notify(); });
registerNodeForgetAll(() => {
  _waiting.clear();
  _prompted = false;
  _generation++;
  if (_notice !== undefined) { dismissNotice(_notice); _notice = undefined; }
  notify();
});
