// [[B10]] reactFlowView, [[C106]] noNativeDialogs

import { createNotifier } from "./storeKit";

export type NoticeTone = "info" | "warn" | "error";

export interface NoticeAction {
  label: string;
  onClick: () => void;
}

export interface Notice {
  id: number;
  message: string;
  tone: NoticeTone;
  action?: NoticeAction;
}

const DEFAULT_TTL = 6500;

let _notices: Notice[] = [];
let _seq = 0;
const { notify, subscribe } = createNotifier();

export function pushNotice(message: string, tone: NoticeTone = "info", ttl = DEFAULT_TTL, action?: NoticeAction): number {
  const id = ++_seq;
  _notices = [..._notices, { id, message, tone, ...(action ? { action } : {}) }];
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
