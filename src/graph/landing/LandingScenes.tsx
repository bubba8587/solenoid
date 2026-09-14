import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SocketDot, type SocketGlyph } from "../components/SocketLegend";
import { SOCKET_COLORS } from "../sockets";
import { ClassicPreset } from "rete";
import type { SolenoidNode, SolenoidConnection } from "../schemes";
import { nodeNameStore } from "../nodeNameStore";
import { NumberInputNode } from "../nodes/input";
import { FormatControllerNode } from "../nodes/formatController";
import { ArithmeticNode } from "../nodes/scalar";
import { EquationNode } from "../nodes/equation";
import { FrameInputNode, JoinNode, GroupByFrameNode, XLookupNode } from "../nodes/frame";
import { PointPlotterNode, CurveNode, DateInputNode } from "../nodes/control";
import { ListInputNode } from "../nodes/list";
import { DisplayNode } from "../nodes/display";
import { NoteNode } from "../nodes/annotation";
import { TvmNode } from "../nodes/finance";
import { SceneStage } from "./SceneStage";

const asNode = (n: ClassicPreset.Node) => n as unknown as SolenoidNode;

// ─── Landing scene primitives ───────────────────────────────────────────────────
// STATIC vignettes rebuilding the app's design recipes in plain DOM+SVG — the page
// allows only ONE live rete stage (LandingGraph), so scenes must never mount one.

// ── Reveal: scroll-triggered entrance ──
// The hidden state exists only under `.sol-landing--anim`, so content is never
// gated on the transition.
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`sol-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

// ── Diagram: a fixed-size plane scaled to fit its container ──
export function Diagram({
  w,
  h,
  children,
  className = "",
  canvas = true,
}: {
  w: number;
  h: number;
  children: ReactNode;
  className?: string;
  /** Draw the canvas dot-grid ground behind the scene. */
  canvas?: boolean;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const fit = () => setScale(Math.min(1, outer.clientWidth / w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div
      ref={outerRef}
      className={`sol-diagram${canvas ? " sol-diagram--canvas" : ""} ${className}`}
      style={{ height: Math.ceil(h * scale), backgroundSize: `${24 * scale}px ${24 * scale}px` }}
    >
      <div className="sol-diagram__plane" style={{ width: w, height: h, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

// ── Cables: the spline recipe (horizontal tangents at both sockets) ──
function cableD(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(46, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function Cables({
  w,
  h,
  runs,
}: {
  w: number;
  h: number;
  runs: { from: [number, number]; to: [number, number]; color: string }[];
}) {
  return (
    <svg className="sol-diagram__cables" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {runs.map((r, i) => {
        const d = cableD(r.from[0], r.from[1], r.to[0], r.to[1]);
        return (
          <g key={i}>
            <path className="sol-cable" d={d} style={{ stroke: r.color }} />
            <path
              className="sol-cable__flow"
              d={d}
              style={{ stroke: r.color, animationDelay: `${(i * 0.45) % 1.6}s` }}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── MNode: the node-card recipe, static ──
type Sock = { cy: number; side: "in" | "out"; glyph: SocketGlyph };

export function MNode({
  x,
  y,
  w = 180,
  accent,
  title,
  socks = [],
  children,
  className = "",
}: {
  x: number;
  y: number;
  w?: number;
  accent: string;
  title: string;
  socks?: Sock[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sol-mnode ${className}`}
      style={{ left: x, top: y, width: w, "--node-accent": accent } as CSSProperties}
    >
      <div className="sol-mnode__header">{title}</div>
      <div className="sol-mnode__body">{children}</div>
      {socks.map((s, i) => (
        <span key={i} className={`sol-mnode__sock sol-mnode__sock--${s.side}`} style={{ top: s.cy }}>
          <SocketDot entry={s.glyph} />
        </span>
      ))}
    </div>
  );
}

const Row = ({ label, value, solved }: { label: string; value: ReactNode; solved?: boolean }) => (
  <div className={`sol-mnode__row${solved ? " sol-mnode__row--solved" : ""}`}>
    <span className="sol-mnode__label">{label}</span>
    <span className="sol-mnode__val">{value}</span>
  </div>
);

const Hero = ({ children }: { children: ReactNode }) => (
  <div className="sol-mnode__hero">{children}</div>
);

const C = SOCKET_COLORS;

