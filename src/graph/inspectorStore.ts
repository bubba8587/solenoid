// Open state for the node Inspector — the docked right panel behind the top
// bar's (i) button. Mirrors reportStore's dock mechanics: the root class
// `html.sol-inspector-docked` drives the canvas squeeze in plain CSS, and the
// two right-side docks are mutually exclusive (opening one undocks the other;
// InspectorPanel watches reportStore for the reverse direction).
import { createToggleStore } from "./storeKit";
import { reportStore } from "./reportStore";

const s = createToggleStore();

function syncClass(): void {
  document.documentElement.classList.toggle("sol-inspector-docked", s.get());
}

export const inspectorStore = {
  subscribe: s.subscribe,
  get: s.get,
  open(): void {
    reportStore.setDocked(false);
    s.open();
    syncClass();
  },
  close(): void {
    s.close();
    syncClass();
  },
  toggle(): void {
    if (s.get()) this.close();
    else this.open();
  },
};
