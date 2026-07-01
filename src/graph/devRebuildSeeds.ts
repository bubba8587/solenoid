// ─── TEMP: one-shot seed rebuilder (dev only) ──────────────────────────────────
// Loads every seed in turn, runs Cleanup (Ctrl+Shift+L: tidy groups → collapse →
// tidy top → fit) and then Expand-All, serializes the result, and POSTs it to the
// dev-server writeback endpoint so each seed file is saved in that state. The
// layout/collapse geometry these produce can only be computed in the live app
// (ELK + real DOM measurement), so this runs in the browser.
//
// Usage: open the app (dev), then in the devtools console:  await __rebuildSeeds()
//
// Remove this module, its main.tsx import, and the Vite seedWritebackPlugin once
// the seeds are saved.

import { SEEDS } from "./seeds";
import { loadGraph, serializeGraph } from "./persistence";
import { cleanup, getEditor, getArea } from "./process";
import { GroupNode } from "./rete-nodes";
import { setGroupsCollapsed } from "./groupPush";

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const settle = async (n = 3) => { for (let i = 0; i < n; i++) await raf(); };

async function expandAllGroups(): Promise<void> {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;
  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  await setGroupsCollapsed(editor, area, groups, false);
}

async function rebuildSeed(id: string): Promise<void> {
  const seed = SEEDS[id];
  await loadGraph(seed.graph);
  await settle(4); // let the load's deferred FC snaps + zoom settle
  await cleanup(); // tidy groups → collapse all → tidy top → fit
  await settle(4);
  await expandAllGroups(); // final state: every group expanded
  await settle(4);

  const g = serializeGraph();
  if (!g) throw new Error(`serialize failed for ${id}`);
  const label = (seed.graph as { label?: string }).label;
  const out = {
    v: 1 as const,
    ...(typeof label === "string" ? { label } : {}),
    nodes: g.nodes,
    connections: g.connections,
  };
  const resp = await fetch("/__save-seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, graph: out }),
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(`writeback failed for ${id}: ${json.error}`);
  console.log(`[rebuildSeeds] saved ${id} (${g.nodes.length} nodes)`);
}

export async function rebuildAllSeeds(): Promise<void> {
  const ids = Object.keys(SEEDS).sort();
  console.log(`[rebuildSeeds] rebuilding ${ids.length} seeds: ${ids.join(", ")}`);
  for (const id of ids) {
    try {
      await rebuildSeed(id);
    } catch (e) {
      console.error(`[rebuildSeeds] FAILED ${id}:`, e);
    }
  }
  console.log("[rebuildSeeds] done — reload to see saved seeds.");
}

declare global {
  interface Window { __rebuildSeeds?: () => Promise<void> }
}
window.__rebuildSeeds = rebuildAllSeeds;
