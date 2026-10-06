// [[C100]] chartIsAValue, [[D98]] tanstackDrawsCharts
// Waterfall, Candlestick and Boxplot: band-indexed figures built from bars, links and ticks.
import { useMemo } from "react";
import { barY, defineChart, dot, link, ruleY, tickY, waterfall, type ChartPoint, type ChartTooltipContent } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { valueTickFormat, sanitizeChartLabel } from "../chartCore";
import { PLOT_TOP, Fig, tip, tipValue, valueDomain, useInk, EmptyFigure } from "./kit";
import type { BoxplotPayload, CandlePayload, WaterfallPayload } from "../../chartValue";


// The y axis column the canvas figures reserved, so the band math below can size labels and boxes.
const axisW = (fs: number) => Math.round(30 * fs);
const MARGIN_R = 4;


/** A label cut to fit `px` at a 9px-times-`fs` font, by an average glyph width (no DOM measuring in a definition). */
function fitText(s: string, px: number, fs: number): string {
  return sanitizeChartLabel(s, Math.max(1, Math.floor(px / (9 * fs * 0.58))));
}

function valueAxis(values: number[], px: number, zero: boolean, fs: number, grid: string) {
  const { domain, ticks } = valueDomain(values, undefined, undefined, px, zero);
  return {
    scale: scaleLinear().domain(domain),
    grid: { stroke: grid, strokeOpacity: 1 },
    axis: { ticks: { values: ticks, format: valueTickFormat(values, ticks), size: 0 }, tickLabels: { fontSize: 9 * fs } },
  };
}

// ─── Waterfall ─────────────────────────────────────────────────────────────────

type Step = { i: number; name: string; v: number | null };

export function WaterfallView({ payload, width, height, fscale = 1 }: { payload: WaterfallPayload; width: number; height: number; fscale?: number }) {
  const { theme, grid, axis, up, down, neutral } = useInk();
  const fs = fscale;
  const definition = useMemo(() => {
    const n = payload.values.length;
    if (n === 0) return null;
    const steps: Step[] = payload.values.map((v, i) => ({ i, name: payload.names[i] ?? "", v }));
    const bars = waterfall(steps, { value: "v", total: payload.total }).map((d) => ({
      ...d, slot: d.kind === "total" ? n : (d as unknown as Step).i, label: d.kind === "total" ? "Total" : (d as unknown as Step).name,
    }));
    const slots = n + (payload.total ? 1 : 0);
    const names = [...steps.map((s) => s.name), "Total"];
    // A null step keeps its slot and holds the running total, so connectors carry across it.
    let cum = 0;
    const levels = steps.map((s) => (cum += s.v ?? 0));
    const joins = levels.slice(0, slots - 1).map((y, k) => ({ a: k, b: k + 1, y }));
    const bw = (width - axisW(fs) - MARGIN_R) / slots;
    const ticks = bw >= 20 ? Array.from({ length: slots }, (_, k) => k) : [];
    const kindFill = { increase: up, decrease: down, total: neutral } as const;
    return defineChart({
      marks: [
        decorative(link(joins, { x1: "a", x2: "b", y1: "y", y2: "y", stroke: axis, strokeOpacity: 0.6, strokeWidth: 0.75, strokeDasharray: "2 2", lineCap: "butt" })),
        barY(bars, { x: "slot", y1: "start", y2: "end", key: "slot", fill: (d) => kindFill[d.kind] }),
        ruleY([0], { stroke: theme.foreground, strokeOpacity: 0.5, strokeWidth: 1 }),
      ],
      scales: {
        x: {
          scale: scaleBand<number>().domain(Array.from({ length: slots }, (_, k) => k)).padding(0.34),
          axis: { ticks: { values: ticks, format: (k: number | string) => fitText(names[Number(k)] ?? "", bw - 2, fs), size: 0 }, tickLabels: { fontSize: 9 * fs } },
        },
        y: valueAxis(bars.flatMap((d) => [d.start, d.end]), height - PLOT_TOP - 20, true, fs, grid),
      },
      margin: { top: PLOT_TOP, right: MARGIN_R }, theme, keyboard: false,
      tooltip: tip((points: readonly ChartPoint[]): ChartTooltipContent => {
        const d = points[0]?.datum as (typeof bars)[number] | undefined;
        if (!d) return { rows: [] };
        return d.kind === "total"
          ? { title: "Total", rows: [{ label: "", value: tipValue(d.end) }] }
          : { title: d.label, rows: [{ label: "Change", value: tipValue(d.delta) }, { label: "Running total", value: tipValue(d.end) }] };
      }),
    });
  }, [payload, width, height, fs, theme, grid, axis, up, down, neutral]);
  if (!definition) return <EmptyFigure />;
  return (
    <Fig width={width} height={height}>
      <Chart definition={definition} width={width} height={height} ariaLabel="waterfall chart" tabIndex={-1} />
    </Fig>
  );
}

