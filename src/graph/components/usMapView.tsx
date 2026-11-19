// [[C100]] chartIsAValue: the US Map figure, the same drawing on a card, a Display, a popup and a Report. The wheel zooms
// about the pointer and a drag pans, inside the figure only: on the canvas the wheel is the map's once its card is
// selected (`.ownwheel`), and `nodrag nopan` keep the card and the canvas still under a drag. A double click goes back to
// the whole map.
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ChartOptions } from "../nodes/chartOptions";
import type { UsMapPayload } from "../chartValue";
import { usMapGeometry, placePins, zoomBox, panBox, type Box } from "../geo/usMapLayout";
import { legendLines } from "../geo/usMapLegend";
import { FigureScope, useChartColors, useSeriesColors } from "./chartCore";
import { themeColor } from "./themeColor";
import { colormapRgb } from "../colormaps";
import { resolveColor, PALETTE } from "../palette";
import { ChartTitle, titleHeight } from "./chartTitle";
import { formatScalar } from "./format";

const LEGEND_H = 16;
const NOTE_H = 14;
const PIN_R = 3.2;
const SIZE_R: [number, number] = [2.5, 9];

function ramp(t: number, cmap: string | undefined): string {
  const [r, g, b] = colormapRgb(cmap ?? "viridis", t) ?? colormapRgb("viridis", t) ?? [128, 128, 128];
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

export const UsMapView = memo(function UsMapView({ payload, options, width, height, fscale = 1 }: {
  payload: UsMapPayload; options: ChartOptions; width: number; height: number; fscale?: number;
}) {
  const { viz } = useChartColors();
  const colors = useSeriesColors();
  // Read where the figure draws: an HTML Page's slot sets its own land, borders and ink.
  const scope = useContext(FigureScope) ?? undefined;
  const land = themeColor("--surface-raised", "#2a2d31", scope);
  const border = themeColor("--border-strong", "#555", scope);
  const ink = themeColor("--text-dim", "#888", scope);
  const { paths, box: home } = usMapGeometry(payload.scope);
  const { pins, off } = useMemo(() => placePins(payload, payload.scope), [payload]);
  const [view, setView] = useState<Box>(home);
  useEffect(() => setView(home), [home]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: Box } | null>(null);

  const title = options.title?.trim();
  const cats = payload.cCats;
  const legendH = legendLines(cats, !!payload.cRange, width, fscale) * LEGEND_H * fscale;
  const notes = off > 0 ? `${off} off the map` : "";
  const mapH = Math.max(40, height - (title ? titleHeight(fscale) : 0) - legendH - (notes ? NOTE_H * fscale : 0));

  // Frame units per screen pixel, as `meet` fits the box into the drawing.
  const unit = Math.max(view.w / width, view.h / mapH);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.closest(".react-flow__node:not(.selected)")) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      setView((v) => {
        const u = Math.max(v.w / r.width, v.h / r.height);
        const left = (r.width - v.w / u) / 2, top = (r.height - v.h / u) / 2;
        const fx = Math.min(1, Math.max(0, (e.clientX - r.left - left) / (v.w / u)));
        const fy = Math.min(1, Math.max(0, (e.clientY - r.top - top) / (v.h / u)));
        return zoomBox(v, home, factor, fx, fy);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [home]);

  const fill = (i: number): string => {
    const c = payload.c?.[i];
    if (c == null) return options.color ? (options.color in PALETTE ? resolveColor(options.color) : options.color) : viz;
    if (cats) return colors[c % colors.length];
    const [lo, hi] = payload.cRange ?? [0, 1];
    return ramp(hi > lo ? (c - lo) / (hi - lo) : 0.5, options.cmap);
  };
  const radius = (i: number): number => {
    const base = (options.markersize ? Math.sqrt(options.markersize) : PIN_R);
    const s = payload.s?.[i];
    if (s == null || !payload.sRange) return base;
    const [lo, hi] = payload.sRange;
    return SIZE_R[0] + (hi > lo ? (s - lo) / (hi - lo) : 0.5) * (SIZE_R[1] - SIZE_R[0]);
  };
  const tip = (i: number): string => [
    payload.text?.[i],
    payload.names.c && payload.c?.[i] != null ? `${payload.names.c}: ${cats ? cats[payload.c[i] as number] : formatScalar(payload.c[i] as number)}` : "",
    payload.names.s && payload.s?.[i] != null ? `${payload.names.s}: ${formatScalar(payload.s[i] as number)}` : "",
    `${payload.lat[i].toFixed(4)}, ${payload.lon[i].toFixed(4)}`,
  ].filter(Boolean).join("\n");

  const zoomed = view.w < home.w - 0.5;
  const fs = 9 * fscale;
  return (
    <div style={{ width, position: "relative" }}>
      {title && <ChartTitle text={title} fs={fscale} />}
      <svg
        ref={svgRef}
        className="ownwheel nodrag nopan"
        width={width}
        height={mapH}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", cursor: drag.current ? "grabbing" : zoomed ? "grab" : "default", touchAction: "none" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, view };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setView(panBox(d.view, home, -(e.clientX - d.x) * unit, -(e.clientY - d.y) * unit));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={(e) => { e.stopPropagation(); setView(home); }}
      >
        <g fill={land} stroke={border} strokeWidth={0.6 * unit} strokeLinejoin="round">
          {paths.map((s) => <path key={s.id} d={s.d}><title>{s.name}</title></path>)}
        </g>
        <g stroke={land} strokeWidth={0.6 * unit} fillOpacity={options.alpha ?? 0.9}>
          {pins.map((p) => (
            <circle key={p.i} cx={p.x} cy={p.y} r={radius(p.i) * unit} fill={fill(p.i)}><title>{tip(p.i)}</title></circle>
          ))}
        </g>
      </svg>
      {zoomed && (
        <button
          type="button"
          className="nodrag"
          title="Whole map"
          onClick={(e) => { e.stopPropagation(); setView(home); }}
          style={{ position: "absolute", right: 2, top: (title ? titleHeight(fscale) : 0) + 2, fontSize: fs, padding: "0 4px", lineHeight: 1.4, background: "var(--surface)", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 3, cursor: "pointer" }}
        >
          Reset
        </button>
      )}
      {legendH > 0 && (
        <div style={{ height: legendH, display: "flex", flexWrap: "wrap", columnGap: 8, alignItems: "center", alignContent: "center", justifyContent: "center", fontSize: fs, lineHeight: `${LEGEND_H * fscale}px`, color: ink, overflow: "hidden", whiteSpace: "nowrap" }}>
          {cats
            ? cats.map((c, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: colors[i % colors.length] }} />{c || "(blank)"}
              </span>
            ))
            : payload.cRange && (
              <>
                <span>{payload.names.c} {formatScalar(payload.cRange[0])}</span>
                <span style={{ width: 80, height: 6, borderRadius: 2, background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => ramp(t, options.cmap)).join(",")})` }} />
                <span>{formatScalar(payload.cRange[1])}</span>
              </>
            )}
        </div>
      )}
      {notes && <div style={{ height: NOTE_H * fscale, fontSize: fs, color: ink, textAlign: "center" }}>{notes}</div>}
    </div>
  );
});
