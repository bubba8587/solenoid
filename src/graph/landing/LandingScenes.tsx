import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SocketDot, type SocketGlyph } from "../components/SocketLegend";
import { SOCKET_COLORS } from "../sockets";
import { NODE_KIND_ACCENTS, type NodeKind } from "../nodes/shared";
import { ClassicPreset } from "rete";
import type { SolenoidNode, SolenoidConnection } from "../schemes";
import { nodeNameStore } from "../nodeNameStore";
import { NumberInputNode } from "../nodes/input";
import { FormatControllerNode } from "../nodes/formatController";
import { ArithmeticNode } from "../nodes/scalar";
import { EquationNode } from "../nodes/equation";
import { FrameInputNode, JoinNode, GroupByFrameNode, FilterFrameNode, SortFrameNode } from "../nodes/frame";
import { PointPlotterNode, CurveNode, DateInputNode } from "../nodes/control";
import { ListInputNode } from "../nodes/list";
import { DisplayNode } from "../nodes/display";
import { NoteNode } from "../nodes/annotation";
import { TvmNode } from "../nodes/finance";
import { VaultFolderNode, LocalFileNode } from "../nodes/connection";
import { WriteObsidianNode } from "../nodes/obsidian";
import { ReportNode } from "../nodes/report";
import { type SurfaceStack } from "../flow/FlowSurface";
import { SceneStage } from "./SceneStage";

const asNode = (n: ClassicPreset.Node) => n as unknown as SolenoidNode;

// ── Scene build helpers (every scene adds nodes and wires them the same way) ──
/** Add each node to the scene's editor and register its class-derived family name. */
async function addNodes(s: SurfaceStack, nodes: ClassicPreset.Node[]): Promise<void> {
  for (const n of nodes) {
    await s.editor.addNode(asNode(n));
    nodeNameStore.ensure(n.id, n.constructor.name);
  }
}

/** Wire one output socket to one input socket — the scenes' one cable-adding idiom. */
function wire(s: SurfaceStack, src: ClassicPreset.Node, out: string, tgt: ClassicPreset.Node, inp: string) {
  return s.editor.addConnection(
    new ClassicPreset.Connection(asNode(src), out, asNode(tgt), inp) as SolenoidConnection,
  );
}

// ─── Landing scene primitives ───────────────────────────────────────────────────
// STATIC vignettes rebuilding the app's design recipes in plain DOM+SVG — the page
// allows only ONE live rete stage (LandingGraph), so scenes must never mount one.

// ── Reveal animation gate ──
// Entrance/loop motion lives only under `.sol-landing--anim`, and only when the OS
// isn't asking for reduced motion. Applied in a LAYOUT effect (before paint), so the
// hidden reveal state paints once and the IntersectionObserver's reveal a frame later
// has a committed frame to transition FROM — a passive effect flips it after paint, so
// above-the-fold reveals collapse straight to visible with no animation on reload.
export function useRevealAnim(): boolean {
  const [anim, setAnim] = useState(false);
  useLayoutEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAnim(true);
  }, []);
  return anim;
}

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

