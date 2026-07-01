// Fired-alert log: a screen-fixed list of recent alert events, the companion to
// pinStore for the right-side HUD. An Alert node calls fireAlert() on the rising
// edge of its trigger condition (see nodes/display.ts), which both records an
// event here AND raises a toast. The log is transient (not persisted) — it's a
// running history of "this fired", cleared on reload like the toasts themselves.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { pushNotice, type NoticeTone } from "./noticeStore";

// The "kinds" an Alert can be set to. Each maps to a toast tone and a HUD color,
// so the three are visually distinct ("a couple different kinds").
export type AlertKind = "info" | "warning" | "critical";

export const ALERT_TONE: Record<AlertKind, NoticeTone> = {
  info: "info",
  warning: "warn",
  critical: "error",
};

export interface AlertEvent {
  id: number;
  nodeId: string;
  label: string;
  kind: AlertKind;
  message: string;
  time: number; // Date.now()
}

const MAX_EVENTS = 50; // keep the log bounded; oldest fall off

let _events: AlertEvent[] = [];
let _seq = 0;
const { notify, subscribe, version } = createNotifier();

export const alertStore = {
  list: (): readonly AlertEvent[] => _events,

  /** Record a fired alert (newest first). Trims to the cap. */
  push(e: Omit<AlertEvent, "id" | "time">): void {
    const ev: AlertEvent = { ...e, id: ++_seq, time: Date.now() };
    _events = [ev, ..._events].slice(0, MAX_EVENTS);
    notify();
  },

  /** Drop one logged event. */
  dismiss(id: number): void {
    const next = _events.filter((e) => e.id !== id);
    if (next.length !== _events.length) { _events = next; notify(); }
  },

  /** Drop every event raised by one node (its noderemoved cleanup). */
  removeForNode(nodeId: string): void {
    const next = _events.filter((e) => e.nodeId !== nodeId);
    if (next.length !== _events.length) { _events = next; notify(); }
  },

  clear(): void {
    if (_events.length > 0) { _events = []; notify(); }
  },

  subscribe,
  version,
};

/**
 * Raise an alert: log it to the HUD panel AND surface a toast of the matching
 * tone. The single entry point the Alert node calls when its condition fires.
 */
export function fireAlert(e: Omit<AlertEvent, "id" | "time">): void {
  alertStore.push(e);
  pushNotice(e.message, ALERT_TONE[e.kind]);
}

// A deleted Alert node drops its logged events — same lifecycle convention as
// the other node-keyed stores.
registerNodeForget((nodeId) => alertStore.removeForNode(nodeId));
registerNodeForgetAll(() => alertStore.clear());