// ─── Candlestick ───────────────────────────────────────────────────────────────

type Candle = { i: number; label: string; o: number; h: number; l: number; c: number };

/** A candle with any null of the four, or high below low, is a gap; open and close clamp into [low, high]. */
function candleRows(p: CandlePayload): { n: number; rows: Candle[] } {
  const n = Math.min(p.open.length, p.high.length, p.low.length, p.close.length);
  const rows: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = p.open[i], h = p.high[i], l = p.low[i], c = p.close[i];
    if (o == null || h == null || l == null || c == null || h < l) continue;
    const clampIn = (v: number) => Math.min(h, Math.max(l, v));
    rows.push({ i, label: String(p.labels[i] ?? ""), o: clampIn(o), h, l, c: clampIn(c) });
  }
  return { n, rows };
}

export function CandleView({ payload, width, height, fscale = 1 }: { payload: CandlePayload; width: number; height: number; fscale?: number }) {
  const { theme, grid, up, down } = useInk();
  const fs = fscale;
  const definition = useMemo(() => {
    const { n, rows } = candleRows(payload);
    if (rows.length === 0) return null;
    const bw = (width - axisW(fs) - MARGIN_R) / n;
    const bodyW = Math.max(1.5, Math.min(9, bw * 0.6));
    const col = (d: Candle) => (d.c >= d.o ? up : down);
    const flat = rows.filter((d) => d.c === d.o);
    const lastLabel = String(payload.labels[n - 1] ?? "");
    return defineChart({
      marks: [
        decorative(link(rows, { x1: "i", x2: "i", y1: "l", y2: "h", stroke: col, strokeWidth: 1, lineCap: "butt" })),
        barY(rows, { x: "i", y1: "o", y2: "c", key: "i", fill: col, maxThickness: bodyW }),
        // A body with open equal to close has no height; a tick keeps it visible.
        decorative(tickY(flat, { x: "i", y: "c", stroke: col, strokeWidth: 1, length: bodyW })),
      ],
      scales: {
        x: {
          scale: scaleBand<number>().domain(Array.from({ length: n }, (_, k) => k)).padding(0),
          axis: {
            ticks: { values: n > 1 ? [0, n - 1] : [0], format: (k: number | string) => (Number(k) === 0 ? String(payload.labels[0] ?? "") : lastLabel), size: 0 },
            // First and last label sit flush with the plot's edges, as the canvas drew them.
            tickLabels: n > 1
              ? { fontSize: 9 * fs, anchor: ({ value }) => (Number(value) === 0 ? "start" : "end"), dx: ({ value, bandwidth }) => (Number(value) === 0 ? -bandwidth / 2 : bandwidth / 2) }
              : { fontSize: 9 * fs },
          },
        },
        y: valueAxis(rows.flatMap((d) => [d.l, d.h]), height - PLOT_TOP - 20, false, fs, grid),
      },
      margin: { top: PLOT_TOP, right: MARGIN_R }, theme, keyboard: false,
      tooltip: tip((points: readonly ChartPoint[]): ChartTooltipContent => {
        const d = points[0]?.datum as Candle | undefined;
        if (!d) return { rows: [] };
        return {
          title: d.label, color: col(d),
          rows: [["Open", d.o], ["High", d.h], ["Low", d.l], ["Close", d.c]].map(([label, v]) => ({ label: label as string, value: tipValue(v) })),
        };
      }),
    });
  }, [payload, width, height, fs, theme, grid, up, down]);
  if (payload.close.length === 0) return <EmptyFigure />;
  return (
    <Fig width={width} height={height}>
      {definition && <Chart definition={definition} width={width} height={height} ariaLabel="candlestick chart" tabIndex={-1} />}
    </Fig>
  );
}

