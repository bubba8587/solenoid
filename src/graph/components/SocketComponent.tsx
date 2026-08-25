import type { CSSProperties } from "react";
import type { ClassicPreset } from "rete";
import { SOCKET_COLORS } from "../sockets";
import type { SolenoidSocket } from "../sockets";
import { CubeGlyphFaces } from "./cubeGlyph";
import "./socket.css";

/** Socket dot as an SVG <circle>, never a `border-radius` div — a div this small
 *  renders as a faint oval on a non-integer pixel. The outer size comes from
 *  `--socket-size`; the viewBox stays 0 0 12 12 so proportions hold at any size. */
export const LIST_TYPES = new Set(["list", "strlist", "datelist", "complexlist", "logicallist", "anylist"]);
// Typed 2-D grids — all drawn as a rounded square (the grid-cross glyph). Exported so
// NodeSocket's hover/lit shape can't drift from what's rendered here.
export const TABLE_TYPES = new Set(["table", "strtable", "datetable", "complextable", "logicaltable", "anytable"]);

// Combo types → their [scalar, list] pair for the bicolor split square.
export const COMBO_COLORS: Record<string, [string, string]> = {
  numlist:      [SOCKET_COLORS.number, SOCKET_COLORS.list],
  strcombo:     [SOCKET_COLORS.string, SOCKET_COLORS.strlist],
  datecombo:    [SOCKET_COLORS.date, SOCKET_COLORS.datelist],
  complexcombo: [SOCKET_COLORS.complex, SOCKET_COLORS.complexlist],
  logicalcombo: [SOCKET_COLORS.logical, SOCKET_COLORS.logicallist],
  // The gray wildcard rungs differ by SHAPE, not shade, so the lower half takes the
  // fill's systematic ring shade rather than inventing a hue (DESIGN.md).
  anycombo:     [SOCKET_COLORS.anylist, "var(--sock-any-ring)"],
};

export function SocketComponent({ data }: { data: ClassicPreset.Socket }) {
  const dataType =
    data instanceof Object && "dataType" in data ? (data as SolenoidSocket).dataType : undefined;
  const color = dataType ? SOCKET_COLORS[dataType] ?? "#888" : "#888";
  // Point the ring at the border shade of this glyph's OWN fill, so every stroke
  // below darkens the actual fill by a constant step; `#888` keeps the global ring.
  const ringVar = /^var\(--sock-/.test(color) ? color.replace(/\)\s*$/, "-ring)") : undefined;
  const ringStyle = ringVar ? ({ "--socket-ring": ringVar } as CSSProperties) : undefined;

  const combo  = dataType !== undefined ? COMBO_COLORS[dataType] : undefined;
  const isList = dataType !== undefined && LIST_TYPES.has(dataType);
  // Typed matrices share the 2×2-grid glyph by color; the FRAME needs its own
  // letterform, since every element family has a matrix.
  const isTable = dataType !== undefined && TABLE_TYPES.has(dataType);
  const isFrame = dataType === "frame";
  const isCube = dataType === "cube";
  const isLambda = dataType === "lambda";
  const isChart = dataType === "chart";
  const isDocument = dataType === "document";
  const isTrueAny = dataType === "trueany";
  const isAnyData = dataType === "anydata";

  // The cube keeps its inline SVG: its shaded faces need more paint layers than
  // the masked-span scheme (fill + second fill + ring) offers.
  if (isCube) {
    return (
      <svg className="solenoid-socket-dot" viewBox="0 0 12 12" preserveAspectRatio="xMidYMid meet" style={ringStyle}>
        {/* Oversized past the 12-box so a hexagon reads the same size as the
            other sockets; socket.css paints this SVG overflow-visible. */}
        <CubeGlyphFaces fill={color} dy={1} />
      </svg>
    );
  }

  // Every other glyph is a masked <span> — the exact same vector data rides in
  // socket.css mask data-URIs (::before = fill, ::after = ring + decoration),
  // cutting the per-socket <svg> subtree. Geometry notes live with the masks.
  const glyph =
    combo ? "combo"
    : isAnyData ? "anydata"
    : isList ? "list"
    : isTable ? "table"
    : isFrame ? "frame"
    : isLambda ? "lambda"
    : isChart ? "chart"
    : isDocument ? "document"
    : isTrueAny ? "trueany"
    : "scalar";
  const style: CSSProperties = {
    ...(ringStyle ?? {}),
    ["--sock-fill" as string]: combo ? combo[0] : color,
    ...(combo ? { ["--sock-fill2" as string]: combo[1] } : {}),
  };
  return <span className="solenoid-socket-dot" data-glyph={glyph} style={style} />;
}

