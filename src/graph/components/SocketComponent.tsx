// [[B14]] oneDesignSystem
import { useId, type CSSProperties } from "react";
import type { ClassicPreset } from "rete";
import { SOCKET_COLORS } from "../sockets";
import type { SolenoidSocket } from "../sockets";
import { CubeGlyphFaces } from "./cubeGlyph";
import "./socket.css";

/** Glyphs are SVG, never a border-radius div, which renders as a faint oval on a non-integer pixel; shape encodes type (DESIGN.md § Sockets). */
export const LIST_TYPES = new Set(["list", "strlist", "datelist", "complexlist", "logicallist", "anylist"]);
// Exported so NodeSocket's hover and lit shape can't drift from what's rendered here.
export const TABLE_TYPES = new Set(["table", "strtable", "datetable", "complextable", "logicaltable", "anytable"]);

export const COMBO_COLORS: Record<string, [string, string]> = {
  numlist:      [SOCKET_COLORS.number, SOCKET_COLORS.list],
  strcombo:     [SOCKET_COLORS.string, SOCKET_COLORS.strlist],
  datecombo:    [SOCKET_COLORS.date, SOCKET_COLORS.datelist],
  complexcombo: [SOCKET_COLORS.complex, SOCKET_COLORS.complexlist],
  logicalcombo: [SOCKET_COLORS.logical, SOCKET_COLORS.logicallist],
  // The gray wildcard rungs differ by shape, not shade, so the lower half takes the fill's ring shade rather than a new hue.
  anycombo:     [SOCKET_COLORS.anylist, "var(--sock-any-ring)"],
};

export function SocketComponent({ data }: { data: ClassicPreset.Socket }) {
  // Unique per instance: duplicate SVG ids make the clip resolve to nothing.
  const clipId = `sq-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const dataType =
    data instanceof Object && "dataType" in data ? (data as SolenoidSocket).dataType : undefined;
  const color = dataType ? SOCKET_COLORS[dataType] ?? "#888" : "#888";
  // The ring takes this fill's own border shade, so every stroke darkens the fill by a constant step; `#888` keeps the global ring.
  const ringVar = /^var\(--sock-/.test(color) ? color.replace(/\)\s*$/, "-ring)") : undefined;
  const ringStyle = ringVar ? ({ "--socket-ring": ringVar } as CSSProperties) : undefined;

  const combo  = dataType !== undefined ? COMBO_COLORS[dataType] : undefined;
  const isList = dataType !== undefined && LIST_TYPES.has(dataType);
  const isTable = dataType !== undefined && TABLE_TYPES.has(dataType);
  const isFrame = dataType === "frame";
  const isCube = dataType === "cube";
  const isLambda = dataType === "lambda";
  const isChart = dataType === "chart";
  const isDocument = dataType === "document";
  const isTrueAny = dataType === "trueany";
  const isAnyData = dataType === "anydata";

  return (
    <svg className="solenoid-socket-dot" viewBox="0 0 12 12" preserveAspectRatio="xMidYMid meet" style={ringStyle}>
      {combo ? (
        <>
          <defs><clipPath id={clipId}><rect x="0" y="0" width="12" height="12" rx="1.5" /></clipPath></defs>
          <g clipPath={`url(#${clipId})`}>
            <polygon points="0,12 0,0 12,0"   fill={combo[0]} />
            <polygon points="0,12 12,12 12,0" fill={combo[1]} />
          </g>
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isAnyData ? (
        <>
          <rect x="1.5" y="1.5" width="9" height="9" rx="0.75" fill="none" stroke={color} strokeWidth="2.5" />
        </>
      ) : isList ? (
        <>
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isTable ? (
        <>
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          {/* Grid cross kept clear of the inset border ring (inner edge ≈2/10). */}
          <path d="M6 2.5 V9.5 M2.5 6 H9.5" fill="none" stroke="var(--socket-ring)" strokeWidth="1.3" />
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isFrame ? (
        <>
          {/* Frame: an "F" in the embossed ring stroke, square-edged and squat. */}
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          <path d="M4.15 8.9 V3.9 H8.95 M4.15 6.2 H8.15" fill="none" stroke="var(--socket-ring)" strokeWidth="1.5" />
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isCube ? (
        <>
          {/* Oversized past the 12-box so the hexagon reads the same size; socket.css paints it overflow-visible. */}
          <CubeGlyphFaces fill={color} dy={1} />
        </>
      ) : isLambda ? (
        <>
          {/* Glyph path from Tabler Icons "lambda" (MIT, tabler.io/icons), scaled
              from its 24×24 box into the dot. */}
          <circle cx="6" cy="6" r="6" fill={color} />
          <g transform="translate(6 6) scale(0.328) translate(-12.5 -12)">
            <path d="M6 20l6.5 -9 M19 20c-6 0 -6 -16 -12 -16" fill="none" stroke="var(--socket-ring)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <circle cx="6" cy="6" r="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isChart ? (
        <>
          {/* Inside the inset ring: baseline y=10 touches the bottom border without crossing it, and x 2.4 to 9.6 clears the sides. */}
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          <g fill="var(--socket-ring)">
            <rect x="2.6" y="7"   width="1.7" height="3" />
            <rect x="5.15" y="4.4" width="1.7" height="5.6" />
            <rect x="7.7" y="6"   width="1.7" height="4" />
          </g>
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isDocument ? (
        <>
          {/* Both bars stay inside the inset ring, never touching it. */}
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          <g fill="var(--socket-ring)">
            <rect x="2.8" y="3.7" width="6.4" height="1.7" rx="0.85" />
            <rect x="2.8" y="6.6" width="4.1" height="1.7" rx="0.85" />
          </g>
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isTrueAny ? (
        <>
          {/* The stroke stays inside the 12-box. */}
          <circle cx="6" cy="6" r="4.5" fill="none" stroke={color} strokeWidth="2.5" />
        </>
      ) : (
        <>
          <circle cx="6" cy="6" r="6" fill={color} />
          {/* Ring inset by 1 px — stroke centered at r=5 spans r=4 to r=6. */}
          <circle cx="6" cy="6" r="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}
