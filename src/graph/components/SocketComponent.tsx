import { useId, type CSSProperties } from "react";
import type { ClassicPreset } from "rete";
import { SOCKET_COLORS } from "../sockets";
import type { SolenoidSocket } from "../sockets";
import { CubeGlyphFaces } from "./cubeGlyph";
import "./socket.css";

/**
 * Socket dot. Drawn as an SVG <circle>, not a `border-radius: 50%`
 * div — a div at small sizes (10-12 px) can render as a faint oval
 * whenever the element lands on a non-integer pixel (the node's
 * `top: 50%` plus subpixel layout from the rete-wrapping spans is
 * enough). SVG circles are mathematically defined and stay perfectly
 * round regardless of subpixel positioning of the SVG box.
 *
 * The outer size comes from the `--socket-size` CSS variable (default
 * 12; the Conduit sets it to 9). The viewBox is fixed at 0 0 12 12 so the
 * circle proportions stay the same regardless of the CSS box size —
 * shrinks/grows uniformly with the box.
 */
const LIST_TYPES = new Set(["list", "strlist", "datelist", "complexlist", "logicallist", "anylist"]);

// Combo (scalar | list) types → their [scalar, list] color pair for the
// bicolor split square.
const COMBO_COLORS: Record<string, [string, string]> = {
  numlist:      [SOCKET_COLORS.number, SOCKET_COLORS.list],
  strcombo:     [SOCKET_COLORS.string, SOCKET_COLORS.strlist],
  datecombo:    [SOCKET_COLORS.date, SOCKET_COLORS.datelist],
  complexcombo: [SOCKET_COLORS.complex, SOCKET_COLORS.complexlist],
  logicalcombo: [SOCKET_COLORS.logical, SOCKET_COLORS.logicallist],
  // The gray wildcard family distinguishes its rungs by SHAPE, not shade — every rung
  // is `--sock-any` — so a [gray, gray] split square would be indistinguishable from
  // the `anylist` square. The lower half takes the fill's systematic ring shade (the
  // same fixed value-drop every glyph's border uses), which keeps the split visible
  // without inventing a hue (DESIGN.md's Sibling Rule).
  anycombo:     [SOCKET_COLORS.anylist, "var(--sock-any-ring)"],
};

