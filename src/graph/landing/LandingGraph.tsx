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

// ─── The landing page's live graph ──────────────────────────────────────────────
// The same rete stack as the main canvas (areaPresets.ts render preset, a real
// DataflowEngine, the process.ts singletons pointed here — Canvas never mounts on
// the landing route), so the cards, sockets and cables ARE the product's, not a
// mock. Pan and wheel-zoom are off; the graph is fit-to-width via a fixed zoom.
// Node dragging and every in-card control stay live, which is the point.

const DESIGN_W = 990; // canvas-units the layout occupies
const DESIGN_H = 385;

type Mount = {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
};

async function buildDemoGraph(editor: NodeEditor<Schemes>, area: AreaPlugin<Schemes, AreaExtra>) {
  await editor.clear();

  const sales = new ListInputNode({ label: "Sales" });
  sales.stringLiterals.v0 = "1250, 980, 1610, 1430";
  const total = new AggregateNode({ label: "Total", op: "sum" });
  const rate = new NumberInputNode({ label: "Commission rate", value: 0.04 });
  const pay = new ArithmeticNode({ label: "Commission", op: "mul" });
  const disp = new DisplayNode({ label: "Payout" });

  const at: [SolenoidNode, number, number][] = [
    [sales as unknown as SolenoidNode, 10, 60],
    [total as unknown as SolenoidNode, 270, 10],
    [rate as unknown as SolenoidNode, 270, 250],
    [pay as unknown as SolenoidNode, 520, 105],
    [disp as unknown as SolenoidNode, 760, 115],
  ];
  for (const [node] of at) {
    await editor.addNode(node);
    nodeNameStore.ensure(node.id, node.constructor.name);
  }
  for (const [node, x, y] of at) await area.translate(node.id, { x, y });

  const wire = (src: SolenoidNode, out: string, tgt: SolenoidNode, inp: string) =>
    editor.addConnection(new ClassicPreset.Connection(src, out, tgt, inp) as SolenoidConnection);
  await wire(sales as unknown as SolenoidNode, "list", total as unknown as SolenoidNode, "list");
  await wire(total as unknown as SolenoidNode, "result", pay as unknown as SolenoidNode, "a");
  await wire(rate as unknown as SolenoidNode, "value", pay as unknown as SolenoidNode, "b");
  await wire(pay as unknown as SolenoidNode, "result", disp as unknown as SolenoidNode, "in");

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
