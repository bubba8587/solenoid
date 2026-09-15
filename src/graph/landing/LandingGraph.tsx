// dte:C2
import { useEffect, useMemo, useRef, useState } from "react";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { Schemes, SolenoidNode, SolenoidConnection } from "../schemes";
import { FlowSurfaceContext, FlowRevealContext } from "../flowSurface";
import { FlowSurface, idleHandlers, type SurfaceStack, type SurfaceHooks } from "../flow/FlowSurface";
import { makeFlowView } from "../flow/flowView";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import { setEditorRefs, processGraph } from "../process";
import { computeStack } from "./landingCompute";
import { nodeNameStore } from "../nodeNameStore";
import { TableInputNode } from "../nodes/matrix";
import { InterpolateNode } from "../nodes/stats";
import { SurfaceNode, ChartNode } from "../nodes/visual";
import { FrameInputNode, GroupByFrameNode, JoinNode } from "../nodes/frame";

// The landing page's live canvas: a REAL interactive FlowSurface over a LOCAL
// stack, built like the composite drill-in (FlowCompositeOverlay's getDrillStack)
// rather than the inert StaticFlowStage. setEditorRefs points process.ts +
// activeGraph at this stack, so drag, selection, pan/zoom, the Surface node's
// rotate pad and the table popup all drive it. Standalone route (App.tsx early-
// returns to LandingPage), so it never contends with the main canvas for the
// process globals.

const asNode = (n: ClassicPreset.Node) => n as unknown as SolenoidNode;

// A plain Z table of survey heights with holes; the coordinates ride beside it
// (here unwired, so the axes count 1, 2, 3…). Grid Interpolate fills the blanks.
const SURVEY_GRID = [
  "2,   , 6,   , 2",
  " , 11,   , 11, 5",
  "6,   , 20,   , 6",
  "5, 11,   , 11,  ",
  "2,   , 6, 5, 2",
].join("\n");

function makeLandingStack(): SurfaceStack {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const handlers = idleHandlers();
  const view = makeFlowView(editor, {
    bumpNode: (id) => handlers.bumpNode(id),
    bumpConnections: () => handlers.bumpConnections(),
    moveNode: (id, pos) => handlers.moveNode(id, pos),
    setViewport: (v) => handlers.setViewport(v),
    getContainer: () => handlers.getContainer(),
  });
  const s: SurfaceStack = { editor, engine, view, handlers };
  // Recompute the graph when its topology changes, mirrored from the drill-in's
  // trySync (no persistence: the landing page keeps nothing).
  let queued = false;
  editor.addPipe((ctx) => {
    const t = (ctx as { type?: string }).type;
    if (
      t === "nodecreated" || t === "noderemoved" ||
      t === "connectioncreated" || t === "connectionremoved"
    ) {
      if (!queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          handlers.syncTopology();
        });
      }
    }
    return ctx;
  });
  return s;
}

async function buildDemoGraph(s: SurfaceStack) {
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
  for (const [node, x, y] of at) await s.view.moveNode(node.id, { x, y });

  const wire = (src: ClassicPreset.Node, out: string, tgt: ClassicPreset.Node, inp: string) =>
    s.editor.addConnection(new ClassicPreset.Connection(asNode(src), out, asNode(tgt), inp) as SolenoidConnection);
  await wire(survey, "table", interp, "z");
  await wire(interp, "result", surface, "z");
  await wire(interp, "result", contour, "z");
}

// ── Shared build helpers (add + place; wire) ──
async function place(s: SurfaceStack, at: [ClassicPreset.Node, number, number][]) {
  for (const [node] of at) {
    await s.editor.addNode(asNode(node));
    nodeNameStore.ensure(node.id, node.constructor.name);
  }
  for (const [node, x, y] of at) await s.view.moveNode(node.id, { x, y });
}
const connect = (s: SurfaceStack) =>
  (src: ClassicPreset.Node, out: string, tgt: ClassicPreset.Node, inp: string) =>
    s.editor.addConnection(new ClassicPreset.Connection(asNode(src), out, asNode(tgt), inp) as SolenoidConnection);

