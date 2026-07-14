import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SOCKET_COLORS } from "../sockets";
import { contrastInk } from "../palette";
import { CubeGlyphFaces } from "./cubeGlyph";
import { IS_MOBILE } from "../coarse";
import { registerChrome } from "../chromeToggle";
import "./SocketLegend.css";

// Circles = scalars, squares = arrays, grid = 2D. A group pairs the scalar and
// its list/2D sibling under one type label (number + numlist = "Numeric"). Each
// dot carries `tip` — its precise per-dimension name, shown in the hover pill.
type Dot = {
  kind: "circle" | "square" | "grid" | "cube" | "lambda" | "chart" | "ring";
  color: string;
  tip?: string;
};

type LegendGroup = { dots: Dot[]; label: string };

const GROUPS: LegendGroup[] = [
  { label: "Numeric", dots: [
    { kind: "circle", color: SOCKET_COLORS.number, tip: "Numeric" },
    { kind: "square", color: SOCKET_COLORS.list,   tip: "Numeric List" },
    { kind: "grid",   color: SOCKET_COLORS.table,  tip: "Numeric Matrix" },
  ] },
  { label: "String", dots: [
    { kind: "circle", color: SOCKET_COLORS.string,   tip: "String" },
    { kind: "square", color: SOCKET_COLORS.strlist,  tip: "String List" },
    { kind: "grid",   color: SOCKET_COLORS.strtable, tip: "String Matrix" },
  ] },
  { label: "Date", dots: [
    { kind: "circle", color: SOCKET_COLORS.date,      tip: "Date" },
    { kind: "square", color: SOCKET_COLORS.datelist,  tip: "Date List" },
    { kind: "grid",   color: SOCKET_COLORS.datetable, tip: "Date Matrix" },
  ] },
  { label: "Complex", dots: [
    { kind: "circle", color: SOCKET_COLORS.complex,      tip: "Complex" },
    { kind: "square", color: SOCKET_COLORS.complexlist,  tip: "Complex List" },
    { kind: "grid",   color: SOCKET_COLORS.complextable, tip: "Complex Matrix" },
  ] },
  { label: "Boolean", dots: [
    { kind: "circle", color: SOCKET_COLORS.logical,      tip: "Boolean" },
    { kind: "square", color: SOCKET_COLORS.logicallist,  tip: "Boolean List" },
    { kind: "grid",   color: SOCKET_COLORS.logicaltable, tip: "Boolean Matrix" },
  ] },
  { label: "Frame", dots: [
    { kind: "grid", color: SOCKET_COLORS.frame, tip: "Frame" },
    { kind: "cube", color: SOCKET_COLORS.cube,  tip: "Cube" },
  ] },
  // The OBJECT family — non-lattice, identity-only values distinguished by
  // glyph, not colour (both green). Lambda = a function, Chart = a figure.
  { label: "Special", dots: [
    { kind: "lambda", color: SOCKET_COLORS.lambda, tip: "LAMBDA" },
    { kind: "chart",  color: SOCKET_COLORS.chart,  tip: "Chart" },
  ] },
  // The wildcard ladder: any (one value) → anylist (1-D) → anytable (2-D),
  // plus the hollow ring = trueany, the accept-ANYTHING supremum.
  { label: "Any", dots: [
    { kind: "circle", color: SOCKET_COLORS.any,      tip: "Any Scalar" },
    { kind: "square", color: SOCKET_COLORS.anylist,  tip: "Any List" },
    { kind: "grid",   color: SOCKET_COLORS.anytable, tip: "Any Matrix" },
    { kind: "ring",   color: SOCKET_COLORS.trueany,  tip: "True Any" },
  ] },
];

export type SocketGlyph = Dot;

// ─── Hover tooltip: an SVG stadium pill (no OS-native delay, no CSS shapes) ──────
// Body fill = the socket type colour; border = the same --socket-ring that darkens
// the socket edges; text = contrastInk(colour) — the adaptive ink the menu bar uses.

/** Resolve any CSS colour expression (incl. `var(--sock-*)`, palette-overridden) to a
 *  #rrggbb hex, so contrastInk picks the readable ink for the EXACT rendered colour. */
function cssColorToHex(css: string): string {
  const probe = document.createElement("span");
  probe.style.color = css;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color; // "rgb(r, g, b)" / "rgba(...)"
  probe.remove();
  const m = rgb.match(/[\d.]+/g);
  if (!m || m.length < 3) return "#888888";
  return "#" + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
}

const TIP_FONT_FAMILY = "system-ui, -apple-system, sans-serif";
let _measureCtx: CanvasRenderingContext2D | null = null;
/** Text width via a shared canvas — one pass, so the pill sizes without a reflow flash. */
function measureTipText(text: string): number {
  if (_measureCtx === null) _measureCtx = document.createElement("canvas").getContext("2d");
  if (!_measureCtx) return text.length * 7; // headless fallback
  _measureCtx.font = `600 12px ${TIP_FONT_FAMILY}`;
  return _measureCtx.measureText(text).width;
}

