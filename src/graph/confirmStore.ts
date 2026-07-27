// In-app confirmation dialog, module-store style (like cableState /
// dockedNodeStore). Used instead of window.confirm so it renders as a
// real DOM modal — works identically in browser dev and in the Tauri
// desktop WebView, where window.confirm is unreliable.
//
// Usage:  if (await requestConfirm("Do the thing?")) { ... }

import { createNotifier } from "./storeKit";

export type ConfirmOptions = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let _pending: Pending | null = null;
const { notify, subscribe } = createNotifier();

/** Open a confirmation dialog; resolves true (confirm) or false (cancel). */
export function requestConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;
  return new Promise<boolean>((resolve) => {
    // If one is somehow already open, treat it as canceled first.
    _pending?.resolve(false);
    _pending = { ...options, resolve };
    notify();
  });
}

/** Resolve the open dialog. Called by the ConfirmDialog buttons / keys. */
export function answerConfirm(ok: boolean) {
  const p = _pending;
  _pending = null;
  notify();
  p?.resolve(ok);
}

export const confirmStore = {
  get: () => _pending,
  subscribe,
};
