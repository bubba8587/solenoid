// [[D32]] refreshOutsideRebuild (refreshConnection). Mechanics: specs/live-connections.md.
// A connection node holds only a *reference*, never the data. Its fetched Frame is
// cached under key(), so an unrelated processGraph() re-hits neither network nor disk.
import { createNotifier } from "./storeKit";
import { processGraph } from "./process";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { docMetaStore } from "./docMetaStore";
import { settingsStore } from "./settingsStore";
import { pushNotice } from "./noticeStore";

// "gated" = the per-document network permission (C2) has not been granted, so this
// node fetched nothing (the [[C38]] sinkRunButtonOnly mirror: armed, not fired).
export type ConnectionStatus = "idle" | "loading" | "ok" | "error" | "gated";

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

// ─── Per-document network permission (C2 — the [[C38]] sinkRunButtonOnly mirror) ─────────
// A FOREIGN document (opened / imported) fetches nothing until the user allows it.
// Own documents and the global "always allow" bypass the gate. State lives on the
// document's meta (docMetaStore, persisted in the sidecar); this reads it.

/** May the OPEN document's connection nodes fetch? Own doc, an always-allow setting,
 *  or an explicit per-doc grant → yes; a foreign, undecided doc → no. */
export function networkAllowed(): boolean {
  if (!docMetaStore.isForeign()) return true;
  if (settingsStore.get("alwaysAllowNetwork")) return true;
  return docMetaStore.networkAllowed() === true;
}

// Nodes that tried to fetch while gated (this doc), so the one prompt can count them
// and their cards can show the waiting state. Reset on doc rebuild (forgetAll).
const _gated = new Set<string>();
let _prompted = false;
let _promptQueued = false;

/** The fetch gate the connection nodes call BEFORE hitting the network: true = go,
 *  false = blocked (the node records itself gated and the one per-doc prompt is
 *  scheduled). */
export function requestNetwork(id: string): boolean {
  if (networkAllowed()) { _gated.delete(id); return true; }
  _gated.add(id);
  connectionStore.setState(id, { status: "gated" });
  if (!_prompted && !_promptQueued) {
    _promptQueued = true;
    // Next tick: every node gating on this recompute has registered, so N is right.
    setTimeout(() => {
      _promptQueued = false;
      if (_prompted || networkAllowed() || _gated.size === 0) return;
      _prompted = true;
      const n = _gated.size;
      pushNotice(
        `This document connects to ${n} ${n === 1 ? "service" : "services"}. Allow it to fetch?`,
        "warn",
        0, // sticky until dismissed or Allowed
        { label: "Allow", onClick: () => allowNetwork() },
      );
    }, 0);
  }
  return false;
}

/** Grant the open document's network permission (the notice's Allow, or Settings ▸ Data),
 *  persist it (docMetaStore → sidecar), and re-fetch everything that was gated. */
export function allowNetwork(): void {
  docMetaStore.setNetworkAllowed(true);
  _gated.clear();
  void refreshAllConnections();
}

// Node-forget seam: a deleted node's status/token must not linger for the tab's lifetime.
registerNodeForget((id) => { _gated.delete(id); connectionStore.forget(id); });
registerNodeForgetAll(() => {
  const had = _states.size > 0 || _tokens.size > 0;
  _states.clear();
  _tokens.clear();
  _gated.clear();
  _prompted = false; // a fresh document re-asks
  if (had) notify();
});

/** Called by a background fetch once its data lands; debounced to the next tick so
 *  several sources resolving together coalesce into one processGraph. */
let _recalcQueued = false;
// In-flight background loads, so a headless run can wait for every fetch/read to land
// and recompute once (the app never waits — scheduleConnectionRecalc re-runs per node).
const _inflight = new Set<Promise<unknown>>();

/** Register a background load; resolves/rejects like the original. */
export function trackInflight<T>(p: Promise<T>): Promise<T> {
  _inflight.add(p);
  const done = () => { _inflight.delete(p); };
  p.then(done, done);
  return p;
}

/** Resolves once every in-flight load registered so far has settled (errors included). */
export async function whenConnectionsSettled(): Promise<void> {
  while (_inflight.size > 0) await Promise.allSettled([..._inflight]);
}

/** True while any background load registered via trackInflight is still pending. */
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

/** "Refresh all connections": bumps the generation every connection node keys on, and
 *  notifies subscribers that re-read outside the engine (an Import Obsidian Note). */
export async function refreshAllConnections(): Promise<void> {
  _gen++;
  notify();
  await processGraph();
}