function SocketTip({ label, color, anchor }: { label: string; color: string; anchor: DOMRect }) {
  const ink = contrastInk(cssColorToHex(color));
  const H = 20, PAD_X = 9, SW = 1.5;
  const W = Math.ceil(measureTipText(label)) + PAD_X * 2;
  // Centre on the dot, but clamp so the pill never clips the viewport edge (the
  // legend sits bottom-RIGHT, so its dots are close to the right edge).
  const half = W / 2 + 4;
  const cx = Math.max(half, Math.min(anchor.left + anchor.width / 2, window.innerWidth - half));
  return createPortal(
    <div
      className="solenoid-socktip"
      style={{ left: cx, top: anchor.top - 6 }}
      aria-hidden="true"
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
        <rect
          x={SW / 2} y={SW / 2} width={W - SW} height={H - SW} rx={(H - SW) / 2}
          fill={color} stroke="var(--socket-ring)" strokeWidth={SW}
        />
        <text
          x={W / 2} y={H / 2 + 0.5} fill={ink} fontSize="12" fontWeight="600"
          textAnchor="middle" dominantBaseline="middle"
          style={{ fontFamily: TIP_FONT_FAMILY }}
        >{label}</text>
      </svg>
    </div>,
    document.body,
  );
}

/** A legend glyph + its instant hover pill (when the dot carries a `tip`). */
export function SocketDot({ entry }: { entry: Dot }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = () => { const r = ref.current?.getBoundingClientRect(); if (r) setAnchor(r); };
  return (
    <span
      ref={ref}
      className="solenoid-legend__dot"
      onMouseEnter={entry.tip ? show : undefined}
      onMouseLeave={anchor ? () => setAnchor(null) : undefined}
    >
      <SocketGlyphSvg entry={entry} />
      {entry.tip && anchor && <SocketTip label={entry.tip} color={entry.color} anchor={anchor} />}
    </span>
  );
}