// ─── Scene: how a node reads (real XLOOKUP + Note annotations) ──────────────────
// The real XLookup node reading a small frame (East → Ann), with Note nodes placed
// beside the parts they explain. manualLayout keeps the placement; no standoffs
// (they can't scope to a locked scene), so the Notes annotate by proximity.
export function AnatomyScene() {
  return (
    <SceneStage
      className="sol-scene-stage--anatomy"
      manualLayout
      build={async (s) => {
        const regions = new FrameInputNode({
          label: "Regions",
          frameText: "region, manager\nEast, Ann\nWest, Bo\nNorth, Cy",
        });
        const xl = new XLookupNode({ label: "XLOOKUP" });
        xl.stringLiterals.lookup = "East";
        xl.stringLiterals.inColumn = "region";
        xl.stringLiterals.returnColumn = "manager";
        const noteHeader = new NoteNode({
          body: "The header names the operation.",
          width: 210,
          height: 64,
        });
        const noteSockets = new NoteNode({
          body: "Sockets are colored by value type and shaped by dimension: the grid takes a whole table, the split square a value or a list, the dots single text values.",
          width: 250,
          height: 150,
        });
        const noteValue = new NoteNode({
          body: "The value output carries the result out.",
          width: 210,
          height: 64,
        });
        const place: [ClassicPreset.Node, number, number][] = [
          [regions, 20, 60],
          [xl, 360, 40],
          [noteHeader, 360, -60],
          [noteSockets, 20, 360],
          [noteValue, 620, 300],
        ];
        for (const [n] of place) {
          await s.editor.addNode(asNode(n));
          nodeNameStore.ensure(n.id, n.constructor.name);
        }
        for (const [n, x, y] of place) await s.view.moveNode(n.id, { x, y });
        await s.editor.addConnection(
          new ClassicPreset.Connection(asNode(regions), "frame", asNode(xl), "frame") as SolenoidConnection,
        );
      }}
    />
  );
}

// ─── Scene: the typed cable board (real nodes, computed once) ────────────────────
// A source of each value TYPE wired into a Display, so the cables show their real
// per-type colors: a number, a text list, a date, a frame.
export function CableBoardScene() {
  return (
    <SceneStage
      className="sol-scene-stage--sockets"
      build={async (s) => {
        const num = new NumberInputNode({ label: "Number", value: 42 });
        const list = new ListInputNode({ label: "Text list", dataType: "string" });
        list.stringLiterals.v0 = "red, green, blue";
        const date = new DateInputNode({ label: "Date" });
        const frame = new FrameInputNode({ label: "Frame", frameText: "a, b\n1, 2\n3, 4" });
        const sources: [ClassicPreset.Node, string][] = [
          [num, "value"],
          [list, "list"],
          [date, "result"],
          [frame, "frame"],
        ];
        const wire = (src: ClassicPreset.Node, o: string, tgt: ClassicPreset.Node, i: string) =>
          s.editor.addConnection(new ClassicPreset.Connection(asNode(src), o, asNode(tgt), i) as SolenoidConnection);
        for (const [src, outKey] of sources) {
          await s.editor.addNode(asNode(src));
          nodeNameStore.ensure(src.id, src.constructor.name);
          const disp = new DisplayNode({ label: "Display" });
          await s.editor.addNode(asNode(disp));
          nodeNameStore.ensure(disp.id, disp.constructor.name);
          await wire(src, outKey, disp, "in");
        }
      }}
    />
  );
}

// ─── Scene: real units (real nodes, computed once) ──────────────────────────────
// A real locked FlowSurface: two plain numbers take units from undocked Format
// Controllers, and dividing them carries the dimensions — 300 km ÷ 5 hr = 60 km/hr.
// Positions come from the app's own Tidy/ELK; SceneStage reconciles the FCs' mutable
// sockets and computes the value once.
export function UnitsScene() {
  return (
    <SceneStage
      className="sol-scene-stage--units"
      build={async (s) => {
        const dist = new NumberInputNode({ label: "Distance", value: 300 });
        const fcKm = new FormatControllerNode({ label: "km", unit: "km", side: "output" });
        const time = new NumberInputNode({ label: "Time", value: 5 });
        const fcHr = new FormatControllerNode({ label: "hr", unit: "hr", side: "output" });
        const speed = new ArithmeticNode({ label: "Speed", op: "div" });
        for (const n of [dist, fcKm, time, fcHr, speed]) {
          await s.editor.addNode(asNode(n));
          nodeNameStore.ensure(n.id, n.constructor.name);
        }
        const wire = (src: ClassicPreset.Node, o: string, tgt: ClassicPreset.Node, i: string) =>
          s.editor.addConnection(new ClassicPreset.Connection(asNode(src), o, asNode(tgt), i) as SolenoidConnection);
        await wire(dist, "value", fcKm, "in");
        await wire(fcKm, "out", speed, "a");
        await wire(time, "value", fcHr, "in");
        await wire(fcHr, "out", speed, "b");
      }}
    />
  );
}

