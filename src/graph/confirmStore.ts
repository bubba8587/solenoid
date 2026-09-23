// [[B10]] reactFlowView, [[C106]] noNativeDialogs

import { createNotifier } from "./storeKit";

export type ConfirmOptions = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let _pending: Pending | null = null;
const { notify, subscribe } = createNotifier();

export function requestConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;
  return new Promise<boolean>((resolve) => {
    _pending?.resolve(false);
    _pending = { ...options, resolve };
    notify();
  });
}

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
