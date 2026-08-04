// External-data connection layer. A "connection" node holds only a *reference* (a
// URL or a folder-relative filename) — never the data — and fetches a Frame on
// demand. This store is the shared refresh + status machinery every such node
// plugs into, mirroring the volatile-recalc pattern in
// process.ts (getRecalcGen / requestRecalc) but for async, cached fetches.
//
// Caching model: a connection caches its fetched Frame keyed by a composite token
// "<globalGen>:<nodeToken>:<reference>". An ordinary processGraph() (triggered by
// editing some unrelated node) leaves all three unchanged, so the connection
// returns its cache and does NOT re-hit the network/disk. A refresh bumps a token,
// which changes the key and forces exactly the intended nodes to re-fetch:
//   • refreshConnection(id)  → bumps that node's token (this one re-fetches)
//   • refreshAllConnections()→ bumps the global gen (every connection re-fetches)
import { createNotifier } from "./storeKit";
import { processGraph } from "./process";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

export type ConnectionStatus = "idle" | "loading" | "ok" | "error";

export interface ConnectionState {
  status: ConnectionStatus;
  /** Error text (status "error") — shown on the node. */
  message?: string;
  rows?: number;
  cols?: number;
  /** epoch ms of the last successful fetch. */
  fetchedAt?: number;
}

const IDLE: ConnectionState = { status: "idle" };

let _gen = 0;
const _tokens = new Map<string, number>();
const _states = new Map<string, ConnectionState>();
const { notify, subscribe, version } = createNotifier();

export const connectionStore = {
  /** Global generation — bumped by "Refresh all". Part of every cache key. */
  gen: () => _gen,
  /** Per-node refresh token — bumped by a single node's refresh button. */
  token: (id: string) => _tokens.get(id) ?? 0,
  /** The composite cache key a connection node compares against. */
  key: (id: string, reference: string) => `${_gen}:${_tokens.get(id) ?? 0}:${reference}`,

  getState: (id: string): ConnectionState => _states.get(id) ?? IDLE,
  setState(id: string, s: ConnectionState) {
    _states.set(id, s);
    notify();
  },
  /** Drop a node's status + token (call when the node is removed). */
  forget(id: string) {
    const had = _states.delete(id);
    _tokens.delete(id);
    if (had) notify();
  },

  /** Subscribe for status changes (useSyncExternalStore). */
  subscribe,
  version,
};

// Self-register on the node-forget seam like every other node-keyed store
// (collapseStore, pinStore, …), so a deleted node's status/token doesn't sit in
// the Maps for the tab's lifetime.
registerNodeForget((id) => connectionStore.forget(id));
registerNodeForgetAll(() => {
  const had = _states.size > 0 || _tokens.size > 0;
  _states.clear();
  _tokens.clear();
  if (had) notify();
});

// A source node that fetches in the BACKGROUND (so its data() can stay
// synchronous and off the engine's async critical path) calls this once its data
// lands, to recompute the graph with the new frame. Debounced to the next tick so
// several sources resolving together coalesce into a single processGraph.
let _recalcQueued = false;
export function scheduleConnectionRecalc(): void {
  if (_recalcQueued) return;
  _recalcQueued = true;
  setTimeout(() => { _recalcQueued = false; void processGraph(); }, 0);
}

/** Re-fetch a single connection node: bump its token, then recompute. */
export async function refreshConnection(id: string): Promise<void> {
  _tokens.set(id, (_tokens.get(id) ?? 0) + 1);
  await processGraph();
}

/** Re-fetch every connection (Excel's "Refresh All"): bump the global gen. */
export async function refreshAllConnections(): Promise<void> {
  _gen++;
  await processGraph();
}