export function SocketComponent({ data }: { data: ClassicPreset.Socket }) {
  // Unique per instance: a hardcoded SVG id collides across the many combo
  // sockets on screen (e.g. a collapsed group's pills), and duplicate ids make
  // the clip resolve to nothing — clipping the square away to empty.
  const clipId = `sq-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const dataType =
    data instanceof Object && "dataType" in data ? (data as SolenoidSocket).dataType : undefined;
  const color = dataType ? SOCKET_COLORS[dataType] ?? "#888" : "#888";
  // Point this glyph's ring at the border shade of its OWN fill (`--sock-x` →
  // `--sock-x-ring`, written per-fill by appTheme). Every `stroke="var(--socket-ring)"`
  // below inherits it, so the border darkens the actual fill by a constant step
  // instead of the old fixed translucent black (whose contrast drifted with fill
  // lightness). Non-typed sockets (`#888`) keep the global ring.
  const ringVar = /^var\(--sock-/.test(color) ? color.replace(/\)\s*$/, "-ring)") : undefined;
  const ringStyle = ringVar ? ({ "--socket-ring": ringVar } as CSSProperties) : undefined;

  const combo  = dataType !== undefined ? COMBO_COLORS[dataType] : undefined;
  const isList = dataType !== undefined && LIST_TYPES.has(dataType);
  // The typed matrices share the 2×2-grid glyph, distinguished by colour. The
  // FRAME gets its own glyph: every element family has a matrix, so colour alone
  // can't set the Frame apart — it renders as an "F" letterform (see below).
  const isTable =
    dataType === "table" ||
    dataType === "strtable" || dataType === "datetable" ||
    dataType === "complextable" || dataType === "logicaltable" || dataType === "anytable";
  const isFrame = dataType === "frame";
  const isCube = dataType === "cube";
  const isLambda = dataType === "lambda";
  const isChart = dataType === "chart";
  const isDocument = dataType === "document";
  const isTrueAny = dataType === "trueany";

  return (
    <svg className="solenoid-socket-dot" viewBox="0 0 12 12" preserveAspectRatio="xMidYMid meet" style={ringStyle}>
      {combo ? (
        <>
          {/* Bicolor split square: upper-left = the scalar color, lower-right =
              its list color. Two right-angle triangles that together fill the
              12×12 square exactly. Clipped to a slightly-rounded rect so the
              silhouette loses its harshest corners. */}
          <defs><clipPath id={clipId}><rect x="0" y="0" width="12" height="12" rx="1.5" /></clipPath></defs>
          <g clipPath={`url(#${clipId})`}>
            <polygon points="0,12 0,0 12,0"   fill={combo[0]} />
            <polygon points="0,12 12,12 12,0" fill={combo[1]} />
          </g>
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isList ? (
        <>
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isTable ? (
        <>
          {/* 2D matrix: a square split into a 2×2 grid, distinct from the number circle. */}
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          {/* Grid cross kept clear of the inset border ring (inner edge ≈2/10). */}
          <path d="M6 2.5 V9.5 M2.5 6 H9.5" fill="none" stroke="var(--socket-ring)" strokeWidth="1.3" />
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isFrame ? (
        <>
          {/* Frame: an "F" in the embossed ring stroke inside the square. Square
              edges (butt caps, miter joins), wide and squat per the author's tuning. */}
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          <path d="M4.15 8.9 V3.9 H8.95 M4.15 6.2 H8.15" fill="none" stroke="var(--socket-ring)" strokeWidth="1.5" />
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isCube ? (
        <>
          {/* Recursive container glyph (author-drawn). Shared with the legend +
              highlight via cubeGlyph.tsx. Oversized past the 12-box so the hexagon
              reads the same size as the other sockets — the socket SVG paints
              overflow-visible (socket.css) so its top/bottom can extend out. */}
          <CubeGlyphFaces fill={color} dy={1} />
        </>
      ) : isLambda ? (
        <>
          {/* Function value: circle with a λ in the same embossed stroke as the
              grid cross. Glyph path from Tabler Icons "lambda" (MIT,
              tabler.io/icons), scaled from its 24×24 box into the dot. */}
          <circle cx="6" cy="6" r="6" fill={color} />
          <g transform="translate(6 6) scale(0.328) translate(-12.5 -12)">
            <path d="M6 20l6.5 -9 M19 20c-6 0 -6 -16 -12 -16" fill="none" stroke="var(--socket-ring)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <circle cx="6" cy="6" r="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isChart ? (
        <>
          {/* Chart/visual value: a SQUARE (object/"Special" family, green like
              lambda) with three sharp-cornered bars in the embossed ring color.
              The bars sit inside the inset border ring — baseline at y=10 (the
              ring's inner edge) so they TOUCH the bottom border without crossing
              it, and stay within x 2.4–9.6 so they clear the side borders. */}
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
          {/* Document value: same SQUARE + inset border as the chart glyph (object/
              "Special" family), but two LEFT-ALIGNED horizontal rounded bars — a long
              one across the top, a shorter one below — reading as lines of a page.
              Both stay INSIDE the inset border ring (x≥2.7, y within 3–8), never
              touching it. */}
          <rect x="0" y="0" width="12" height="12" rx="1.5" fill={color} />
          <g fill="var(--socket-ring)">
            <rect x="2.8" y="3.7" width="6.4" height="1.7" rx="0.85" />
            <rect x="2.8" y="6.6" width="4.1" height="1.7" rx="0.85" />
          </g>
          <rect x="1" y="1" width="10" height="10" rx="0.5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        </>
      ) : isTrueAny ? (
        <>
          {/* The trueany wildcard: a HOLLOW circle — border only, no fill — so
              "anything" reads distinct from every filled shape even zoomed out.
              Stroke centered at r=4.5 spans r≈3.25 to 5.75 (inside the 12-box). */}
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
