import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { NodeEditor, ClassicPreset } from "rete";
import { AreaPlugin } from "rete-area-plugin";
import { ReactPlugin } from "rete-react-plugin";
import { DataflowEngine } from "rete-engine";
import type { Schemes, AreaExtra, SolenoidNode, SolenoidConnection } from "../schemes";
import { solenoidClassicRenderSetup } from "../areaPresets";
import { setEditorRefs, processGraph } from "../process";
import { installErrorGuards } from "../errorValue";
import { nodeNameStore } from "../nodeNameStore";
import { TableInputNode } from "../nodes/matrix";
import { InterpolateNode } from "../nodes/stats";
import { SurfaceNode, ContourNode } from "../nodes/visual";

// ─── The landing page's live graph: the terrain flow ────────────────────────────
// The same rete stack as the main canvas (areaPresets.ts render preset, a real
// DataflowEngine, the process.ts singletons pointed here — Canvas never mounts on
// the landing route), so the cards, sockets and cables ARE the product's, not a
// mock. Pan and wheel-zoom are off; the graph is fit-to-width via a fixed zoom.
// Node dragging and every in-card control stay live: the Surface rotate pad, the
// Contour levels field, the Forecast checkbox, and the survey table's grid popup.
//
// ONE live stage only. The singletons and getOwningEditor support a single live
// surface outside the composite-drill-in override — a second independent stack
// renders its cards as unwired the moment the singletons move (see dev-notes
// 2026-07-17). If another demo is ever wanted, add it as an island in THIS
// editor or as a DOM-snapshot diorama, not as a second live stack.

// Wider than the page column on purpose: the fit-to-width zoom lands around
// 0.7, so the cards render smaller with generous space between them.
const DESIGN_W = 1360;
const DESIGN_H = 500;

type Mount = {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
};

const asNode = (n: ClassicPreset.Node) => n as unknown as SolenoidNode;

// The coordinate-bordered survey grid (first row = X, first column = Y, interior
// = heights) with holes for Grid Interpolate to fill.
const SURVEY_GRID = [
  "  ,  0, 10, 20, 30, 40",
  " 0,  2,   ,  6,   ,  2",
  "10,   , 11,   , 11,  5",
  "20,  6,   , 20,   ,  6",
  "30,  5, 11,   , 11,   ",
  "40,  2,   ,  6,  5,  2",
].join("\n");

async function buildDemoGraph(editor: NodeEditor<Schemes>, area: AreaPlugin<Schemes, AreaExtra>) {
  await editor.clear();

  const survey = new TableInputNode({ label: "Survey grid", tableText: SURVEY_GRID });
  const interp = new InterpolateNode({ label: "Grid Interpolate", mode: "grid" });
  const surface = new SurfaceNode({ label: "Surface" });
  const contour = new ContourNode({ label: "Contour" });

  const at: [ClassicPreset.Node, number, number][] = [
    [survey, 20, 130],
    [interp, 380, 90],
    [surface, 740, 50],
    [contour, 1090, 50],
  ];
  for (const [node] of at) {
    await editor.addNode(asNode(node));
    nodeNameStore.ensure(node.id, node.constructor.name);
  }
  for (const [node, x, y] of at) await area.translate(node.id, { x, y });

  const wire = (src: ClassicPreset.Node, out: string, tgt: ClassicPreset.Node, inp: string) =>
    editor.addConnection(new ClassicPreset.Connection(asNode(src), out, asNode(tgt), inp) as SolenoidConnection);
  await wire(survey, "table", interp, "grid");
  await wire(interp, "result", surface, "grid");
  await wire(interp, "result", contour, "grid");

  await processGraph();
}

export function LandingGraph() {
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<Mount | null>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);

  // The rete stack, built once — mirrors the showcase harness mount.
  useEffect(() => {
    const container = stageRef.current;
    if (!container) return;
    const editor = new NodeEditor<Schemes>();
    const area = new AreaPlugin<Schemes, AreaExtra>(container);
    const reactPlugin = new ReactPlugin<Schemes, AreaExtra>({ createRoot });
    const engine = new DataflowEngine<Schemes>();
    reactPlugin.addPreset(solenoidClassicRenderSetup());
    editor.addPipe((ctx) => {
      if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
      return ctx;
    });
    editor.use(area);
    area.use(reactPlugin);
    editor.use(engine);
    // Static stage: no background pan, no wheel zoom. Node drag stays on.
    area.area.setDragHandler(null);
    area.area.setZoomHandler(null);
    setEditorRefs(editor, engine, area);
    mountRef.current = { editor, area };
    void buildDemoGraph(editor, area).then(() => setReady(true));
    return () => {
      mountRef.current = null;
      area.destroy();
    };
  }, []);

  // Fit-to-width: one fixed zoom per container size, so the layout is stable.
  useEffect(() => {
    const container = stageRef.current?.parentElement;
    if (!container) return;
    const fit = () => setScale(Math.min(1, container.clientWidth / DESIGN_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const m = mountRef.current;
    if (m && ready) void m.area.area.zoom(scale, 0, 0);
  }, [scale, ready]);

  const reset = () => {
    const m = mountRef.current;
    if (m) void buildDemoGraph(m.editor, m.area);
  };

  return (
    <div className="sol-landing__stage" style={{ height: Math.ceil(DESIGN_H * scale) }}>
      <div
        ref={stageRef}
        className="sol-landing__stage-canvas"
        style={{ backgroundSize: `${24 * scale}px ${24 * scale}px` }}
      />
      <button className="sol-landing__stage-reset" onClick={reset} title="Rebuild the demo graph">
        Reset
      </button>
    </div>
  );
}