// A small deterministic PRNG so the demo data is varied but stable across loads.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// ~30 expense rows across a handful of categories (Group By collapses them to the chart).
function spendingText(): string {
  const rng = makeRng(7);
  const cats: [string, number, number][] = [
    ["Groceries", 45, 260], ["Dining", 16, 140], ["Transport", 8, 90],
    ["Utilities", 40, 180], ["Health", 15, 120], ["Fun", 20, 150], ["Shopping", 25, 200],
  ];
  const rows = ["Rent, 1800"]; // the one big fixed line
  for (let i = 0; i < 29; i++) {
    const [name, lo, hi] = cats[Math.floor(rng() * cats.length)];
    rows.push(`${name}, ${Math.round(lo + rng() * (hi - lo))}`);
  }
  return "category, amount\n" + rows.join("\n");
}

// 30 days of actuals wiggling around a rising, wavy target.
function vsTargetText(): { actual: string; target: string } {
  const rng = makeRng(42);
  const a: string[] = [], t: string[] = [];
  for (let i = 1; i <= 30; i++) {
    const trend = 40 + i * 2.4;
    t.push(`${i}, ${Math.round(trend + Math.sin(i / 2.5) * 14)}`);
    a.push(`${i}, ${Math.round(trend + (rng() - 0.5) * 52)}`);
  }
  return { actual: "day, actual\n" + a.join("\n"), target: "day, target\n" + t.join("\n") };
}

// Raw expenses aggregated by category, then charted: Group By sums the amount per category
// and the ChartNode reads column 0 as the x labels and the number column as the series.
async function buildSpendingGraph(s: SurfaceStack) {
  await s.editor.clear();
  const expenses = new FrameInputNode({
    label: "Expenses",
    frameText: spendingText(),
    layoutHidden: true,
  });
  const gb = new GroupByFrameNode({ label: "Sum by category", agg: "sum" });
  gb.stringLiterals.keys = "category";
  gb.stringLiterals.column = "amount";
  const chart = new ChartNode({ label: "Where it goes", op: "column" });
  chart.stringLiterals.options = "ylabel=$ / month; grid=true; color=#f5b914";
  await place(s, [[expenses, 40, 60], [gb, 440, 120], [chart, 820, 70]]);
  const wire = connect(s);
  await wire(expenses, "frame", gb, "frame");
  await wire(gb, "frame", chart, "values");
}

// Two tables (actuals and plan) joined on the month, then a two-series line: the wiring
// story — separate sources combined into one chart.
async function buildVsTargetGraph(s: SurfaceStack) {
  await s.editor.clear();
  const data = vsTargetText();
  const actual = new FrameInputNode({ label: "Actual ($k)", frameText: data.actual, layoutHidden: true });
  const target = new FrameInputNode({ label: "Target ($k)", frameText: data.target, layoutHidden: true });
  const join = new JoinNode({ label: "Join on day", how: "left" });
  join.stringLiterals.leftKey = "day";
  const chart = new ChartNode({ label: "Actual vs target", op: "line" });
  chart.stringLiterals.options = "xlabel=Day; ylabel=$k; grid=true; lw=2.5";
  await place(s, [[actual, 40, 40], [target, 40, 380], [join, 440, 210], [chart, 820, 150]]);
  const wire = connect(s);
  await wire(actual, "frame", join, "left");
  await wire(target, "frame", join, "right");
  await wire(join, "frame", chart, "values");
}

// The scenes the landing hero swaps between: two everyday workbooks (an aggregation and a
// join, each ending in a chart) and the grid-interpolate -> Surface showpiece.
const LANDING_SCENES: { label: string; build: (s: SurfaceStack) => Promise<void> }[] = [
  { label: "Spending", build: buildSpendingGraph },
  { label: "Vs target", build: buildVsTargetGraph },
  { label: "3D surface", build: buildDemoGraph },
];

