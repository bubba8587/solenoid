// Soft node-count budget for the in-browser demo (the Vercel deploy) — NOT the
// desktop app. A *soft* cap: adding nodes is NEVER blocked; the budget only
// drives a meter and a one-shot warning on the crossing. The warning is
// edge-detected and suppressed during the load reveal, so a graph that LOADS
// already over-budget never pops it — only crossing the line by editing does.

import { getEditor } from "./process";

/** Soft node cap for the web demo. Desktop (Tauri) ignores this entirely. */
export const WEB_DEMO_NODE_BUDGET = 100;

/** Fraction of the budget at which the meter shifts to a caution color. */
export const WEB_DEMO_NODE_WARN_RATIO = 0.75;

/** Current node count, or 0 before the editor exists. */
export function currentNodeCount(): number {
  return getEditor()?.getNodes().length ?? 0;
}
