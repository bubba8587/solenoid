// [[reports-and-notes#HTML pages]] (module-singleton store, storeKit)
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { isGraphRebuilding } from "./process";
import { nodeNameStore } from "./nodeNameStore";

/** A page as the store holds it: its id, and the addressable name a save keeps (an undo reloads the graph under new
 *  ids, and the name finds it). */
interface Held { id: string; name: string | undefined }

let _open: Held | null = null;
/** The pages a link left, the last on top: Back returns to them before it leaves the pages. */
let _trail: Held[] = [];
/** The browser history entries the pages pushed, so Back (the browser's, Android's) steps through the pages instead
 *  of leaving the app, and a close unwinds them. */
let _pushed = 0;
/** A history step the store made itself, whose popstate is not a Back. */
let _ownPops = 0;
const { notify, subscribe, version } = createNotifier();

const idOf = (h: Held | null): string | null => (h ? (h.name ? nodeNameStore.byName(h.name) : undefined) ?? h.id : null);
const hold = (id: string): Held => ({ id, name: nodeNameStore.get(id) });
const hasHistory = () => typeof window !== "undefined" && typeof window.history?.pushState === "function";

function push(): void {
  if (!hasHistory()) return;
  window.history.pushState({ ...(window.history.state ?? {}), solPage: _pushed + 1 }, "", window.location.href);
  _pushed++;
}

/** Leave every page and give back the history entries they took. */
function shut(unwind: boolean): void {
  _open = null;
  _trail = [];
  if (unwind && _pushed > 0 && hasHistory()) { _ownPops++; window.history.go(-_pushed); }
  _pushed = 0;
  notify();
}

/** One step back: the page a link left, or the canvas from the first page. */
function stepBack(): void {
  if (!_open) return;
  const prev = _trail.pop();
  if (prev && idOf(prev)) { _open = prev; notify(); return; }
  shut(false);
}

export const htmlPageStore = {
  version,
  subscribe,
  openNodeId: (): string | null => idOf(_open),
  /** Open a page; `fromLink` keeps the one showing on the trail, so Back returns to it. */
  open(nodeId: string, fromLink = false) {
    if (idOf(_open) === nodeId) return;
    if (_open && fromLink) _trail.push(_open);
    else if (_open) _trail = [];
    if (!_open || fromLink) push();
    _open = hold(nodeId);
    notify();
  },
  /** Back: one page at a time, through the browser's history when the pages pushed to it. */
  back() {
    if (!_open) return;
    if (_pushed > 0 && hasHistory()) window.history.back();
    else stepBack();
  },
  /** Close every page (the corner button, Esc). */
  close() {
    if (!_open) return;
    shut(true);
  },
  /** How many pages Back returns through before the canvas, for tests. */
  trailLength: () => _trail.length,
};

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (_ownPops > 0) { _ownPops--; return; }
    if (!_open) return;
    _pushed = Math.max(0, _pushed - 1);
    stepBack();
  });
}

// Not while the graph rebuilds: the page stays open through an undo, and its name finds the reloaded node.
registerNodeForget((id) => { if (id === htmlPageStore.openNodeId() && !isGraphRebuilding()) htmlPageStore.close(); });
registerNodeForgetAll(() => { if (!isGraphRebuilding()) htmlPageStore.close(); });
