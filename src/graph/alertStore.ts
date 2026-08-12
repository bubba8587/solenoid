import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { pushNotice, type NoticeTone } from "./noticeStore";

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

const MAX_EVENTS = 50;

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

  dismiss(id: number): void {
    const next = _events.filter((e) => e.id !== id);
    if (next.length !== _events.length) { _events = next; notify(); }
  },

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

/** The single entry point: logs to the HUD panel AND raises a matching-tone toast. */
export function fireAlert(e: Omit<AlertEvent, "id" | "time">): void {
  alertStore.push(e);
  pushNotice(e.message, ALERT_TONE[e.kind]);
}

registerNodeForget((nodeId) => alertStore.removeForNode(nodeId));
registerNodeForgetAll(() => alertStore.clear());
