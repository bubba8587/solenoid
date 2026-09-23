// [[B13]] aiInScope
// The class goes on rete's holder and the keyframes run on its child, leaving rete's translate positioning intact.

import { getView } from "./process";
import { getLastLoadIdMap } from "./persistence";
import { prefersReducedMotion } from "./coarse";

const CLASS = "solenoid-ainew";
const STAGGER_MS = 90;
const DURATION_MS = 480;

/** `savedIds` are the applied graph's names; getLastLoadIdMap maps them to the fresh live ids. */
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
  window.setTimeout(() => {
    for (const el of els) {
      el.classList.remove(CLASS);
      el.style.removeProperty("--ainew-delay");
    }
  }, els.length * STAGGER_MS + DURATION_MS + 100);
}
