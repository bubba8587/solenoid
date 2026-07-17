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
import { NumberInputNode } from "../nodes/input";
import { ListInputNode, AggregateNode } from "../nodes/list";
import { ArithmeticNode } from "../nodes/scalar";
import { DisplayNode } from "../nodes/display";
import { TableInputNode } from "../nodes/matrix";
import { InterpolateNode } from "../nodes/stats";
import { SurfaceNode, ContourNode } from "../nodes/visual";

// ─── The landing page's live graph ──────────────────────────────────────────────
// The same rete stack as the main canvas (areaPresets.ts render preset, a real
// DataflowEngine, the process.ts singletons pointed here — Canvas never mounts on
// the landing route), so the cards, sockets and cables ARE the product's, not a
// mock. Pan and wheel-zoom are off; the graph is fit-to-width via a fixed zoom.
// Node dragging and every in-card control stay live, which is the point.
//
// ONE editor holds BOTH demo islands (the commission flow and the terrain flow).
// The process.ts singletons and getOwningEditor assume a single live surface
// outside the composite-drill-in override, so a second independent stack would
// render its cards as unwired — don't split this into per-section stages.

const DESIGN_W = 1060;
const DESIGN_H = 750;

type Mount = {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
};

const asNode = (n: ClassicPreset.Node) => n as unknown as SolenoidNode;

async function placeNodes(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  at: [ClassicPreset.Node, number, number][],
) {
  for (const [node] of at) {
    await editor.addNode(asNode(node));
    nodeNameStore.ensure(node.id, node.constructor.name);
  }
  for (const [node, x, y] of at) await area.translate(node.id, { x, y });
}

const wire = (
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, out: string,
  tgt: ClassicPreset.Node, inp: string,
) => editor.addConnection(new ClassicPreset.Connection(asNode(src), out, asNode(tgt), inp) as SolenoidConnection);

// The terrain island's coordinate-bordered survey grid (first row = X, first
// column = Y, interior = heights) with holes for Grid Interpolate to fill.
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

  // ── Island 1: the commission flow (editable numbers → recompute). ──
  const sales = new ListInputNode({ label: "Sales" });
  sales.stringLiterals.v0 = "1250, 980, 1610, 1430";
  const total = new AggregateNode({ label: "Total", op: "sum" });
  const rate = new NumberInputNode({ label: "Commission rate", value: 0.04 });
  const pay = new ArithmeticNode({ label: "Commission", op: "mul" });
  const disp = new DisplayNode({ label: "Payout" });

  // ── Island 2: terrain — Grid Interpolate → Surface + Contour. ──
  const survey = new TableInputNode({ label: "Survey grid", tableText: SURVEY_GRID });
  const interp = new InterpolateNode({ label: "Grid Interpolate", mode: "grid" });
  const surface = new SurfaceNode({ label: "Surface" });
  const contour = new ContourNode({ label: "Contour" });

  await placeNodes(editor, area, [
    [sales, 10, 60],
    [total, 270, 10],
    [rate, 270, 250],
    [pay, 520, 105],
    [disp, 760, 115],
    [survey, 10, 470],
    [interp, 290, 510],
    [surface, 530, 420],
    [contour, 810, 420],
  ]);

  await wire(editor, sales, "list", total, "list");
  await wire(editor, total, "result", pay, "a");
  await wire(editor, rate, "value", pay, "b");
  await wire(editor, pay, "result", disp, "in");

  await wire(editor, survey, "table", interp, "grid");
  await wire(editor, interp, "result", surface, "grid");
  await wire(editor, interp, "result", contour, "grid");

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
