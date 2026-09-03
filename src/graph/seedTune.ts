// Console-only tooling: true group fit AND a faithful whole-canvas Tidy need the LIVE
// app, since tidy/autofit measure painted DOM. Per group it lays out members + autofits
// the box, then it runs a whole-canvas Tidy (the same pass as pressing T) so the shipped
// geometry equals the tidied layout. scripts/tune-seeds.mjs patches the returned geometry
// back in place — deliberately NOT a re-export, which would rewrite every hand-authored id.
import { SEEDS, clearAndLoadSeed } from "./seeds";
import { getEditor, getView } from "./process";
import { autoArrange } from "./canvasCommands";
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

/** Collapsed groups are expanded around the pass so each box wraps REAL member
 *  sizes; the geometry comes back keyed by the seed file's node ids. */
async function tuneSeed(id: string): Promise<Record<string, TunedNodeGeometry>> {
  if (!SEEDS[id]) throw new Error(`unknown seed "${id}"`);
  const ok = await clearAndLoadSeed(id);
  if (!ok) throw new Error(`seed "${id}" failed to load`);
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) throw new Error("editor/view not ready");
  const idMap = new Map(getLastLoadIdMap());

  // Async values (CSV fetches, chart renders) grow cards, and tidy must measure
  // the settled sizes.
  await sleep(2500);
  await frames(2);

  // First, per-group and sequential, so each group's members are laid out and its
  // box wraps their REAL painted sizes (expand-push displacements restore on
  // re-collapse). This is the internal layout the whole-canvas pass then treats as
  // a rigid unit.
  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  for (const g of groups) {
    const wasCollapsed = g.collapsed;
    if (wasCollapsed) {
      await setGroupsCollapsed(editor, view, [g], false);
      await frames(2);
    }
    if (g.members.length > 1) {
      await autoArrange({ groupId: g.id });
      await frames(2);
    }
    await autofitGroupWithHistory(editor, view, g);
    await frames(2);
    if (wasCollapsed) {
      await setGroupsCollapsed(editor, view, [g], true);
      await frames(2);
    }
  }

  // Then a WHOLE-CANVAS Tidy — exactly what pressing T does: it places every loose
  // node and every group (as a unit, groups shipped collapsed stay collapsed) so the
  // baked layout equals the tidied one, not a hand-composed approximation.
  await autoArrange({ skipConfirm: true });
  await frames(2);

  // Standoffs settle last, against the tidied positions (a note re-hangs off its
  // group after the group's own move).
  if (!standoffStore.isEmpty()) {
    settleStandoffs();
    await frames(2);
  }

  const out: Record<string, TunedNodeGeometry> = {};
  for (const [savedId, liveId] of idMap) {
    const node = editor.getNode(liveId);
    const pos = view.position(liveId);
    if (!node || !pos) continue;
    const geom: TunedNodeGeometry = { x: Math.round(pos.x), y: Math.round(pos.y) };
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
