// The AI account's API key — stored through the SAME per-provider key store as the
// data connections (`apiKeyStore`): localStorage on this device only, never bundled
// with the app, never written into a saved graph. It gets its own module because
// "is an AI account connected" is a gate the command palette reads, and that check
// should not hardcode a provider string at the call site.
//
// UI ONLY for now — nothing here talks to a service. The key is stored and its
// PRESENCE lights up the palette's AI affordance; no request is ever made with it.
import { apiKeyStore } from "./apiKeyStore";

/** Provider id under which the AI key lives in `apiKeyStore`. */
export const AI_PROVIDER = "ai";

/** Whether an AI account is connected — i.e. a non-empty key is stored. */
export function aiConnected(): boolean {
  return apiKeyStore.has(AI_PROVIDER);
}
