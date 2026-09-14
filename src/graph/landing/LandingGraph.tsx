import { useEffect, useMemo, useRef, useState } from "react";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { Schemes, SolenoidNode, SolenoidConnection } from "../schemes";
import { FlowSurfaceContext } from "../flowSurface";
import { FlowSurface, idleHandlers, type SurfaceStack, type SurfaceHooks } from "../flow/FlowSurface";
import { makeFlowView } from "../flow/flowView";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import { setEditorRefs, processGraph } from "../process";
import { computeStack } from "./landingCompute";
import { nodeNameStore } from "../nodeNameStore";
import { TableInputNode } from "../nodes/matrix";
import { InterpolateNode } from "../nodes/stats";
import { SurfaceNode } from "../nodes/visual";

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
export function LiveGraph({ build }: { build: (s: SurfaceStack) => Promise<void> }) {
  const stack = useMemo(makeLandingStack, []);
  const [resetNonce, setResetNonce] = useState(0);

  useEffect(() => {
    setEditorRefs(stack.editor, stack.engine, stack.view);
    void build(stack).then(() => computeStack(stack, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack]);

  const reset = () =>
    void build(stack)
      .then(() => computeStack(stack, true))
      .then(() => setResetNonce((n) => n + 1));

  return (
    <div className="sol-landing__stage">
      <ReactFlowProvider>
        <FlowSurfaceContext.Provider value={true}>
          <LandingStage stack={stack} resetNonce={resetNonce} />
        </FlowSurfaceContext.Provider>
      </ReactFlowProvider>
      <button className="sol-landing__stage-reset" onClick={reset} title="Rebuild the demo graph">
        Reset
      </button>
    </div>
  );
}

export function LandingGraph() {
  return <LiveGraph build={buildDemoGraph} />;
}
