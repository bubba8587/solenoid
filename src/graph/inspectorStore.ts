// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createToggleStore } from "./storeKit";
import { reportStore } from "./reportStore";

const s = createToggleStore();

let _focus: string | null = null;

function syncClass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("sol-inspector-docked", s.get());
}

export const inspectorStore = {
  subscribe: s.subscribe,
  get: s.get,
  getFocus: (): string | null => _focus,
  clearFocus(): void { _focus = null; },
  openFor(nodeId: string): void {
    _focus = nodeId;
    this.open();
  },
  open(): void {
    if (reportStore.isDocked()) reportStore.close();
    s.open();
    syncClass();
  },
  close(): void {
    _focus = null;
    s.close();
    syncClass();
  },
  toggle(): void {
    if (s.get()) this.close();
    else this.open();
  },
};
