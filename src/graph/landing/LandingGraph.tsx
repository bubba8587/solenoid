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

// ─── The landing page's graph stages ────────────────────────────────────────────
// The hero stage (LandingGraph) is the real rete stack — the areaPresets.ts render
// preset, a real DataflowEngine, the process.ts singletons pointed here (Canvas
// never mounts on the landing route) — so the cards, sockets and cables ARE the
// product's, and every in-card control recomputes live.
//
// The terrain stage (LandingDiorama) is a STATIC SNAPSHOT of that same render: a
// second rete stack builds and computes once, then its DOM is cloned in place
// (canvas bitmaps copied), the live stack is destroyed, and the singletons return
// to the hero stage. Pixel-identical by construction, and nothing is left to
// resolve against the wrong editor afterward. This is deliberate: the process.ts
// singletons and getOwningEditor support ONE live surface outside the composite
// drill-in override — a second LIVE stack renders its cards as unwired the moment
// the singletons move (tried; see dev-notes 2026-07-17), and registering it as
// the drill-in override breaks the hero island's getActiveEditor edits instead.

type Mount = {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
  engine: DataflowEngine<Schemes>;
};

// Builds are serialized so exactly one stage owns the singletons at a time; the
// hero stage registers itself as the restore target the diorama hands back to.
let buildQueue: Promise<void> = Promise.resolve();
let liveMount: Mount | null = null;

function enqueue(step: () => Promise<void>): Promise<void> {
  buildQueue = buildQueue.then(step).catch((e) => console.error("[landing] stage build failed:", e));
  return buildQueue;
}

const asNode = (n: ClassicPreset.Node) => n as unknown as SolenoidNode;

function makeStack(container: HTMLElement): Mount {
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
  // Static stage: no background pan, no wheel zoom. Node drag stays on (and is
  // moot for the diorama, whose snapshot takes no pointer events).
  area.area.setDragHandler(null);
  area.area.setZoomHandler(null);
  return { editor, area, engine };
}

async function placeNodes(m: Mount, at: [ClassicPreset.Node, number, number][]) {
  for (const [node] of at) {
    await m.editor.addNode(asNode(node));
    nodeNameStore.ensure(node.id, node.constructor.name);
  }
  for (const [node, x, y] of at) await m.area.translate(node.id, { x, y });
}

const wire = (
  m: Mount,
  src: ClassicPreset.Node, out: string,
  tgt: ClassicPreset.Node, inp: string,
) => m.editor.addConnection(new ClassicPreset.Connection(asNode(src), out, asNode(tgt), inp) as SolenoidConnection);

// ── The hero graph: the commission flow ──
const HERO_W = 990;
const HERO_H = 385;

async function buildHeroGraph(m: Mount) {
  await m.editor.clear();

  const sales = new ListInputNode({ label: "Sales" });
  sales.stringLiterals.v0 = "1250, 980, 1610, 1430";
  const total = new AggregateNode({ label: "Total", op: "sum" });
  const rate = new NumberInputNode({ label: "Commission rate", value: 0.04 });
  const pay = new ArithmeticNode({ label: "Commission", op: "mul" });
  const disp = new DisplayNode({ label: "Payout" });

  await placeNodes(m, [
    [sales, 10, 60],
    [total, 270, 10],
    [rate, 270, 250],
    [pay, 520, 105],
    [disp, 760, 115],
  ]);
  await wire(m, sales, "list", total, "list");
  await wire(m, total, "result", pay, "a");
  await wire(m, rate, "value", pay, "b");
  await wire(m, pay, "result", disp, "in");

  await processGraph();
}

