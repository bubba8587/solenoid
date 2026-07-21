// Soft node-count budget for the in-browser demo (the Vercel deploy) — NOT the
// desktop app. The web demo runs inside a system webview whose DOM-compositing
// ceiling is documented in docs/archive/performance-hardening.md: past a few hundred
// nodes, pan/zoom gets choppy and there's no CSS/content fix (only the planned
// WebGPU renderer swap moves it). This budget is a *soft* cap — we NEVER block
// adding nodes, we just surface a meter and warn once on the crossing, so a
// casual demo visitor understands why a huge graph feels sluggish in the browser
// and that the desktop build is the place for big graphs.
//
// Tuning: a single dial, change freely. Set conservatively at 100 to warn early
// — well before the ~280-node zone where zoom visibly degrades. Note this is
// BELOW the 140-node Personal Finance seed, so if the demo loads that seed the
// meter reads over-budget immediately; the modal still won't nag on startup
// (it's edge-detected and suppressed during the load reveal — a graph that loads
// already-over never pops it; only crossing the line by editing does).

import { getEditor } from "./process";

/** Soft node cap for the web demo. Desktop (Tauri) ignores this entirely. */
export const WEB_DEMO_NODE_BUDGET = 100;

/** Fraction of the budget at which the meter shifts to a caution colour. */
export const WEB_DEMO_NODE_WARN_RATIO = 0.75;

/** Current node count, or 0 before the editor exists. */
export function currentNodeCount(): number {
  return getEditor()?.getNodes().length ?? 0;
}
