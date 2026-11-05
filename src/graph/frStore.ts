import { createNotifier } from "./storeKit";

export type FrTab = "reference" | "sockets" | "help" | "knap" | "notes";

let _open = false;
let _tab: FrTab = "reference";
/** A Reference filter to show on the next open (a groupKey or "pack:<id>"), taken once by the panel. */
let _focus: string | null = null;
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
  /** Opens the Reference on one pack's cards and functions. */
  openPack(packId: string) {
    _focus = `pack:${packId}`;
    _tab = "reference";
    _open = true;
    notify();
  },
  takeFocus(): string | null { const f = _focus; _focus = null; return f; },
  close() { if (_open) { _open = false; notify(); } },
  toggle() { _open = !_open; notify(); },
  setTab(tab: FrTab) { if (_tab !== tab) { _tab = tab; notify(); } },
};
