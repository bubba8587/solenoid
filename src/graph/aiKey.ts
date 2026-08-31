// The AI account's API key, stored through the same `apiKeyStore` as data connections:
// this device's localStorage only, never bundled and never written into a saved graph.
import { apiKeyStore } from "./apiKeyStore";

/** Provider id under which the AI key lives in `apiKeyStore`; the slot name stays
 *  provider-neutral so a rename never touches stored keys. */
export const AI_PROVIDER = "ai";

/** 1.3 ships with the assistant OFF (author, 2026-08-30) — its verification tail is
 *  unfinished, so the sparkle, the Settings section and the What's-New slide all hide.
 *  Flip to true to restore the whole surface; nothing else was removed. */
export const AI_ENABLED = false;

/** Whether the assistant is on AND a non-empty key is stored. */
export function aiConnected(): boolean {
  return AI_ENABLED && apiKeyStore.has(AI_PROVIDER);
}

/** The stored key, or ""; `aiService.ts` reads it per request and never caches. */
export function getAiKey(): string {
  return apiKeyStore.get(AI_PROVIDER);
}
