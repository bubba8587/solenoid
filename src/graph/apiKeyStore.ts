// Per-provider API keys. Device-local by rule: never bundled, never written into a
// saved graph, never sent anywhere but the provider's own API.
import { createNotifier } from "./storeKit";

const LS_KEY = "solenoid.apiKeys";

// Every localStorage access is guarded: it is absent in the node test env and in
// private mode, where the store must degrade to in-memory rather than throw.
function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    // Keep only string values (a corrupted blob shouldn't inject non-strings).
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
  /** The stored key for a provider, or "" if unset. */
  get(provider: string): string {
    return keys[provider] ?? "";
  },
  has(provider: string): boolean {
    return !!keys[provider];
  },
  /** Store (or, with a blank value, clear) a provider's key. Trims whitespace. */
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
