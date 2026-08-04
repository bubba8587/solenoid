import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SocketDot, type SocketGlyph } from "../components/SocketLegend";
import { SOCKET_COLORS } from "../sockets";

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

const Chip = ({ kind, children }: { kind: "array" | "frame" | "chart"; children: ReactNode }) => (
  <span className={`solenoid-array-chip solenoid-array-chip--${kind} sol-mnode__chip`}>{children}</span>
);

const C = SOCKET_COLORS;

// ─── Scene: how a node reads (annotated anatomy) ────────────────────────────────
export function AnatomyScene() {
  const W = 680;
  const H = 330;
  const nx = 240;
  const ny = 60;
  return (
    <Diagram w={W} h={H}>
      <svg className="sol-diagram__cables" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <g className="sol-callout__lines">
          <path d={`M 178 84 H ${nx - 6}`} />
          <path d={`M 178 168 H ${nx - 12}`} />
          <path d={`M 502 108 H ${nx + 246}`} />
          <path d={`M 502 236 L ${nx + 246} 236`} />
        </g>
      </svg>

      <MNode
        x={nx}
        y={ny}
        w={240}
        accent={C.frame}
        title="XLOOKUP"
        socks={[
          { cy: 42, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 66, side: "in", glyph: { kind: "frame", color: C.frame, tip: "Frame" } },
          { cy: 90, side: "in", glyph: { kind: "square", color: C.strlist, tip: "String List" } },
          { cy: 152, side: "out", glyph: { kind: "circle", color: C.string, tip: "String" } },
        ]}
      >
        <Row label="lookup" value="1042" />
        <Row label="within" value={<Chip kind="frame">Frame 5,000×6</Chip>} />
        <Row label="return" value="name" />
        <Hero>&quot;Meridian Cable Co.&quot;</Hero>
        <div className="sol-mnode__chiprow">
          <Chip kind="array">List ×1</Chip>
        </div>
      </MNode>

      <div className="sol-callout" style={{ left: 8, top: 56, width: 168 }}>
        The header carries the node&apos;s category color as a tint. The card itself stays neutral.
      </div>
      <div className="sol-callout" style={{ left: 8, top: 142, width: 168 }}>
        Sockets straddle the card edge. Shape is dimension: circle, list square, matrix grid. Color is the element type.
      </div>
      <div className="sol-callout" style={{ left: 506, top: 82, width: 166 }}>
        The result box renders in the type&apos;s default format. A date reads as a date, a unit rides its number.
      </div>
      <div className="sol-callout" style={{ left: 506, top: 212, width: 166 }}>
        Chips are the compact preview of a list, frame or chart. Click one and the full grid opens.
      </div>
    </Diagram>
  );
}

// ─── Scene: the typed cable board ───────────────────────────────────────────────
export function CableBoardScene() {
  const W = 680;
  const H = 210;
  const lanes: { y0: number; y1: number; glyph: SocketGlyph; name: string }[] = [
    { y0: 30, y1: 22, glyph: { kind: "circle", color: C.number, tip: "Numeric" }, name: "Number" },
    { y0: 68, y1: 64, glyph: { kind: "square", color: C.strlist, tip: "String List" }, name: "Text list" },
    { y0: 106, y1: 106, glyph: { kind: "circle", color: C.date, tip: "Date" }, name: "Date" },
    { y0: 144, y1: 148, glyph: { kind: "frame", color: C.frame, tip: "Frame" }, name: "Frame" },
    { y0: 182, y1: 190, glyph: { kind: "lambda", color: C.lambda, tip: "LAMBDA" }, name: "Lambda" },
  ];
  return (
    <Diagram w={W} h={H}>
      <Cables
        w={W}
        h={H}
        runs={lanes.map((l) => ({ from: [34, l.y0], to: [560, l.y1], color: l.glyph.color }))}
      />
      {lanes.map((l) => (
        <span key={`src-${l.name}`} className="sol-board__dot" style={{ left: 27, top: l.y0 - 7 }}>
          <SocketDot entry={l.glyph} />
        </span>
      ))}
      {lanes.map((l) => (
        <span key={`end-${l.name}`} className="sol-board__end" style={{ left: 553, top: l.y1 - 7 }}>
          <SocketDot entry={l.glyph} />
          <span className="sol-board__name">{l.name}</span>
        </span>
      ))}
    </Diagram>
  );
}

