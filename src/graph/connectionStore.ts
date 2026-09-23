// [[D32]] refreshOutsideRebuild, [[C103]] untrustedContentSeams
import { createNotifier } from "./storeKit";
import { processGraph, getEditor } from "./process";
import { getOwningEditor } from "./activeGraph";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
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
const _live = new Set<string>();
const _landed = new Map<string, number>();
const _timers = new Map<string, { minutes: number; handle: ReturnType<typeof setInterval> }>();
const { notify, subscribe, version } = createNotifier();

export const connectionStore = {
  gen: () => _gen,
  token: (id: string) => _tokens.get(id) ?? 0,
  key(id: string, reference: string): string {
    _live.add(id);
    return `${_gen}:${_tokens.get(id) ?? 0}:${reference}`;
  },

  /** What a holder of these node ids must re-key on: every refresh and every landed fetch of a live card among them. */
  liveStamp(ids: Iterable<string>): string {
    const parts: string[] = [];
    for (const id of ids) if (_live.has(id)) parts.push(`${id}:${_tokens.get(id) ?? 0}:${_landed.get(id) ?? 0}`);
    return parts.length ? `${_gen}|${parts.join(",")}` : "";
  },

  /** The card's own `data()` keeps its timer in step, so a card that is not mounted still refreshes. */
  autoRefresh(id: string, minutes: number) {
    _live.add(id);
    const m = Math.max(0, Math.round(minutes || 0));
    const cur = _timers.get(id);
    if ((cur?.minutes ?? 0) === m) return;
    clearTimer(id);
    if (m <= 0) return;
    const handle = setInterval(() => {
      if (!nodeExists(id)) { clearTimer(id); return; }
      void refreshConnection(id);
    }, m * 60_000);
    _timers.set(id, { minutes: m, handle });
  },

  autoRefreshMinutes: (id: string) => _timers.get(id)?.minutes ?? 0,

  getState: (id: string): ConnectionState => _states.get(id) ?? IDLE,
  setState(id: string, s: ConnectionState) {
    _states.set(id, s);
    notify();
  },
  forget(id: string) {
    const had = _states.delete(id);
    _tokens.delete(id);
    _live.delete(id);
    _landed.delete(id);
    clearTimer(id);
    if (had) notify();
  },

  subscribe,
  version,
};

function clearTimer(id: string): void {
  const t = _timers.get(id);
  if (t) clearInterval(t.handle);
  _timers.delete(id);
}

function hasDeep(editor: NodeEditor<Schemes>, id: string): boolean {
  if (editor.getNode(id)) return true;
  return editor.getNodes().some((n) => {
    const inner = (n as unknown as { internalEditor?: NodeEditor<Schemes> }).internalEditor;
    return !!inner && hasDeep(inner, id);
  });
}

// A card inside a deleted composite is never forgotten one by one, so its timer checks before it fires.
function nodeExists(id: string): boolean {
  const main = getEditor();
  const owner = getOwningEditor(id);
  return (!!owner && hasDeep(owner, id)) || (!!main && hasDeep(main, id));
}


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
  _live.clear();
  _landed.clear();
  for (const id of [..._timers.keys()]) clearTimer(id);
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

/** `id` names the card whose fetch landed, so a heavy composite holding it turns stale. */
export function scheduleConnectionRecalc(id?: string): void {
  if (id) _landed.set(id, (_landed.get(id) ?? 0) + 1);
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
