// The AI account's API key, stored through the same `apiKeyStore` as data connections:
// this device's localStorage only, never bundled and never written into a saved graph.
import { apiKeyStore } from "./apiKeyStore";

/** Provider id under which the AI key lives in `apiKeyStore`; the slot name stays
 *  provider-neutral so a rename never touches stored keys. */
export const AI_PROVIDER = "ai";

/** Whether a non-empty key is stored. */
export function aiConnected(): boolean {
  return apiKeyStore.has(AI_PROVIDER);
}

/** The stored key, or ""; `aiService.ts` reads it per request and never caches. */
export function getAiKey(): string {
  return apiKeyStore.get(AI_PROVIDER);
}