export function LandingGraph() {
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<Mount | null>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = stageRef.current;
    if (!container) return;
    const m = makeStack(container);
    mountRef.current = m;
    void enqueue(async () => {
      setEditorRefs(m.editor, m.engine, m.area);
      liveMount = m;
      await buildHeroGraph(m);
    }).then(() => setReady(true));
    return () => {
      if (liveMount === m) liveMount = null;
      mountRef.current = null;
      m.area.destroy();
    };
  }, []);

  // Fit-to-width: one fixed zoom per container size, so the layout is stable.
  useEffect(() => {
    const container = stageRef.current?.parentElement;
    if (!container) return;
    const fit = () => setScale(Math.min(1, container.clientWidth / HERO_W));
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
    if (m) {
      void enqueue(async () => {
        setEditorRefs(m.editor, m.engine, m.area);
        liveMount = m;
        await buildHeroGraph(m);
      });
    }
  };

  return (
    <div className="sol-landing__stage" style={{ height: Math.ceil(HERO_H * scale) }}>
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

// ── The terrain diorama: Grid Interpolate → Surface + Contour, snapshot ──
const TERRAIN_W = 1060;
const TERRAIN_H = 460;

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

async function buildTerrainGraph(m: Mount) {
  const survey = new TableInputNode({ label: "Survey grid", tableText: SURVEY_GRID });
  const interp = new InterpolateNode({ label: "Grid Interpolate", mode: "grid" });
  const surface = new SurfaceNode({ label: "Surface" });
  const contour = new ContourNode({ label: "Contour" });

  await placeNodes(m, [
    [survey, 10, 90],
    [interp, 290, 70],
    [surface, 530, 40],
    [contour, 810, 40],
  ]);
  await wire(m, survey, "table", interp, "grid");
  await wire(m, interp, "result", surface, "grid");
  await wire(m, interp, "result", contour, "grid");

  await processGraph();
}

const nextPaint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function LandingDiorama() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let live: Mount | null = null;

    // The live stack renders into a temporary child of the host; once computed
    // and painted, its DOM is cloned (canvas bitmaps copied), the stack is torn
    // down, and the singletons go back to the hero stage.
    const stageEl = document.createElement("div");
    stageEl.className = "sol-landing__diorama-stage";
    host.appendChild(stageEl);
    const m = makeStack(stageEl);
    live = m;

    void enqueue(async () => {
      if (cancelled) return;
      setEditorRefs(m.editor, m.engine, m.area);
      await buildTerrainGraph(m);
      // Let React commit the cards and the chart canvases draw before cloning.
      await nextPaint();
      await new Promise((r) => setTimeout(r, 300));
      await nextPaint();
      if (!cancelled) {
        const clone = stageEl.cloneNode(true) as HTMLElement;
        clone.className = "sol-landing__diorama-snapshot";
        clone.setAttribute("aria-hidden", "true");
        const srcCanvases = stageEl.querySelectorAll("canvas");
        const dstCanvases = clone.querySelectorAll("canvas");
        srcCanvases.forEach((src, i) => {
          const dst = dstCanvases[i];
          if (dst) dst.getContext("2d")?.drawImage(src, 0, 0);
        });
        host.appendChild(clone);
      }
      m.area.destroy();
      stageEl.remove();
      live = null;
      // Hand the singletons back to the hero stage — then recompute it once.
      // The recompute is load-bearing: this build's connection events bumped the
      // global connectionVersionStore, so the hero's rows re-derived their wired
      // state against THIS stack's refs and rendered as unwired. One pass with
      // the refs restored re-renders them correctly.
      if (liveMount) {
        setEditorRefs(liveMount.editor, liveMount.engine, liveMount.area);
        await processGraph();
      }
    });

    return () => {
      cancelled = true;
      if (live) live.area.destroy();
      host.replaceChildren();
    };
  }, []);

  // Fit-to-width via CSS transform — the snapshot is inert DOM, so scaling it
  // never touches rete (unlike area.zoom, which re-renders connections).
  useEffect(() => {
    const outer = hostRef.current?.parentElement?.parentElement;
    if (!outer) return;
    const fit = () => setScale(Math.min(1, outer.clientWidth / TERRAIN_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="sol-landing__stage sol-landing__stage--static" style={{ height: Math.ceil(TERRAIN_H * scale) }}>
      <div
        className="sol-landing__stage-canvas"
        style={{ backgroundSize: `${24 * scale}px ${24 * scale}px` }}
      >
        <div
          ref={hostRef}
          className="sol-landing__diorama"
          style={{ width: TERRAIN_W, height: TERRAIN_H, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}