// ─── Scene: the typed cable board (real nodes, computed once) ────────────────────
// A source of each value TYPE wired into a Display, so the cables show their real
// per-type colors: a number, a text list, a date, a frame. Manual layout: half the
// pairs sit on the left, half on the right, each Display a fixed span to its source.
export function CableBoardScene() {
  return (
    <SceneStage
      className="sol-scene-stage--sockets"
      manualLayout
      build={async (s) => {
        const num = new NumberInputNode({ label: "Number", value: 42 });
        const list = new ListInputNode({ label: "Text list", dataType: "string" });
        list.stringLiterals.v0 = "red, green, blue";
        const date = new DateInputNode({ label: "Date" });
        const frame = new FrameInputNode({ label: "Frame", frameText: "a, b\n1, 2\n3, 4" });
        // [source, outputKey, sourceX, sourceY]; the Display sits SPAN to the right.
        const SPAN = 240;
        const pairs: [ClassicPreset.Node, string, number, number][] = [
          [num, "value", 0, 0],
          [list, "list", 0, 260],
          [date, "result", 660, 0],
          [frame, "frame", 650, 260],
        ];
        for (const [src, outKey, x, y] of pairs) {
          const disp = new DisplayNode({ label: "Display" });
          await addNodes(s, [src, disp]);
          await s.view.moveNode(src.id, { x, y });
          await s.view.moveNode(disp.id, { x: x + SPAN + 50, y: y + 30 });
          await wire(s, src, outKey, disp, "in");
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
        await addNodes(s, [dist, fcKm, time, fcHr, speed]);
        await wire(s, dist, "value", fcKm, "in");
        await wire(s, fcKm, "out", speed, "a");
        await wire(s, time, "value", fcHr, "in");
        await wire(s, fcHr, "out", speed, "b");
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
        await addNodes(s, [volts, ohms, eq]);
        await wire(s, volts, "value", eq, "V");
        await wire(s, ohms, "value", eq, "R");
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
        await addNodes(s, [sales, regions, join, gb]);
        await wire(s, sales, "frame", join, "left");
        await wire(s, regions, "frame", join, "right");
        await wire(s, join, "frame", gb, "frame");
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
        await addNodes(s, [plot, curve]);
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
        await addNodes(s, [note, pmt]);
        await wire(s, note, "principal", pmt, "pv");
        await wire(s, note, "rate", pmt, "rate");
        await wire(s, note, "months", pmt, "nper");
        await wire(s, note, "balance", pmt, "fv");
      }}
    />
  );
}

// ─── Scene: import a note — frontmatter as typed outputs (Obsidian page) ─────────
// The real Note node parsing a YAML frontmatter block: each key becomes a typed
// output (numbers, dates), and one is wired into a Display to show a property in use.
// No vault and no IO — unlike the vault-reader nodes, a Note lives on the canvas.
export function NoteImportScene() {
  return (
    <SceneStage
      className="sol-scene-stage--obs-note"
      build={async (s) => {
        const note = new NoteNode({
          label: "Deep Work.md",
          height: 250,
          body:
            "---\n" +
            "rating: 4.5\n" +
            "pages: 296\n" +
            "started: 2026-07-30\n" +
            "finished: 2026-08-21\n" +
            "---\n" +
            "Every frontmatter property is exposed as a typed value you can wire as an input.",
        });
        const disp = new DisplayNode({ label: "rating" });
        await addNodes(s, [note, disp]);
        await wire(s, note, "rating", disp, "in");
      }}
    />
  );
}

// ─── Scene: the vault as a table (real nodes reading the demo vault) ─────────────
// A real Vault Folder reads the bundled demo vault's Notes folder as one cube, Filter
// keeps the notes tagged `book`, Sort orders by rating, Display shows the table. The
// Obsidian page forces the demo-vault root, so this reads real notes on the web too.
export function VaultTableScene() {
  return (
    <SceneStage
      className="sol-scene-stage--vault-table"
      awaitConnections
      build={async (s) => {
        const notes = new VaultFolderNode({ label: "Vault Folder", folder: "Notes" });
        const filter = new FilterFrameNode({
          label: "tags contains book",
          condConfig: { "0": { op: "listContains" } },
          valueKeys: ["frame", "column0", "value0"],
        });
        filter.stringLiterals.column0 = "tags";
        filter.stringLiterals.value0 = "book";
        const sort = new SortFrameNode({ label: "by rating", dir: "desc" });
        sort.stringLiterals.column = "rating";
        const disp = new DisplayNode({ label: "Book notes" });
        await addNodes(s, [notes, filter, sort, disp]);
        await wire(s, notes, "cube", filter, "frame");
        await wire(s, filter, "frame", sort, "frame");
        await wire(s, sort, "frame", disp, "in");
      }}
    />
  );
}

// ─── Scene: Excel over CSV (a real Local File reading a bundled CSV) ─────────────
// A real Local File node reads the demo vault's bundled expenses.csv as a typed
// frame, shown in a Display. The Obsidian page forces the Local File data folder to
// the demo vault, so this reads a real CSV on the web too (desktop reads real disk).
export function LocalFileScene() {
  return (
    <SceneStage
      className="sol-scene-stage--obs-csv"
      build={async (s) => {
        const file = new LocalFileNode({ label: "expenses.csv", fileName: "expenses.csv" });
        const disp = new DisplayNode({ label: "Expenses" });
        await addNodes(s, [file, disp]);
        await wire(s, file, "frame", disp, "in");
      }}
    />
  );
}

// ─── The Obsidian page's live hero graph (interactive, not a locked scene) ───────
// Two plain values flow into a Report — a markdown note whose `{{ }}` tags embed them
// (Knap) — and Write to Obsidian. Driven by LiveGraph, so it claims the page globals:
// edit an input and the Report re-renders, open its Document chip to read the note.
// The reports surface, no formula to parse — values in, a note out. Clears first so
// LiveGraph's Reset rebuilds it.
export async function buildReportPipeline(s: SurfaceStack): Promise<void> {
  await s.editor.clear();
  const focus = new NumberInputNode({ label: "Focus hours", value: 18.5 });
  const tasks = new NumberInputNode({ label: "Tasks done", value: 12 });
  const report = new ReportNode({
    label: "Weekly review",
    body:
      "# Weekly review\n\n" +
      "Logged **{{ focus }} h** of deep work across **{{ tasks }}** finished tasks. " +
      "Nice momentum — keep the streak going.",
  });
  const write = new WriteObsidianNode({ label: "Write to Obsidian", target: "note" });
  write.stringLiterals.path = "Weekly review";
  const at: [ClassicPreset.Node, number, number][] = [
    [focus, 20, 40],
    [tasks, 20, 230],
    [report, 360, 110],
    [write, 720, 140],
  ];
  await addNodes(s, at.map(([n]) => n));
  for (const [n, x, y] of at) await s.view.moveNode(n.id, { x, y });
  await wire(s, focus, "value", report, "focus");
  await wire(s, tasks, "value", report, "tasks");
  await wire(s, report, "document", write, "in");
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
// Two marquee rows, each a rainbow of node kinds rather than one domain per row —
// lookup (violet), text (lime), math (blue), date (pink), array (gold), logic
// (purple), lambda (green) and complex (sky) interleave so the color varies as it
// scrolls. Every name is a real Excel function Solenoid answers.
const FN_ROW_A = [
  "XLOOKUP", "TEXTJOIN", "NPV", "EOMONTH", "FILTER", "IFS", "REDUCE", "IMSQRT",
  "INDEX", "LEFT", "PMT", "NETWORKDAYS", "SORT", "SWITCH", "MAKEARRAY", "IMABS",
  "XMATCH", "SUBSTITUTE", "SUMIFS", "WEEKDAY", "UNIQUE", "IFERROR",
];
const FN_ROW_B = [
  "PIVOTBY", "CONCAT", "FV", "WORKDAY", "SORTBY", "AND", "MAP", "IMLN", "TRIM",
  "STDEV.S", "EDATE", "DROP", "NOT", "SCAN", "IMEXP", "MID", "FORECAST.LINEAR",
  "DATEDIF", "VSTACK", "OR", "BYCOL", "UPPER",
];

// Each function reads in the accent of the node kind that provides it.
const FN_KIND: Record<string, NodeKind> = {
  // lookup / reference (frame)
  XLOOKUP: "frame", INDEX: "frame", XMATCH: "frame", PIVOTBY: "frame",
  // text (string)
  TEXTJOIN: "string", LEFT: "string", SUBSTITUTE: "string", CONCAT: "string",
  TRIM: "string", MID: "string", UPPER: "string",
  // math / stats / finance
  NPV: "math", PMT: "math", SUMIFS: "math", FV: "math", "STDEV.S": "math",
  "FORECAST.LINEAR": "math",
  // date / time
  EOMONTH: "date", NETWORKDAYS: "date", WEEKDAY: "date", WORKDAY: "date",
  EDATE: "date", DATEDIF: "date",
  // dynamic arrays (list)
  FILTER: "list", SORT: "list", UNIQUE: "list", SORTBY: "list", DROP: "list", VSTACK: "list",
  // logical
  IFS: "logic", SWITCH: "logic", IFERROR: "logic", AND: "logic", NOT: "logic", OR: "logic",
  // lambda helpers
  REDUCE: "lambda", MAKEARRAY: "lambda", MAP: "lambda", SCAN: "lambda", BYCOL: "lambda",
  // complex numbers
  IMSQRT: "complex", IMABS: "complex", IMLN: "complex", IMEXP: "complex",
};

function FnRow({ names, reverse }: { names: string[]; reverse?: boolean }) {
  const track = [...names, ...names];
  return (
    <div className="sol-fnwall__lane">
      <div className={`sol-fnwall__track${reverse ? " sol-fnwall__track--rev" : ""}`}>
        {track.map((n, i) => {
          const kind = FN_KIND[n];
          return (
            <span
              key={i}
              className="sol-fnwall__fn"
              aria-hidden={i >= names.length}
              style={kind ? { color: NODE_KIND_ACCENTS[kind] } : undefined}
            >
              {n}
            </span>
          );
        })}
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