// No document, no autosave, no undo stack on the landing page: the hooks that
// would persist or record are no-ops; a topology change still recomputes through
// the stack pipe above, and the demo rebuilds from the Reset button.
const LANDING_HOOKS: SurfaceHooks = {
  rfId: "landing",
  history: { undo: async () => {}, redo: async () => {} },
  deleteSelected: async () => {},
  afterMove: () => {},
  afterProgrammaticMove: () => {},
  afterNodeAdded: async () => {
    await processGraph();
  },
  afterConnect: () => {
    void processGraph();
  },
  standoffs: false,
  drawnCables: false,
  fitViewOnInit: true,
  // A marketing demo: gestures only. No app hotkeys, no right-click menus.
  noKeyboard: true,
  noContextMenu: true,
};

// Inside the provider so it can reach fitView. FlowSurface frames the graph once
// (fitViewOnInit); this re-frames after every Reset, once the rebuilt cards have
// re-measured (two frames), so Reset restores the camera as well as the graph.
function LandingStage({ stack, resetNonce }: { stack: SurfaceStack; resetNonce: number }) {
  const { fitView } = useReactFlow();
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void fitView({ padding: 0.15, duration: 320 });
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [resetNonce, fitView]);
  return <FlowSurface stack={stack} hooks={LANDING_HOOKS} />;
}

// The page's ONE live canvas. `build` (stable, module-level) lays out the graph; it
// claims the process.ts + activeGraph globals so drag, selection, the table popup and
// the report overlay all drive it — the locked SceneStage cards only borrow the
// globals for a compute. A page mounts at most one (only one global slot to hold).
export type LiveScene = { label: string; build: (s: SurfaceStack) => Promise<void> };

export function LiveGraph({ build, scenes }: { build?: (s: SurfaceStack) => Promise<void>; scenes?: LiveScene[] }) {
  const stack = useMemo(makeLandingStack, []);
  const [resetNonce, setResetNonce] = useState(0);
  const [sceneIdx, setSceneIdx] = useState(0);
  const activeBuild = scenes ? scenes[sceneIdx].build : build!;

  useEffect(() => {
    setEditorRefs(stack.editor, stack.engine, stack.view);
    void activeBuild(stack).then(() => computeStack(stack, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack]);

  // Rebuild with `b`, recompute, then re-frame (LandingStage watches resetNonce).
  const rebuild = (b: (s: SurfaceStack) => Promise<void>) =>
    void b(stack)
      .then(() => computeStack(stack, true))
      .then(() => setResetNonce((n) => n + 1));

  const selectScene = (i: number) => {
    if (i === sceneIdx) { rebuild(scenes![i].build); return; }
    setSceneIdx(i);
    rebuild(scenes![i].build);
  };

  return (
    <div className="sol-landing__stage sol-flow-reveal">
      <ReactFlowProvider>
        <FlowSurfaceContext.Provider value={true}>
          <FlowRevealContext.Provider value={true}>
            <LandingStage stack={stack} resetNonce={resetNonce} />
          </FlowRevealContext.Provider>
        </FlowSurfaceContext.Provider>
      </ReactFlowProvider>
      {scenes && (
        <div className="sol-landing__stage-scenes" role="tablist" aria-label="Example graphs">
          {scenes.map((sc, i) => (
            <button
              key={sc.label}
              type="button"
              role="tab"
              aria-selected={i === sceneIdx}
              className={`sol-landing__stage-scene${i === sceneIdx ? " is-active" : ""}`}
              onClick={() => selectScene(i)}
            >
              {sc.label}
            </button>
          ))}
        </div>
      )}
      <button className="sol-landing__stage-reset" onClick={() => rebuild(activeBuild)} title="Rebuild the graph">
        Reset
      </button>
    </div>
  );
}

export function LandingGraph() {
  return <LiveGraph scenes={LANDING_SCENES} />;
}
