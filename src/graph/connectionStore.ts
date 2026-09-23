// [[D32]] refreshOutsideRebuild, [[C103]] untrustedContentSeams
import { createNotifier } from "./storeKit";
import { processGraph } from "./process";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { docMetaStore } from "./docMetaStore";
import { settingsStore } from "./settingsStore";
import { pushNotice } from "./noticeStore";

export type ConnectionStatus = "idle" | "loading" | "ok" | "error" | "gated";

export interface ConnectionState {
  status: ConnectionStatus;
  message?: string;
  rows?: number;
  cols?: number;
  fetchedAt?: number;
}

const IDLE: ConnectionState = { status: "idle" };

let _gen = 0;
const _tokens = new Map<string, number>();
const _states = new Map<string, ConnectionState>();
const { notify, subscribe, version } = createNotifier();

export const connectionStore = {
  gen: () => _gen,
  token: (id: string) => _tokens.get(id) ?? 0,
  key: (id: string, reference: string) => `${_gen}:${_tokens.get(id) ?? 0}:${reference}`,

  getState: (id: string): ConnectionState => _states.get(id) ?? IDLE,
  setState(id: string, s: ConnectionState) {
    _states.set(id, s);
    notify();
  },
  forget(id: string) {
    const had = _states.delete(id);
    _tokens.delete(id);
    if (had) notify();
  },

  subscribe,
  version,
};


export function networkAllowed(): boolean {
  if (!docMetaStore.isForeign()) return true;
  if (settingsStore.get("alwaysAllowNetwork")) return true;
  return docMetaStore.networkAllowed() === true;
}

const _gated = new Set<string>();
let _prompted = false;
let _promptQueued = false;

export function requestNetwork(id: string): boolean {
  if (networkAllowed()) { _gated.delete(id); return true; }
  _gated.add(id);
  connectionStore.setState(id, { status: "gated" });
  if (!_prompted && !_promptQueued) {
    _promptQueued = true;
    setTimeout(() => {
      _promptQueued = false;
      if (_prompted || networkAllowed() || _gated.size === 0) return;
      _prompted = true;
      const n = _gated.size;
      pushNotice(
        `This document connects to ${n} ${n === 1 ? "service" : "services"}. Allow it to fetch?`,
        "warn",
        0,
        { label: "Allow", onClick: () => allowNetwork() },
      );
    }, 0);
  }
  return false;
}

export function allowNetwork(): void {
  docMetaStore.setNetworkAllowed(true);
  _gated.clear();
  void refreshAllConnections();
}

registerNodeForget((id) => { _gated.delete(id); connectionStore.forget(id); });
registerNodeForgetAll(() => {
  const had = _states.size > 0 || _tokens.size > 0;
  _states.clear();
  _tokens.clear();
  _gated.clear();
  _prompted = false;
  if (had) notify();
});

let _recalcQueued = false;
const _inflight = new Set<Promise<unknown>>();

export function trackInflight<T>(p: Promise<T>): Promise<T> {
  _inflight.add(p);
  const done = () => { _inflight.delete(p); };
  p.then(done, done);
  return p;
}

export async function whenConnectionsSettled(): Promise<void> {
  while (_inflight.size > 0) await Promise.allSettled([..._inflight]);
}

export function hasInflightConnections(): boolean {
  return _inflight.size > 0;
}

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
  notify();
  await processGraph();
}