// ─── Scene: real units ──────────────────────────────────────────────────────────
export function UnitsScene() {
  const W = 620;
  const H = 310;
  return (
    <Diagram w={W} h={H}>
      <Cables
        w={W}
        h={H}
        runs={[
          { from: [186, 95], to: [240, 136], color: C.number },
          { from: [416, 136], to: [466, 67], color: C.number },
          { from: [156, 237], to: [406, 227], color: C.number },
          { from: [336, 237], to: [406, 245], color: C.number },
        ]}
      />
      <MNode
        x={16}
        y={18}
        w={170}
        accent={C.number}
        title="Format Controller"
        socks={[{ cy: 77, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } }]}
      >
        <Row label="unit" value="km" />
        <Hero>5 km</Hero>
      </MNode>
      <MNode
        x={240}
        y={62}
        w={176}
        accent={C.number}
        title="Convert"
        socks={[
          { cy: 74, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 74, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
        ]}
      >
        <Row label="to" value="mi" />
        <Hero>3.107 mi</Hero>
      </MNode>
      <MNode
        x={466}
        y={20}
        w={140}
        accent={C.number}
        title="Display"
        socks={[{ cy: 47, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } }]}
      >
        <Hero>3.107 mi</Hero>
      </MNode>

      <MNode
        x={16}
        y={190}
        w={140}
        accent={C.number}
        title="Length"
        socks={[{ cy: 47, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } }]}
      >
        <Hero>3 m</Hero>
      </MNode>
      <MNode
        x={196}
        y={190}
        w={140}
        accent={C.number}
        title="Duration"
        socks={[{ cy: 47, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } }]}
      >
        <Hero>4 s</Hero>
      </MNode>
      <MNode
        x={406}
        y={185}
        w={170}
        accent={C.number}
        title="Add"
        socks={[
          { cy: 42, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 60, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 92, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
        ]}
      >
        <Row label="a" value="3 m" />
        <Row label="b" value="4 s" />
        <Hero>
          <span className="sol-error-chip">#UNIT!</span>
        </Hero>
      </MNode>
    </Diagram>
  );
}

// ─── Scene: the Equation node ───────────────────────────────────────────────────
export function EquationScene() {
  const W = 600;
  const H = 250;
  return (
    <Diagram w={W} h={H}>
      <Cables
        w={W}
        h={H}
        runs={[
          { from: [166, 74], to: [266, 88], color: C.number },
          { from: [166, 194], to: [266, 136], color: C.number },
        ]}
      />
      <MNode
        x={26}
        y={28}
        w={140}
        accent={C.number}
        title="Volts"
        socks={[{ cy: 46, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } }]}
      >
        <Hero>12 V</Hero>
      </MNode>
      <MNode
        x={26}
        y={148}
        w={140}
        accent={C.number}
        title="Ohms"
        socks={[{ cy: 46, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } }]}
      >
        <Hero>240 Ω</Hero>
      </MNode>
      <MNode
        x={266}
        y={26}
        w={250}
        accent={C.lambda}
        title="Ohm's law"
        socks={[
          { cy: 62, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 62, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 86, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 86, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 110, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 110, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 138, side: "out", glyph: { kind: "circle", color: C.logical, tip: "Boolean" } },
        ]}
      >
        <div className="sol-mnode__formula">V = I × R</div>
        <Row label="V" value="12 V" />
        <Row label="I" value="50 mA" solved />
        <Row label="R" value="240 Ω" />
        <Row label="Check" value={<span className="sol-mnode__true">TRUE</span>} />
      </MNode>
      <div className="sol-callout" style={{ left: 536, top: 66, width: 60 }}>
        solved
      </div>
    </Diagram>
  );
}

