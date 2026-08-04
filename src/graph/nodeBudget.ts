// A SOFT web-demo cap: adding nodes is never blocked. The warning is edge-detected and
// suppressed during the load reveal, so loading over-budget never pops it.

import { getEditor } from "./process";

/** Soft node cap for the web demo. Desktop (Tauri) ignores this entirely. */
export const WEB_DEMO_NODE_BUDGET = 100;

/** Fraction of the budget at which the meter shifts to a caution color. */
export const WEB_DEMO_NODE_WARN_RATIO = 0.75;

/** Current node count, or 0 before the editor exists. */
export function currentNodeCount(): number {
  return getEditor()?.getNodes().length ?? 0;
}