// ─── Scene: the Equation node (real nodes, computed once) ───────────────────────
// Two knowns feed an Equation node holding V = I × R; the third variable is left
// unwired, so the node solves for it (I = 12 / 240).
export function EquationScene() {
  return (
    <SceneStage
      className="sol-scene-stage--equation"
      build={async (s) => {
        const volts = new NumberInputNode({ label: "Volts", value: 12 });
        const ohms = new NumberInputNode({ label: "Ohms", value: 240 });
        const eq = new EquationNode({ label: "Ohm's law", expr: "V = I * R" });
        for (const n of [volts, ohms, eq]) {
          await s.editor.addNode(asNode(n));
          nodeNameStore.ensure(n.id, n.constructor.name);
        }
        const wire = (src: ClassicPreset.Node, o: string, tgt: ClassicPreset.Node, i: string) =>
          s.editor.addConnection(new ClassicPreset.Connection(asNode(src), o, asNode(tgt), i) as SolenoidConnection);
        await wire(volts, "value", eq, "V");
        await wire(ohms, "value", eq, "R");
      }}
    />
  );
}

// ─── Scene: relational verbs (real nodes, computed once) ────────────────────────
// A sales frame joined to a regions frame on `region`, then grouped by region
// summing sales — the real Join and Group By nodes over inline literal frames.
export function VerbsScene() {
  return (
    <SceneStage
      className="sol-scene-stage--verbs"
      build={async (s) => {
        const sales = new FrameInputNode({
          label: "Sales",
          frameText: "region, sales\nEast, 100\nWest, 200\nEast, 50\nWest, 80\nEast, 40",
        });
        const regions = new FrameInputNode({
          label: "Regions",
          frameText: "region, manager\nEast, Ann\nWest, Bo",
        });
        const join = new JoinNode({ label: "Join", how: "left" });
        join.stringLiterals.leftKey = "region";
        const gb = new GroupByFrameNode({ label: "GROUPBY", agg: "sum" });
        gb.stringLiterals.keys = "region";
        gb.stringLiterals.column = "sales";
        for (const n of [sales, regions, join, gb]) {
          await s.editor.addNode(asNode(n));
          nodeNameStore.ensure(n.id, n.constructor.name);
        }
        const wire = (src: ClassicPreset.Node, o: string, tgt: ClassicPreset.Node, i: string) =>
          s.editor.addConnection(new ClassicPreset.Connection(asNode(src), o, asNode(tgt), i) as SolenoidConnection);
        await wire(sales, "frame", join, "left");
        await wire(regions, "frame", join, "right");
        await wire(join, "frame", gb, "frame");
      }}
    />
  );
}

// ─── Scene: draw your data (real nodes, computed once) ──────────────────────────
// Two real input nodes whose value is their own drawn data: a Point Plotter seeded
// with a scatter and a Curve seeded with control points. No wiring; each stands alone.
export function DrawScene() {
  return (
    <SceneStage
      className="sol-scene-stage--draw"
      manualLayout
      build={async (s) => {
        const plot = new PointPlotterNode({
          label: "Point Plotter",
          pointsText: "1, 2\n2, 3\n3, 3\n4, 5\n5, 4\n6, 6\n7, 8\n8, 7\n9, 9",
          xmax: 10,
          ymax: 10,
        });
        const curve = new CurveNode({
          label: "Curve",
          pointsText: "0, 1\n3, 6\n6, 4\n10, 9",
          xmax: 10,
          ymax: 10,
        });
        for (const n of [plot, curve]) {
          await s.editor.addNode(asNode(n));
          nodeNameStore.ensure(n.id, n.constructor.name);
        }
        // Unwired cards: place them side by side (ELK has no edges to arrange them by).
        await s.view.moveNode(plot.id, { x: 20, y: 20 });
        await s.view.moveNode(curve.id, { x: 300, y: 20 });
      }}
    />
  );
}

// ─── Scene: Monte Carlo ─────────────────────────────────────────────────────────
const HIST = [4, 9, 16, 26, 40, 54, 62, 57, 44, 30, 18, 10, 5];

