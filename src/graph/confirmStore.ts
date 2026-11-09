// [[A1]] visualGraphCalculator, [[C106]] noNativeDialogs

import { createNotifier } from "./storeKit";

type ConfirmOptions = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A third answer between the two (Discard, beside Keep and Cancel); `requestChoice` reads it. */
  altLabel?: string;
};

type ConfirmChoice = "confirm" | "alt" | "cancel";
type Pending = ConfirmOptions & { resolve: (choice: ConfirmChoice) => void };

let _pending: Pending | null = null;
const { notify, subscribe } = createNotifier();

export function requestConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;
  return requestChoice({ ...options, altLabel: undefined }).then((c) => c === "confirm");
}

/** A dialog with a third button (`altLabel`): which of the three the user answered; Escape and the overlay cancel. */
export function requestChoice(options: ConfirmOptions): Promise<ConfirmChoice> {
  return new Promise<ConfirmChoice>((resolve) => {
    _pending?.resolve("cancel");
    _pending = { ...options, resolve };
    notify();
  });
}

export function answerConfirm(answer: boolean | ConfirmChoice) {
  const p = _pending;
  _pending = null;
  notify();
  p?.resolve(answer === true ? "confirm" : answer === false ? "cancel" : answer);
}

export const confirmStore = {
  get: () => _pending,
  subscribe,
};
