// [[B3]] sameNodeEverywhere (tree/specs/documents/graph-load-teardown-performance.md), [[B2]] webTryDesktopFull
// A soft web-demo cap: adding is never blocked; the warning is edge-detected and quiet during the load reveal.

import { getEditor } from "./process";
/** Desktop ignores it. The number is measured: tree/specs/documents/graph-load-teardown-performance.md § The web node budget. */
export const WEB_DEMO_NODE_BUDGET = 300;

/** Fraction of the budget at which the meter shifts to a caution color. */
export const WEB_DEMO_NODE_WARN_RATIO = 0.75;

export function currentNodeCount(): number {
  return getEditor()?.getNodes().length ?? 0;
}
