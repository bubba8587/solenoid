import { createNotifier } from "./storeKit";

export type FrTab = "reference" | "excel" | "sockets" | "help" | "knap" | "notes";

let _open = false;
let _tab: FrTab = "reference";
/** What the Reference shows on its next open ("pack:<id>" or "card:<type>"), taken once by the panel. */
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
  /** Opens the Reference on one card's page, set to `op` when given. */
  openCard(type: string, op?: string) {
    _focus = `card:${type}${op ? `#${op}` : ""}`;
    _tab = "reference";
    _open = true;
    notify();
  },
  takeFocus(): string | null { const f = _focus; _focus = null; return f; },
  close() { if (_open) { _open = false; notify(); } },
  toggle() { _open = !_open; notify(); },
  setTab(tab: FrTab) { if (_tab !== tab) { _tab = tab; notify(); } },
};
