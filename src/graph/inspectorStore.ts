// Open state for the node Inspector — the docked right panel behind the top
// bar's (i) button. Mirrors reportStore's dock mechanics: the root class
// `html.sol-inspector-docked` drives the canvas squeeze in plain CSS, and the
// two right-side docks are mutually exclusive (opening one closes the other;
// InspectorPanel watches reportStore for the reverse direction).
import { createToggleStore } from "./storeKit";
import { reportStore } from "./reportStore";

const s = createToggleStore();

// An explicit "inspect THIS node" (the context menu's (i)) outranks a stale
// selection until the user selects something new; InspectorPanel clears it.
let _focus: string | null = null;

function syncClass(): void {
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
    // The two right docks are exclusive and the swap is symmetric: the one that
    // opens last takes the slot. Undocking the report instead dropped a modal with
    // a backdrop over the inspector that had just opened.
    if (reportStore.isDocked()) reportStore.close();
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
