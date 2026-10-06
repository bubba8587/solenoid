// [[C100]] chartIsAValue, [[D98]] tanstackDrawsCharts
import { useMemo } from "react";
import { defineChart, waffleY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { tip, tipValue, useTheme } from "./kit";
import { formatScalar } from "../format";
import { resolveColor } from "../../palette";
import type { ProportionPayload } from "../../chartValue";

type Cells = { k: number; name: string; value: number | null; n: number; color: string; filled: boolean };

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** The 100 cells of the grid: one share in the accent, else each positive value's share by largest remainder. */
function waffleCells(p: ProportionPayload, colors: string[], accent: string): Cells[] | null {
  const single = p.values.length === 1 && p.values[0] >= 0 && p.values[0] <= 1;
  let parts: Cells[];
  if (single) {
    parts = [{ k: 0, name: p.names[0] ?? "", value: p.values[0], n: Math.round(p.values[0] * 100), color: accent, filled: true }];
  } else {
    const ok = (v: number) => Number.isFinite(v) && v > 0;
    const total = p.values.reduce((a, v) => (ok(v) ? a + v : a), 0);
    if (total <= 0) return null;
    const raw = p.values.map((v) => (ok(v) ? (v / total) * 100 : 0));
    const counts = raw.map(Math.floor);
    let rem = 100 - counts.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f);
    for (const { i } of order) { if (rem <= 0) break; counts[i]++; rem--; }
    parts = counts.map((n, i) => ({ k: i, name: p.names[i] ?? "", value: p.values[i], n, color: colors[i % colors.length], filled: true }));
  }
  const used = parts.reduce((a, c) => a + c.n, 0);
  if (used < 100) parts.push({ k: -1, name: "", value: null, n: 100 - used, color: "var(--surface-sunken)", filled: false });
  return parts;
}

export function WaffleView({ payload, width, height, colors, fscale = 1 }: { payload: ProportionPayload; width: number; height: number; colors: string[]; fscale?: number }) {
  const { theme, axis } = useTheme();
  const accent = cssVar("--accent", resolveColor("sky"));
  const cells = useMemo(() => waffleCells(payload, colors, accent), [payload, colors, accent]);
  const single = payload.values.length === 1 && payload.values[0] >= 0 && payload.values[0] <= 1;
  const legend = !!cells && !single && cells.some((c) => c.filled && c.name);
  const legendH = legend ? Math.round(12 * fscale) : 0;
  const side = Math.max(10, Math.min(width, height - legendH));
  const ox = (width - side) / 2;
  const gap = Math.max(0.75, (side / 10) * 0.12);
  const total = useMemo(() => payload.values.reduce((a, v) => (Number.isFinite(v) && v > 0 ? a + v : a), 0), [payload]);

  const definition = useMemo(() => defineChart({
    marks: [waffleY(cells ?? [], {
      y: "n", unit: 1, columns: 10, gap, key: "k",
      fill: (d) => d.color,
    })],
    scales: { x: null, y: null }, guides: false, theme,
    margin: { top: 0, left: ox, right: width - ox - side, bottom: height - side },
    focusRing: false, keyboard: false,
    tooltip: tip((points) => {
      const d = points[0]?.datum as Cells | undefined;
      if (!d || !d.filled) return { title: "", rows: [] };
      const share = single ? d.n : total > 0 && d.value != null ? (d.value / total) * 100 : 0;
      return {
        title: d.name || (single ? "" : `#${d.k + 1}`),
        rows: single
          ? [{ label: "", value: `${formatScalar(d.n)}%` }]
          : [{ label: "", value: tipValue(d.value) }, { label: "share", value: `${formatScalar(Math.round(share * 10) / 10)}%` }],
      };
    }),
  }), [cells, gap, theme, ox, side, width, height, single, total]);

  if (payload.values.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  if (!cells) return <div style={{ width, height }} />;
  const named = legend ? cells.filter((c) => c.filled).slice(0, 4).filter((c) => c.name) : [];
  return (
    <div className="sol-chart" style={{ width, height, position: "relative" }}>
      <Chart definition={definition} width={width} height={height} ariaLabel="waffle" tabIndex={-1} />
      {legend && (
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: ox, top: side, width: side, height: legendH, display: "flex", flexWrap: "wrap", alignContent: "flex-start", alignItems: "center", columnGap: 8, boxSizing: "border-box", fontSize: 8.5 * fscale, color: axis, lineHeight: `${legendH}px`, overflow: "hidden", whiteSpace: "nowrap", pointerEvents: "none" }}
        >
          {named.map((c) => (
            <span key={c.k} style={{ display: "inline-flex", alignItems: "center", gap: 3, flex: "none" }}>
              <span style={{ width: 6, height: 6, background: c.color, flex: "none" }} />
              <span style={{ maxWidth: 52 * fscale, overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
