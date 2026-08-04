// Transient in-app notices, used instead of window.alert — unreliable in the Tauri WebView
// — for things the user must not silently miss.

import { createNotifier } from "./storeKit";

export type NoticeTone = "info" | "warn" | "error";

export interface Notice {
  id: number;
  message: string;
  tone: NoticeTone;
}

const DEFAULT_TTL = 6500; // ms before auto-dismiss; 0 = sticky (until dismissed)

let _notices: Notice[] = [];
let _seq = 0;
const { notify, subscribe } = createNotifier();

/** Returns the notice id, so a sticky notice (ttl 0) can be dismissed programmatically. */
export function pushNotice(message: string, tone: NoticeTone = "info", ttl = DEFAULT_TTL): number {
  const id = ++_seq;
  _notices = [..._notices, { id, message, tone }];
  notify();
  if (ttl > 0 && typeof setTimeout !== "undefined") {
    setTimeout(() => dismissNotice(id), ttl);
  }
  return id;
}

export function dismissNotice(id: number): void {
  const next = _notices.filter((n) => n.id !== id);
  if (next.length !== _notices.length) {
    _notices = next;
    notify();
  }
}

export const noticeStore = {
  get: () => _notices,
  subscribe,
};
