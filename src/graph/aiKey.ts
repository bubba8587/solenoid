// [[B13]] aiInScope
import { apiKeyStore } from "./apiKeyStore";

/** The slot name stays provider-neutral, so a provider rename never touches stored keys. */
export const AI_PROVIDER = "ai";

export const AI_ENABLED = false;

export function aiConnected(): boolean {
  return AI_ENABLED && apiKeyStore.has(AI_PROVIDER);
}

export function getAiKey(): string {
  return apiKeyStore.get(AI_PROVIDER);
}
