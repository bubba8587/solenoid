// Transient in-app notices ("toasts"), module-store style like confirmStore.
// Used instead of window.alert — which is unreliable in the Tauri WebView (the
// same reason confirmStore exists for window.confirm) — to surface things the
// user must not silently miss: a partially-loaded file, a load that was rolled
// back, autosave failing. Rendered by <NoticeToasts/> (mounted near the canvas
// root); readable/writable from either React root.

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

/**
 * Show a notice. Returns its id so a sticky notice (ttl 0) can later be
 * dismissed programmatically (e.g. clear the "autosave failing" banner once a
 * save succeeds again).
 */
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
