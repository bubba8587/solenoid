// [[C130]] rustCore
import { useSyncExternalStore } from "react";
import { initFrameBackend } from "./frameBackend";

let ready = false;
let started: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Starts loading the core once. The app's chrome renders meanwhile; a surface that builds a graph waits on
 *  `useCoreReady`. A load that fails stays not-ready, and its rejection reaches the unhandled-rejection notice. */
export function startCore(): Promise<void> {
  started ??= initFrameBackend().then(() => {
    ready = true;
    for (const fn of listeners) fn();
  });
  return started;
}

export function useCoreReady(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => ready,
  );
}
