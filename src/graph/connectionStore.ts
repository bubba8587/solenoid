// A connection node holds only a *reference*, never the data. Its fetched Frame is
// cached under key(), so an unrelated processGraph() re-hits neither network nor disk.
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

  subscribe,
  version,
};

// Node-forget seam: a deleted node's status/token must not linger for the tab's lifetime.
registerNodeForget((id) => connectionStore.forget(id));
registerNodeForgetAll(() => {
  const had = _states.size > 0 || _tokens.size > 0;
  _states.clear();
  _tokens.clear();
  if (had) notify();
});

/** Called by a background fetch once its data lands; debounced to the next tick so
 *  several sources resolving together coalesce into one processGraph. */
let _recalcQueued = false;
export function scheduleConnectionRecalc(): void {
  if (_recalcQueued) return;
  _recalcQueued = true;
  setTimeout(() => { _recalcQueued = false; void processGraph(); }, 0);
}

export async function refreshConnection(id: string): Promise<void> {
  _tokens.set(id, (_tokens.get(id) ?? 0) + 1);
  await processGraph();
}

export async function refreshAllConnections(): Promise<void> {
  _gen++;
  await processGraph();
}