export function MonteCarloScene() {
  const W = 600;
  const H = 250;
  return (
    <Diagram w={W} h={H}>
      <Cables
        w={W}
        h={H}
        runs={[{ from: [216, 138], to: [316, 96], color: C.number }]}
      />
      <MNode
        x={26}
        y={42}
        w={190}
        accent={C.any}
        title="Loan model"
        socks={[{ cy: 96, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } }]}
      >
        <Row label="rate" value="4.5 ± 0.5 %" />
        <Row label="price" value="$310k ± 20k" />
        <Row label="term" value="25 y" />
      </MNode>
      <MNode x={316} y={28} w={240} accent={C.number} title="Monthly payment">
        <svg className="sol-mnode__pad sol-mnode__pad--hist" viewBox="0 0 204 92" aria-hidden="true">
          {HIST.map((v, i) => (
            <rect
              key={i}
              className="sol-hist__bar"
              x={8 + i * 15}
              y={86 - v * 1.25}
              width={11}
              height={v * 1.25}
              style={{ transitionDelay: `${120 + i * 45}ms` }}
            />
          ))}
        </svg>
        <Hero>$1,213 ± $86</Hero>
      </MNode>
    </Diagram>
  );
}

// ─── Scene: Obsidian — a plain note's frontmatter as typed values ───────────────
// A real Note whose body opens with a YAML block is a typed record: its frontmatter
// keys become typed outputs, wired here into a Time Value of Money node that solves
// the monthly payment. No vault needed — the note lives on the canvas.
export function ObsidianScene() {
  return (
    <SceneStage
      className="sol-scene-stage--obsidian"
      build={async (s) => {
        const note = new NoteNode({
          label: "refi.md",
          height: 280,
          body:
            "---\n" +
            "lender: First National\n" +
            "principal: 250000\n" +
            "rate: 0.005\n" +
            "months: 360\n" +
            "balance: 0\n" +
            "apr: 6.0%\n" +
            "opened: 2026-01-15\n" +
            "---\n" +
            "Refinancing the 30-year fixed. `rate` is the monthly rate (APR / 12) and\n" +
            "`balance` is the payoff target. Edit any figure and the payment re-solves.",
        });
        const pmt = new TvmNode({ label: "Payment" });
        for (const n of [note, pmt]) {
          await s.editor.addNode(asNode(n));
          nodeNameStore.ensure(n.id, n.constructor.name);
        }
        const wire = (out: string, inp: string) =>
          s.editor.addConnection(new ClassicPreset.Connection(asNode(note), out, asNode(pmt), inp) as SolenoidConnection);
        await wire("principal", "pv");
        await wire("rate", "rate");
        await wire("months", "nper");
        await wire("balance", "fv");
      }}
    />
  );
}

// ─── Scene: presenter mode (the camera flies) ───────────────────────────────────
export function PresenterScene() {
  const W = 620;
  const H = 240;
  const clusters: [number, number][][] = [
    [[52, 44], [128, 88], [52, 118]],
    [[268, 130], [344, 96], [344, 168]],
    [[468, 40], [544, 78], [468, 110]],
  ];
  return (
    <Diagram w={W} h={H}>
      {clusters.flat().map(([px, py], i) => (
        <div key={i} className="sol-cam__card" style={{ left: px, top: py }} />
      ))}
      <div className="sol-cam__frame" aria-hidden="true" />
    </Diagram>
  );
}

// ─── The function wall ──────────────────────────────────────────────────────────
const FN_ROW_A = [
  "SUM", "AVERAGE", "XLOOKUP", "SUMIFS", "INDEX", "LAMBDA", "MAKEARRAY", "REDUCE",
  "BYROW", "FILTER", "TAKE", "DROP", "VSTACK", "HSTACK", "WRAPROWS", "PIVOTBY",
  "CHOOSE", "IFS", "SWITCH", "IFERROR",
];
const FN_ROW_B = [
  "PMT", "PV", "FV", "NPER", "RATE", "EFFECT", "PDURATION", "RRI", "NORM.DIST",
  "NORM.INV", "BINOM.DIST", "POISSON.DIST", "ROUND", "MOD", "SQRT", "LN", "EXP",
  "SIN", "COS", "COUNTIFS",
];

function FnRow({ names, reverse }: { names: string[]; reverse?: boolean }) {
  const track = [...names, ...names];
  return (
    <div className="sol-fnwall__lane">
      <div className={`sol-fnwall__track${reverse ? " sol-fnwall__track--rev" : ""}`}>
        {track.map((n, i) => (
          <span key={i} className="sol-fnwall__fn" aria-hidden={i >= names.length}>
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FnWall() {
  return (
    <div className="sol-fnwall">
      <FnRow names={FN_ROW_A} />
      <FnRow names={FN_ROW_B} reverse />
    </div>
  );
}