// ─── Scene: relational verbs ────────────────────────────────────────────────────
export function VerbsScene() {
  const W = 660;
  const H = 280;
  return (
    <Diagram w={W} h={H}>
      <Cables
        w={W}
        h={H}
        runs={[
          { from: [176, 63], to: [250, 122], color: C.frame },
          { from: [176, 233], to: [250, 140], color: C.frame },
          { from: [420, 172], to: [488, 84], color: C.frame },
        ]}
      />
      <MNode
        x={16}
        y={18}
        w={160}
        accent={C.frame}
        title="sales.csv"
        socks={[{ cy: 45, side: "out", glyph: { kind: "frame", color: C.frame, tip: "Frame" } }]}
      >
        <div className="sol-mnode__chiprow">
          <Chip kind="frame">Frame 5,000×6</Chip>
        </div>
      </MNode>
      <MNode
        x={16}
        y={188}
        w={160}
        accent={C.frame}
        title="regions.csv"
        socks={[{ cy: 45, side: "out", glyph: { kind: "frame", color: C.frame, tip: "Frame" } }]}
      >
        <div className="sol-mnode__chiprow">
          <Chip kind="frame">Frame 12×2</Chip>
        </div>
      </MNode>
      <MNode
        x={250}
        y={80}
        w={170}
        accent={C.frame}
        title="Join"
        socks={[
          { cy: 42, side: "in", glyph: { kind: "frame", color: C.frame, tip: "Frame" } },
          { cy: 60, side: "in", glyph: { kind: "frame", color: C.frame, tip: "Frame" } },
          { cy: 92, side: "out", glyph: { kind: "frame", color: C.frame, tip: "Frame" } },
        ]}
      >
        <Row label="on" value="region" />
        <Row label="how" value="left" />
        <div className="sol-mnode__chiprow">
          <Chip kind="frame">Frame 5,000×7</Chip>
        </div>
      </MNode>
      <MNode
        x={488}
        y={26}
        w={160}
        accent={C.frame}
        title="Group By"
        socks={[
          { cy: 58, side: "in", glyph: { kind: "frame", color: C.frame, tip: "Frame" } },
          { cy: 92, side: "out", glyph: { kind: "frame", color: C.frame, tip: "Frame" } },
        ]}
      >
        <Row label="by" value="region" />
        <Row label="agg" value="SUM(sales)" />
        <div className="sol-mnode__chiprow">
          <Chip kind="frame">Frame 12×2</Chip>
        </div>
      </MNode>
    </Diagram>
  );
}

// ─── Scene: draw your data ──────────────────────────────────────────────────────
const SCATTER: [number, number][] = [
  [14, 96], [30, 78], [44, 88], [58, 62], [74, 68], [90, 44],
  [104, 52], [120, 30], [136, 38], [152, 18], [166, 26],
];

export function DrawScene() {
  const W = 600;
  const H = 270;
  return (
    <Diagram w={W} h={H}>
      <MNode
        x={26}
        y={22}
        w={216}
        accent={C.table}
        title="Point Plotter"
        socks={[
          { cy: 168, side: "out", glyph: { kind: "square", color: C.list, tip: "Numeric List" } },
          { cy: 190, side: "out", glyph: { kind: "square", color: C.list, tip: "Numeric List" } },
        ]}
      >
        <svg className="sol-mnode__pad" viewBox="0 0 180 110" aria-hidden="true">
          {SCATTER.map(([px, py], i) => (
            <circle key={i} cx={px} cy={py * 0.92} r="3" className="sol-pad__dot" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </svg>
        <Row label="X" value={<Chip kind="array">List ×11</Chip>} />
        <Row label="Y" value={<Chip kind="array">List ×11</Chip>} />
      </MNode>
      <MNode
        x={340}
        y={44}
        w={216}
        accent={C.table}
        title="Curve"
        socks={[{ cy: 168, side: "out", glyph: { kind: "square", color: C.list, tip: "Numeric List" } }]}
      >
        <svg className="sol-mnode__pad" viewBox="0 0 180 110" aria-hidden="true">
          <path className="sol-pad__curve" d="M 10 92 C 50 88, 62 30, 96 34 S 150 74, 172 22" />
          {[[10, 92], [96, 34], [172, 22]].map(([px, py], i) => (
            <circle key={i} cx={px} cy={py} r="3.4" className="sol-pad__handle" />
          ))}
        </svg>
        <Row label="samples" value={<Chip kind="array">List ×64</Chip>} />
      </MNode>
    </Diagram>
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

// ─── Scene: Obsidian round trip ─────────────────────────────────────────────────
export function ObsidianScene() {
  const W = 600;
  const H = 250;
  return (
    <Diagram w={W} h={H}>
      <Cables
        w={W}
        h={H}
        runs={[
          { from: [256, 78], to: [356, 82], color: C.number },
          { from: [256, 96], to: [356, 100], color: C.number },
        ]}
      />
      <MNode
        x={26}
        y={26}
        w={230}
        accent={C.string}
        title="refi-assumptions.md"
        socks={[
          { cy: 52, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 70, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
        ]}
      >
        <pre className="sol-mnode__front">
          {"---\nrate: 0.045\nyears: 25\n---"}
        </pre>
        <p className="sol-mnode__prose">Assumptions live in the vault; Reload re-reads them from disk.</p>
      </MNode>
      <MNode
        x={356}
        y={30}
        w={190}
        accent={C.number}
        title="Payment"
        socks={[
          { cy: 52, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 70, side: "in", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
          { cy: 104, side: "out", glyph: { kind: "circle", color: C.number, tip: "Numeric" } },
        ]}
      >
        <Row label="rate" value="0.045" />
        <Row label="nper" value="300" />
        <Hero>$1,213 / mo</Hero>
      </MNode>
    </Diagram>
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
