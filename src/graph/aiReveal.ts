// Entrance animation for nodes an AI apply ADDED. The class goes on rete's HOLDER
// and the keyframes run on its CHILD, leaving rete's translate positioning intact.

import { getView } from "./process";
import { getLastLoadIdMap } from "./persistence";
import { prefersReducedMotion } from "./coarse";

const CLASS = "solenoid-ainew";
const STAGGER_MS = 90;
const DURATION_MS = 480;

/** Play the added-node reveal. `savedIds` are the APPLIED graph's ids (names —
 *  `getLastLoadIdMap` maps them to the fresh live ids the rebuild minted). */
export function revealAddedNodes(savedIds: string[]): void {
  if (savedIds.length === 0 || prefersReducedMotion()) return;
  const view = getView();
  if (!view) return;
  const idMap = getLastLoadIdMap();
  const els: HTMLElement[] = [];
  for (const sid of savedIds) {
    const live = idMap.get(sid);
    const el = live ? view.nodeElement(live) : undefined;
    if (el) els.push(el);
  }
  els.forEach((el, i) => {
    el.style.setProperty("--ainew-delay", `${i * STAGGER_MS}ms`);
    el.classList.add(CLASS);
  });
  // Drop the class once settled, so a second apply can replay it.
  window.setTimeout(() => {
    for (const el of els) {
      el.classList.remove(CLASS);
      el.style.removeProperty("--ainew-delay");
    }
  }, els.length * STAGGER_MS + DURATION_MS + 100);
}
