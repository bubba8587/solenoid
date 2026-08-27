// DEV-ONLY harness hooks for the renderer screenshot comparison workflow.
// Tree-shaken out of production builds (import.meta.env.DEV guard).
import { documentStore } from "./documentStore";
import { loadRevealStore } from "./loadReveal";
import { getEditor, getArea } from "./process";

if (import.meta.env.DEV) {
  (window as unknown as { __spike: unknown }).__spike = {
    seed: (id: string) => documentStore.newFromTemplate(id),
    // "idle" once the reveal has played; the screenshot harness waits on it.
    revealPhase: () => loadRevealStore.phase(),
    // Frame one node (by label substring) at zoom k, top-left at screen (sx, sy).
    zoomNode: async (label: string, k = 1.7, sx = 260, sy = 200) => {
      const ed = getEditor(), ar = getArea();
      if (!ed || !ar) return false;
      const n = ed.getNodes().find((x) => ((x as { label?: string }).label ?? "").toLowerCase().includes(label.toLowerCase()));
      if (!n) return false;
      const v = ar.nodeViews.get(n.id) as { position: { x: number; y: number } } | undefined;
      if (!v) return false;
      await ar.zoom(k);
      await ar.pan(sx - v.position.x * k, sy - v.position.y * k);
      return true;
    },
    nodeCount: () => getEditor()?.getNodes().length ?? 0,
    transform: () => {
      const t = getArea()?.transform;
      return t ? { k: t.k, x: t.x, y: t.y } : null;
    },
    probe: () => {
      const ed = getEditor(), ar = getArea();
      if (!ed || !ar) return null;
      const n = ed.getNodes()[0];
      const v = ar.nodeViews.get(n.id) as { element: HTMLElement; position: { x: number; y: number } } | undefined;
      if (!v) return null;
      const r = v.element.getBoundingClientRect();
      const t = ar.transform;
      return { world: { x: v.position.x, y: v.position.y }, screen: { x: Math.round(r.left), y: Math.round(r.top) }, t: { k: t.k, x: t.x, y: t.y } };
    },
    // Nodes whose view.position*k+pan ≠ their actual DOM rect (mismatch sources).
    mismatches: () => {
      const ed = getEditor(), ar = getArea();
      if (!ed || !ar) return [];
      const t = ar.transform;
      const out: { label: string; dx: number; dy: number; cls: string }[] = [];
      for (const n of ed.getNodes()) {
        const v = ar.nodeViews.get(n.id) as { element: HTMLElement; position: { x: number; y: number } } | undefined;
        if (!v) continue;
        const r = v.element.getBoundingClientRect();
        const ex = v.position.x * t.k + t.x, ey = v.position.y * t.k + t.y;
        const dx = Math.round(r.left - ex), dy = Math.round(r.top - ey);
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          out.push({ label: (n as { label?: string }).label ?? "?", dx, dy, cls: v.element.className });
        }
      }
      return out;
    },
  };
}
