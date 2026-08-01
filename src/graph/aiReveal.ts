// Entrance animation for nodes an AI apply ADDED (kept nodes stay put — only
// what's new settles in, staggered left to right in apply order). The class
// goes on rete's node HOLDER; the keyframes run on the holder's CHILD (the card
// root), so rete's translate positioning is untouched and socket measurement —
// which reads offset boxes and ignores transforms — is unaffected.

import { getArea } from "./process";
import { getLastLoadIdMap } from "./persistence";
import { prefersReducedMotion } from "./coarse";

const CLASS = "solenoid-ainew";
const STAGGER_MS = 90;
const DURATION_MS = 480;

/** Play the added-node reveal. `savedIds` are the APPLIED graph's ids (names —
 *  `getLastLoadIdMap` maps them to the fresh live ids the rebuild minted). */
export function revealAddedNodes(savedIds: string[]): void {
  if (savedIds.length === 0 || prefersReducedMotion()) return;
  const area = getArea();
  if (!area) return;
  const idMap = getLastLoadIdMap();
  const els: HTMLElement[] = [];
  for (const sid of savedIds) {
    const live = idMap.get(sid);
    const el = live ? area.nodeViews.get(live)?.element : undefined;
    if (el) els.push(el);
  }
  els.forEach((el, i) => {
    el.style.setProperty("--ainew-delay", `${i * STAGGER_MS}ms`);
    el.classList.add(CLASS);
  });
  // Drop the class once the last node has settled so the DOM carries no residue
  // (and a second apply can replay it).
  window.setTimeout(() => {
    for (const el of els) {
      el.classList.remove(CLASS);
      el.style.removeProperty("--ainew-delay");
    }
  }, els.length * STAGGER_MS + DURATION_MS + 100);
}