// ─── Boxplot ───────────────────────────────────────────────────────────────────

type Box = BoxplotPayload["boxes"][number] & { i: number };

export function BoxplotView({ payload, width, height, fscale = 1 }: { payload: BoxplotPayload; width: number; height: number; fscale?: number }) {
  const { theme, grid, accent, down } = useInk();
  const fs = fscale;
  const definition = useMemo(() => {
    const boxes: Box[] = payload.boxes.map((b, i) => ({ ...b, i }));
    const n = boxes.length;
    if (n === 0) return null;
    const bw = (width - axisW(fs) - MARGIN_R) / n;
    const boxW = Math.max(6, Math.min(36, bw * 0.55));
    const whiskers = boxes.flatMap((b) => [{ i: b.i, a: b.lo, z: b.q1 }, { i: b.i, a: b.q3, z: b.hi }]);
    const caps = boxes.flatMap((b) => [{ i: b.i, y: b.lo }, { i: b.i, y: b.hi }]);
    const outliers = boxes.flatMap((b) => b.outliers.map((v, k) => ({ i: b.i, v, k: `${b.i}:${k}`, name: b.name })));
    const values = boxes.flatMap((b) => [b.lo, b.hi, ...b.outliers]);
    const labelled = bw >= 20 && boxes.some((b) => b.name);
    return defineChart({
      marks: [
        decorative(link(whiskers, { x1: "i", x2: "i", y1: "a", y2: "z", stroke: accent, strokeWidth: 1, lineCap: "butt" })),
        decorative(tickY(caps, { x: "i", y: "y", stroke: accent, strokeWidth: 1, length: boxW / 2 })),
        barY(boxes, { x: "i", y1: "q1", y2: "q3", key: "i", fill: accent, fillOpacity: 0.22, stroke: accent, strokeWidth: 1, maxThickness: boxW }),
        decorative(tickY(boxes, { x: "i", y: "med", stroke: accent, strokeWidth: 1.6, length: boxW })),
        dot(outliers, { x: "i", y: "v", key: "k", r: 1.6, fill: down }),
      ],
      scales: {
        x: {
          scale: scaleBand<number>().domain(boxes.map((b) => b.i)).padding(0),
          axis: {
            ticks: { values: labelled ? boxes.map((b) => b.i) : [], format: (k: number | string) => fitText(boxes[Number(k)]?.name ?? "", bw - 2, fs), size: 0 },
            tickLabels: { fontSize: 9 * fs },
          },
        },
        y: valueAxis(values, height - PLOT_TOP - 20, false, fs, grid),
      },
      margin: { top: PLOT_TOP, right: MARGIN_R }, theme, keyboard: false,
      tooltip: tip((points: readonly ChartPoint[]): ChartTooltipContent => {
        const d = points[0]?.datum as (Box | { i: number; v: number; name: string }) | undefined;
        if (!d) return { rows: [] };
        if ("v" in d) return { title: d.name, rows: [{ label: "Outlier", value: tipValue(d.v) }] };
        return {
          title: d.name,
          rows: [
            { label: "Max", value: tipValue(d.hi) }, { label: "Q3", value: tipValue(d.q3) }, { label: "Median", value: tipValue(d.med) },
            { label: "Q1", value: tipValue(d.q1) }, { label: "Min", value: tipValue(d.lo) },
            ...(d.outliers.length ? [{ label: "Outliers", value: String(d.outliers.length) }] : []),
          ],
        };
      }),
    });
  }, [payload, width, height, fs, theme, grid, accent, down]);
  if (!definition) return <EmptyFigure />;
  return (
    <Fig width={width} height={height}>
      <Chart definition={definition} width={width} height={height} ariaLabel="boxplot" tabIndex={-1} />
    </Fig>
  );
}
