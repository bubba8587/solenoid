// Seed-tune harness (tooling, console-only — no UI). The seed JSONs are authored
// blind: group boxes are guessed from fake node sizes (the PF generator's 240×230
// rect()), so they drift out of fit as cards' real content-driven sizes change.
// True fit needs the LIVE app — tidy/autofit measure painted DOM (measuredBox
// reads offsetWidth/Height) — so this hook loads a seed, runs the same per-group
// tidy → autofit the group Tidy button does, and returns ONLY the resulting
// geometry keyed by SAVED node id. scripts/tune-seeds.mjs drives it headlessly
// and patches x/y (+ group width/height) back into the seed files in place —
// deliberately NOT a full re-export, which would rewrite every id to a generated
// name (serializeGraph normalizes ids) and wreck the hand-authored files.
import { SEEDS, clearAndLoadSeed } from "./seeds";
import { getEditor, getArea, autoArrange } from "./process";
import { GroupNode } from "./rete-nodes";
import { autofitGroupWithHistory } from "./groupLogic";
import { setGroupsCollapsed } from "./groupPush";
import { standoffStore, settleStandoffs } from "./standoffs";
import { getLastLoadIdMap } from "./persistence";

interface TunedNodeGeometry {
  x: number;
  y: number;
  width?: number;  // GroupNode only — the autofitted box
  height?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frames = (n: number) =>
  new Promise<void>((r) => {
    const step = (left: number) => (left <= 0 ? r() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

/** Load a seed, tidy + autofit every group (expanding collapsed ones around the
 *  pass so the box wraps REAL member sizes, then re-collapsing), settle
 *  standoffs, and return the final geometry keyed by the seed file's node ids. */
async function tuneSeed(id: string): Promise<Record<string, TunedNodeGeometry>> {
  if (!SEEDS[id]) throw new Error(`unknown seed "${id}"`);
  const ok = await clearAndLoadSeed(id);
  if (!ok) throw new Error(`seed "${id}" failed to load`);
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) throw new Error("editor/area not ready");
  // Saved id → live id, captured before anything else can reload the graph.
  const idMap = new Map(getLastLoadIdMap());

  // Let async values land (Web Source CSV fetches, chart renders) — they grow
  // cards, and tidy must measure the settled sizes.
  await sleep(2500);
  await frames(2);

  // One group at a time: expand → tidy members → autofit the box → re-collapse.
  // Sequential + per-group so expand-push displacements restore on re-collapse
  // and the seed's overall composition survives.
  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  for (const g of groups) {
    const wasCollapsed = g.collapsed;
    if (wasCollapsed) {
      await setGroupsCollapsed(editor, area, [g], false);
      await frames(2);
    }
    if (g.members.length > 1) {
      await autoArrange({ groupId: g.id });
      // Docked FCs snap back in a deferred frame (same wait as the Tidy button).
      await frames(2);
    }
    await autofitGroupWithHistory(editor, area, g);
    await frames(2);
    if (wasCollapsed) {
      await setGroupsCollapsed(editor, area, [g], true);
      await frames(2);
    }
  }

  // Final constraint pass over the settled boxes (autofit re-settles per group;
  // this catches note→group ties whose group just moved under them).
  if (!standoffStore.isEmpty()) {
    settleStandoffs();
    await frames(2);
  }

  const out: Record<string, TunedNodeGeometry> = {};
  for (const [savedId, liveId] of idMap) {
    const node = editor.getNode(liveId);
    const view = area.nodeViews.get(liveId);
    if (!node || !view) continue;
    const geom: TunedNodeGeometry = { x: Math.round(view.position.x), y: Math.round(view.position.y) };
    if (node instanceof GroupNode) {
      geom.width = Math.round(node.width);
      geom.height = Math.round(node.height);
    }
    out[savedId] = geom;
  }
  return out;
}

declare global {
  interface Window {
    __solenoidSeedIds?: () => string[];
    __solenoidTuneSeed?: (id: string) => Promise<Record<string, TunedNodeGeometry>>;
  }
}
window.__solenoidSeedIds = () => Object.keys(SEEDS);
window.__solenoidTuneSeed = tuneSeed;
