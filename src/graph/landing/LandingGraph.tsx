import { useEffect, useMemo, useRef, useState } from "react";
import { ClassicPreset } from "rete";
import type { SolenoidNode, SolenoidConnection } from "../schemes";
import { makeStaticStack, StaticFlowStage, type StaticStack } from "../flow/StaticFlowStage";
import { setEditorRefs, processGraph } from "../process";
import { nodeNameStore } from "../nodeNameStore";
import { TableInputNode } from "../nodes/matrix";
import { InterpolateNode } from "../nodes/stats";
import { SurfaceNode } from "../nodes/visual";

// The landing page's live flow stage, pointed at the process.ts singletons. ONE live
// stage only — a second stack renders its cards unwired the moment the singletons move.

// Wider than the page column on purpose: fit-to-width then lands around 0.7 zoom.
const DESIGN_W = 1360;
const DESIGN_H = 500;

const asNode = (n: ClassicPreset.Node) => n as unknown as SolenoidNode;

// A plain Z table of survey heights with holes; the coordinates ride beside it (here
// unwired, so the axes count 1, 2, 3…). Grid Interpolate fills the blanks.
const SURVEY_GRID = [
  "2,   , 6,   , 2",
  " , 11,   , 11, 5",
  "6,   , 20,   , 6",
  "5, 11,   , 11,  ",
  "2,   , 6, 5, 2",
].join("\n");

async function buildDemoGraph(s: StaticStack) {
  await s.editor.clear();

  const survey = new TableInputNode({ label: "Survey grid", tableText: SURVEY_GRID });
  const interp = new InterpolateNode({ label: "Grid Interpolate", mode: "grid" });
  const surface = new SurfaceNode({ label: "Area" });
  const contour = new SurfaceNode({ op: "contour", label: "Contour" });

  const at: [ClassicPreset.Node, number, number][] = [
    [survey, 20, 130],
    [interp, 380, 90],
    [surface, 740, 50],
    [contour, 1090, 50],
  ];
  for (const [node] of at) {
    await s.editor.addNode(asNode(node));
    nodeNameStore.ensure(node.id, node.constructor.name);
  }
  for (const [node, x, y] of at) await s.area.moveNode(node.id, { x, y });

  const wire = (src: ClassicPreset.Node, out: string, tgt: ClassicPreset.Node, inp: string) =>
    s.editor.addConnection(new ClassicPreset.Connection(asNode(src), out, asNode(tgt), inp) as SolenoidConnection);
  await wire(survey, "table", interp, "z");
  await wire(interp, "result", surface, "z");
  await wire(interp, "result", contour, "z");

  await processGraph();
}

export function LandingGraph() {
  const stack = useMemo(makeStaticStack, []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setEditorRefs(stack.editor, stack.engine, stack.area);
    void buildDemoGraph(stack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack]);

  useEffect(() => {
    const container = wrapRef.current?.parentElement;
    if (!container) return;
    const fit = () => setScale(Math.min(1, container.clientWidth / DESIGN_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const reset = () => void buildDemoGraph(stack);

  return (
    <div ref={wrapRef} className="sol-landing__stage" style={{ height: Math.ceil(DESIGN_H * scale) }}>
      <div
        className="sol-landing__stage-canvas"
        style={{ backgroundSize: `${24 * scale}px ${24 * scale}px` }}
      >
        <StaticFlowStage stack={stack} zoom={scale} />
      </div>
      <button className="sol-landing__stage-reset" onClick={reset} title="Rebuild the demo graph">
        Reset
      </button>
    </div>
  );
}
