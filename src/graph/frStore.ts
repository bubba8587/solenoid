// [[C8]] declareOnce (the Reference generates from nodeCatalog)
import { createNotifier } from "./storeKit";

export type FrTab = "reference" | "sockets" | "help" | "knap" | "notes";

let _open = false;
let _tab: FrTab = "reference";
const { notify, subscribe, version } = createNotifier();

export const frStore = {
  get: (): boolean => _open,
  tab: (): FrTab => _tab,
  version,
  subscribe,

  open(tab?: FrTab) {
    if (tab) _tab = tab;
    if (!_open) _open = true;
    notify();
  },
  close() { if (_open) { _open = false; notify(); } },
  toggle() { _open = !_open; notify(); },
  setTab(tab: FrTab) { if (_tab !== tab) { _tab = tab; notify(); } },
};
