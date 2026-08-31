// DEV-ONLY harness hooks for the renderer screenshot comparison workflow.
// Tree-shaken out of production builds (import.meta.env.DEV guard).
import { documentStore } from "./documentStore";
import { loadRevealStore } from "./loadReveal";
import { getEditor, getView } from "./process";
if (import.meta.env.DEV) {
  (window as unknown as { __spike: unknown }).__spike = {
    seed: (id: string) => documentStore.newFromTemplate(id),
    // "idle" once the reveal has played; the screenshot harness waits on it.
    revealPhase: () => loadRevealStore.phase(),
    // Frame one node (by label substring) at zoom k, top-left at screen (sx, sy).
    zoomNode: async (label: string, k = 1.7, sx = 260, sy = 200) => {
      const ed = getEditor(), vw = getView();
      if (!ed || !vw) return false;
      const n = ed.getNodes().find((x) => ((x as { label?: string }).label ?? "").toLowerCase().includes(label.toLowerCase()));
      if (!n) return false;
      const pos = vw.position(n.id);
      if (!pos) return false;
      await vw.zoom(k);
      await vw.pan(sx - pos.x * k, sy - pos.y * k);
      return true;
    },
    nodeCount: () => getEditor()?.getNodes().length ?? 0,
    // Group membership (the layout probe asserts members follow a dragged group).
    groups: () => (getEditor()?.getNodes() ?? [])
      .filter((n) => n.constructor.name === "GroupNode")
      .map((g) => ({ id: g.id, members: [...(g as unknown as { members: string[] }).members], collapsed: (g as unknown as { collapsed?: boolean }).collapsed ?? false })),
    // Edge id → its two handles (the socket-box probe maps drawn cables to Handles).
    connections: () => (getEditor()?.getConnections() ?? []).map((c) =>
      ({ id: c.id, source: c.source, sourceOutput: c.sourceOutput, target: c.target, targetInput: c.targetInput })),
    // Every node's model position — the undo/layout smoke diffs two of these.
    positions: () => {
      const ed = getEditor(), vw = getView();
      if (!ed || !vw) return null;
      return ed.getNodes().map((n) => {
        const pos = vw.position(n.id);
        return { id: n.id, type: n.constructor.name, label: (n as { label?: string }).label ?? "?", x: pos?.x ?? null, y: pos?.y ?? null };
      });
    },
    transform: () => {
      const t = getView()?.transform;
      return t ? { k: t.k, x: t.x, y: t.y } : null;
    },
    probe: () => {
      const ed = getEditor(), vw = getView();
      if (!ed || !vw) return null;
      const n = ed.getNodes()[0];
      const pos = vw.position(n.id);
      const el = vw.nodeElement(n.id);
      if (!pos || !el) return null;
      const r = el.getBoundingClientRect();
      const t = vw.transform;
      return { world: { x: pos.x, y: pos.y }, screen: { x: Math.round(r.left), y: Math.round(r.top) }, t: { k: t.k, x: t.x, y: t.y } };
    },
    // Nodes whose position*k+pan ≠ their actual DOM rect (mismatch sources).
    mismatches: () => {
      const ed = getEditor(), vw = getView();
      if (!ed || !vw) return [];
      const t = vw.transform;
      const out: { label: string; dx: number; dy: number; cls: string }[] = [];
      for (const n of ed.getNodes()) {
        const pos = vw.position(n.id);
        const el = vw.nodeElement(n.id);
        if (!pos || !el) continue;
        const r = el.getBoundingClientRect();
        const ex = pos.x * t.k + t.x, ey = pos.y * t.k + t.y;
        const dx = Math.round(r.left - ex), dy = Math.round(r.top - ey);
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          out.push({ label: (n as { label?: string }).label ?? "?", dx, dy, cls: el.className });
        }
      }
      return out;
    },
  };
}