function SocketGlyphSvg({ entry }: { entry: Dot }) {
  // viewBox is padded 1 unit on every side ("-1 -1 14 14") so the shapes — whose
  // fills reach the 0/12 bounds — never sit on the rendered edge. Without the
  // pad, fractional device-pixel rounding (the legend is scaled 0.85) clips the
  // outermost row at most browser zoom levels.
  if (entry.kind === "square") {
    return (
      <svg width={14} height={14} viewBox="-1 -1 14 14" style={{ flexShrink: 0 }}>
        <rect x="0" y="0" width="12" height="12" rx="1.5" fill={entry.color} />
        <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
      </svg>
    );
  }
  if (entry.kind === "grid") {
    return (
      <svg width={14} height={14} viewBox="-1 -1 14 14" style={{ flexShrink: 0 }}>
        <rect x="0" y="0" width="12" height="12" rx="1.5" fill={entry.color} />
        <path d="M6 2.5 V9.5 M2.5 6 H9.5" fill="none" stroke="var(--socket-ring)" strokeWidth="1.3" />
        <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
      </svg>
    );
  }
  if (entry.kind === "cube") {
    return (
      // The -1..13 viewBox padding lets the oversized cube (shared CubeGlyphFaces)
      // extend past the 12-box without clipping — no overflow-visible needed here.
      <svg width={14} height={14} viewBox="-1 -1 14 14" style={{ flexShrink: 0 }}>
        <CubeGlyphFaces fill={entry.color} />
      </svg>
    );
  }
  if (entry.kind === "lambda") {
    return (
      <svg width={14} height={14} viewBox="-1 -1 14 14" style={{ flexShrink: 0 }}>
        <circle cx="6" cy="6" r="6" fill={entry.color} />
        {/* λ glyph from Tabler Icons "lambda" (MIT) — same as SocketComponent. */}
        <g transform="translate(6 6) scale(0.328) translate(-12.5 -12)">
          <path d="M6 20l6.5 -9 M19 20c-6 0 -6 -16 -12 -16" fill="none" stroke="var(--socket-ring)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <circle cx="6" cy="6" r="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
      </svg>
    );
  }
  if (entry.kind === "ring") {
    return (
      <svg width={14} height={14} viewBox="-1 -1 14 14" style={{ flexShrink: 0 }}>
        {/* Hollow circle — border only, no fill: the trueany "anything" socket. */}
        <circle cx="6" cy="6" r="4.5" fill="none" stroke={entry.color} strokeWidth="2.5" />
      </svg>
    );
  }
  if (entry.kind === "chart") {
    return (
      <svg width={14} height={14} viewBox="-1 -1 14 14" style={{ flexShrink: 0 }}>
        {/* Square + three sharp bars — same glyph as SocketComponent's chart socket. */}
        <rect x="0" y="0" width="12" height="12" rx="1.5" fill={entry.color} />
        <g fill="var(--socket-ring)">
          <rect x="2.6" y="7" width="1.7" height="3" />
          <rect x="5.15" y="4.4" width="1.7" height="5.6" />
          <rect x="7.7" y="6" width="1.7" height="4" />
        </g>
        <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg width={14} height={14} viewBox="-1 -1 14 14" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="6" fill={entry.color} />
      <circle cx="6" cy="6" r="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
    </svg>
  );
}

const LEGEND_LS_KEY = "solenoid.legendCollapsed";

function readPersistedCollapsed(): boolean | null {
  try {
    const raw = localStorage.getItem(LEGEND_LS_KEY);
    return raw === null ? null : raw === "1";
  } catch { return null; }
}

export function SocketLegend() {
  // Start collapsed in mobile mode — the full panel is a lot of screen on a
  // phone, so show just the launcher there and let the user open it. A desktop
  // user's open/collapsed choice persists across reloads (localStorage).
  const [collapsed, setCollapsed] = useState(() => readPersistedCollapsed() ?? IS_MOBILE);
  useEffect(() => {
    try { localStorage.setItem(LEGEND_LS_KEY, collapsed ? "1" : "0"); }
    catch { /* private mode / quota — non-fatal */ }
  }, [collapsed]);
  // Join the chrome-toggle group so Tab folds/unfolds the legend with the other
  // panels (navigator + pin / alert HUDs).
  useEffect(() => registerChrome("legend", { isOpen: () => !collapsed, setOpen: (o) => setCollapsed(!o) }), [collapsed]);

  return (
    <div className={`solenoid-legend${collapsed ? " solenoid-legend--collapsed" : ""}`}>
      <button
        className="solenoid-legend__toggle"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Show socket legend" : "Hide socket legend"}
      >
        {collapsed ? "?" : "×"}
      </button>
      {!collapsed && (
        <>
          <div className="solenoid-legend__heading">Socket types</div>
          <SocketLegendRows />
        </>
      )}
    </div>
  );
}

/** Dimensionality-flow explainer for the Reference overlay's Socket Types tab:
 *  the 0-D → 1-D → 2-D ladder, which way a cable can flow (widening), and why the
 *  reverse (narrowing a 2-D output into a 1-D/0-D input) is blocked at the socket.
 *  Mirrors the canConnect() rule in sockets.ts in plain language. */
export function DimensionalityFlow() {
  return (
    <div className="solenoid-dimflow">
      <div className="solenoid-dimflow__heading">Dimensionality: how shapes connect</div>
      <div className="solenoid-dimflow__ladder">
        <DimStep dot={{ kind: "circle", color: SOCKET_COLORS.number }} dim="0-D" name="Scalar" sub="one value" />
        <span className="solenoid-dimflow__arrow" aria-hidden="true">→</span>
        <DimStep dot={{ kind: "square", color: SOCKET_COLORS.list }} dim="1-D" name="List" sub="a row of values" />
        <span className="solenoid-dimflow__arrow" aria-hidden="true">→</span>
        <DimStep dot={{ kind: "grid", color: SOCKET_COLORS.table }} dim="2-D" name="Table / Frame" sub="rows × columns" />
      </div>
      <p className="solenoid-dimflow__rule">
        <span className="solenoid-dimflow__badge solenoid-dimflow__badge--ok">Widening flows ▸</span>
        A value drops into a <em>wider</em> socket and is reshaped for you: a scalar
        becomes a 1×1, a list becomes a single row. So a scalar can feed a list or
        table input, and a list can feed a table input.
      </p>
      <p className="solenoid-dimflow__rule">
        <span className="solenoid-dimflow__badge solenoid-dimflow__badge--no">◂ Narrowing blocked</span>
        The reverse is refused at the socket: a 2-D table/frame output won't connect
        into a 1-D or 0-D input; it would always be a shape error. Reshape first, e.g.
        <em> Get Column</em> to pull one list out of a frame.
      </p>
      <p className="solenoid-dimflow__note">
        Split-square sockets (the numeric / text / date <em>combos</em>) accept either
        a single value or a list. The grey <em>Any</em> sockets are the untyped ladder —
        circle = one value of any type, square = any list, grid = any table — and the
        hollow ring accepts anything at all.
      </p>
    </div>
  );
}

function DimStep({ dot, dim, name, sub }: { dot: Dot; dim: string; name: string; sub: string }) {
  return (
    <div className="solenoid-dimflow__step">
      <SocketDot entry={dot} />
      <span className="solenoid-dimflow__step-text">
        <span className="solenoid-dimflow__dim">{dim}</span>
        <span className="solenoid-dimflow__name">{name}</span>
        <span className="solenoid-dimflow__sub">{sub}</span>
      </span>
    </div>
  );
}

/** The socket-type rows on their own — reused by the Reference overlay's Sockets
 *  tab (on mobile the floating legend is hidden and lives there instead). */
export function SocketLegendRows() {
  return (
    <>
      {GROUPS.map((g) => (
        <div key={g.label} className="solenoid-legend__row">
          <span className="solenoid-legend__type">{g.label}</span>
          <span className="solenoid-legend__dots">
            {g.dots.map((d, i) => (
              <SocketDot key={i} entry={d} />
            ))}
          </span>
        </div>
      ))}
    </>
  );
}
