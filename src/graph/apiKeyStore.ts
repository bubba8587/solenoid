// [[B10]] reactFlowView (module-singleton store, storeKit), [[B13]] aiInScope, [[C105]] apiKeysStayLocal
import { createNotifier } from "./storeKit";

const LS_KEY = "solenoid.apiKeys";

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const { notify, subscribe, version } = createNotifier();
let keys: Record<string, string> = load();

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(keys));
  } catch {
    /* no localStorage (node/private mode) — in-memory only */
  }
}

export const apiKeyStore = {
  subscribe,
  version,
  get(provider: string): string {
    return keys[provider] ?? "";
  },
  has(provider: string): boolean {
    return !!keys[provider];
  },
  set(provider: string, key: string): void {
    const trimmed = key.trim();
    const next = { ...keys };
    if (trimmed) next[provider] = trimmed;
    else delete next[provider];
    keys = next;
    persist();
    notify();
  },
  remove(provider: string): void {
    if (!(provider in keys)) return;
    const next = { ...keys };
    delete next[provider];
    keys = next;
    persist();
    notify();
  },
  providers(): string[] {
    return Object.keys(keys);
  },
};
