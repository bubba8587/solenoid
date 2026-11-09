// [[C103]] untrustedContentSeams
import { createNotifier } from "./storeKit";
import { processGraph } from "./process";
import { allTopEditors } from "./activeGraph";
import type { GraphEditor } from "./graphEditor";
import type { Schemes } from "./schemes";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { docMetaStore } from "./docMetaStore";
import { settingsStore } from "./settingsStore";
import { pushNotice, dismissNotice } from "./noticeStore";
import { foreignCardStore } from "./foreignCardStore";

type ConnectionStatus = "idle" | "loading" | "ok" | "error" | "gated";

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

  landedCount(ids: Iterable<string>): number {
    let n = 0;
    for (const id of ids) n += _landed.get(id) ?? 0;
    return n;
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

function hasDeep(editor: GraphEditor<Schemes>, id: string): boolean {
  if (editor.getNode(id)) return true;
  return editor.getNodes().some((n) => {
    const inner = (n as unknown as { internalEditor?: GraphEditor<Schemes> }).internalEditor;
    return !!inner && hasDeep(inner, id);
  });
}

// A card inside a deleted composite is never forgotten one by one, so its timer checks before it fires.
function nodeExists(id: string): boolean {
  return allTopEditors().some((e) => hasDeep(e, id));
}


/** With `id`, for that card: a card someone else wrote, pasted into the user's own document, asks too. */
export function networkAllowed(id?: string): boolean {
  if (settingsStore.get("alwaysAllowNetwork")) return true;
  if (id && foreignCardStore.holds(id, "network")) return false;
  if (!docMetaStore.isForeign()) return true;
  return docMetaStore.networkAllowed() === true;
}

/** Whether anything here waits on the network grant: the foreign document, or a pasted card someone else wrote. */
export function networkWaits(): boolean {
  if (settingsStore.get("alwaysAllowNetwork")) return false;
  return (docMetaStore.isForeign() && docMetaStore.networkAllowed() !== true) || foreignCardStore.any("network");
}

const _gated = new Set<string>();
/** Gated cards whose value does not change with the connection counter, marked edited once allowed. */
const _gatedCards = new Map<string, { edited(): void }>();
let _prompted = false;
let _promptQueued = false;
let _promptNotice: number | undefined;
let _docGeneration = 0;

export function requestNetwork(id: string, card?: { edited(): void }): boolean {
  if (networkAllowed(id)) { _gated.delete(id); _gatedCards.delete(id); return true; }
  if (card) _gatedCards.set(id, card);
  askNetwork(id);
  connectionStore.setState(id, { status: "gated" });
  return false;
}

/** Holds `key` (a card, or the markdown images a render withheld) for the one prompt. It notifies nothing, so a
 *  render may ask: the prompt waits a tick, until every gated card has asked. */
export function askNetwork(key: string): void {
  _gated.add(key);
  if (!_prompted && !_promptQueued) {
    _promptQueued = true;
    setTimeout(() => {
      _promptQueued = false;
      if (_prompted || !networkWaits() || _gated.size === 0) return;
      _prompted = true;
      const n = _gated.size;
      const generation = _docGeneration;
      _promptNotice = pushNotice(
        `This document connects to ${n} ${n === 1 ? "service" : "services"}. Allow it to fetch?`,
        "warn",
        0,
        { label: "Allow", onClick: () => { if (generation === _docGeneration) allowNetwork(); } },
      );
    }, 0);
  }
}

export function allowNetwork(): void {
  if (docMetaStore.isForeign()) docMetaStore.setNetworkAllowed(true);
  foreignCardStore.allow("network");
  _gated.clear();
  for (const card of _gatedCards.values()) card.edited();
  _gatedCards.clear();
  void refreshAllConnections();
}

registerNodeForget((id) => { _gated.delete(id); _gatedCards.delete(id); connectionStore.forget(id); });
registerNodeForgetAll(() => {
  const had = _states.size > 0 || _tokens.size > 0;
  _states.clear();
  _tokens.clear();
  _live.clear();
  _landed.clear();
  for (const id of [..._timers.keys()]) clearTimer(id);
  _gated.clear();
  _gatedCards.clear();
  _prompted = false;
  _docGeneration++;
  if (_promptNotice !== undefined) { dismissNotice(_promptNotice); _promptNotice = undefined; }
  if (had) notify();
});

let _recalcQueued = false;
const _inflight = new Map<Promise<unknown>, string | undefined>();

/** `id` names the card the load belongs to, so a holder of that card can wait on it. */
export function trackInflight<T>(p: Promise<T>, id?: string): Promise<T> {
  _inflight.set(p, id);
  const done = () => { _inflight.delete(p); };
  p.then(done, done);
  return p;
}

/** A card's background fetch: tracked until it has landed, then one coalesced recompute. */
export function fetchInBackground(id: string, p: Promise<unknown>): void {
  void trackInflight(p.then(() => scheduleConnectionRecalc(id)), id);
}

function pendingFor(ids?: Iterable<string>): Promise<unknown>[] {
  if (!ids) return [..._inflight.keys()];
  const want = new Set(ids);
  return [..._inflight].filter(([, id]) => id !== undefined && want.has(id)).map(([p]) => p);
}

/** With `ids`, only the loads of those cards. */
export async function whenConnectionsSettled(ids?: Iterable<string>): Promise<void> {
  const scope = ids ? [...ids] : undefined;
  for (let pending = pendingFor(scope); pending.length > 0; pending = pendingFor(scope)) {
    await Promise.allSettled(pending);
  }
}

/** With `ids`, only the loads of those cards. */
export function hasInflightConnections(ids?: Iterable<string>): boolean {
  return ids ? pendingFor(ids).length > 0 : _inflight.size > 0;
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
