import { useState, useEffect } from "react";
import { SOCKET_COLORS } from "../sockets";
import { CubeGlyphFaces } from "./cubeGlyph";
import { IS_MOBILE } from "../coarse";
import { registerChrome } from "../chromeToggle";
import "./SocketLegend.css";

// Circles = scalars, squares = arrays, grid = 2D. A group pairs the scalar and
// its list/2D sibling under one type label (number + numlist = "Numeric").
type Dot =
  | { kind: "circle"; color: string }
  | { kind: "square"; color: string }
  | { kind: "grid";   color: string }
  | { kind: "cube";   color: string }
  | { kind: "lambda"; color: string }
  | { kind: "chart";  color: string };

type LegendGroup = { dots: Dot[]; label: string };

const GROUPS: LegendGroup[] = [
  { label: "Numeric", dots: [
    { kind: "circle", color: SOCKET_COLORS.number },
    { kind: "square", color: SOCKET_COLORS.list },
    { kind: "grid",   color: SOCKET_COLORS.table },
  ] },
  { label: "String", dots: [
    { kind: "circle", color: SOCKET_COLORS.string },
    { kind: "square", color: SOCKET_COLORS.strlist },
    { kind: "grid",   color: SOCKET_COLORS.strtable },
  ] },
  { label: "Date", dots: [
    { kind: "circle", color: SOCKET_COLORS.date },
    { kind: "square", color: SOCKET_COLORS.datelist },
    { kind: "grid",   color: SOCKET_COLORS.datetable },
  ] },
  { label: "Complex", dots: [
    { kind: "circle", color: SOCKET_COLORS.complex },
    { kind: "square", color: SOCKET_COLORS.complexlist },
    { kind: "grid",   color: SOCKET_COLORS.complextable },
  ] },
  { label: "Boolean", dots: [
    { kind: "circle", color: SOCKET_COLORS.logical },
    { kind: "square", color: SOCKET_COLORS.logicallist },
    { kind: "grid",   color: SOCKET_COLORS.logicaltable },
  ] },
  { label: "Frame", dots: [
    { kind: "grid", color: SOCKET_COLORS.frame },
    { kind: "cube", color: SOCKET_COLORS.cube },
  ] },
  // The OBJECT family — non-lattice, identity-only values distinguished by
  // glyph, not colour (both green). Lambda = a function, Chart = a figure.
  { label: "Special", dots: [
    { kind: "lambda", color: SOCKET_COLORS.lambda },
    { kind: "chart", color: SOCKET_COLORS.chart },
  ] },
  { label: "Any", dots: [
    { kind: "circle", color: SOCKET_COLORS.any },
    { kind: "grid",   color: SOCKET_COLORS.anytable },
  ] },
];

export type SocketGlyph = Dot;

export function SocketDot({ entry }: { entry: Dot }) {
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
      <div className="solenoid-dimflow__heading">Dimensionality — how shapes connect</div>
      <div className="solenoid-dimflow__ladder">
        <DimStep dot={{ kind: "circle", color: SOCKET_COLORS.number }} dim="0-D" name="Scalar" sub="one value" />
        <span className="solenoid-dimflow__arrow" aria-hidden="true">→</span>
        <DimStep dot={{ kind: "square", color: SOCKET_COLORS.list }} dim="1-D" name="List" sub="a row of values" />
        <span className="solenoid-dimflow__arrow" aria-hidden="true">→</span>
        <DimStep dot={{ kind: "grid", color: SOCKET_COLORS.table }} dim="2-D" name="Table / Frame" sub="rows × columns" />
      </div>
      <p className="solenoid-dimflow__rule">
        <span className="solenoid-dimflow__badge solenoid-dimflow__badge--ok">Widening flows ▸</span>
        A value drops into a <em>wider</em> socket and is reshaped for you — a scalar
        becomes a 1×1, a list becomes a single row. So a scalar can feed a list or
        table input, and a list can feed a table input.
      </p>
      <p className="solenoid-dimflow__rule">
        <span className="solenoid-dimflow__badge solenoid-dimflow__badge--no">◂ Narrowing blocked</span>
        The reverse is refused at the socket: a 2-D table/frame output won't connect
        into a 1-D or 0-D input — it would always be a shape error. Reshape first, e.g.
        <em> Get Column</em> to pull one list out of a frame.
      </p>
      <p className="solenoid-dimflow__note">
        Split-square sockets — the numeric / text / date <em>combos</em> — accept either
        a single value or a list. The grey <em>Any</em> socket accepts anything.
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
