// [[C96]] chartOptionsAreMatplotlib, [[C100]] chartIsAValue
import { solError, type SolError } from "../errorValue";
import type { ChartValue, XYPayload } from "../chartValue";

const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);

/** One Merge Plots source as XY series on a shared numeric plane, its own options baked in as each series' style. */
export function sourceAsXY(cv: ChartValue, plotNo: number): Pick<XYPayload, "series" | "xcats" | "xDate"> | SolError {
  const o = cv.options ?? {};
  const style = (many: boolean) => ({
    ...(o.color && !many ? { color: o.color } : {}),
    ...(o.markersize !== undefined ? { markersize: o.markersize } : {}),
    ...(o.linewidth !== undefined ? { linewidth: o.linewidth } : {}),
    ...(o.alpha !== undefined ? { alpha: o.alpha } : {}),
  });
  if (cv.payload?.kind === "xy") {
    const many = cv.payload.series.length > 1;
    const st = style(many);
    return {
      series: cv.payload.series.map((s) => ({ ...s, ...st, name: (many ? s.name : cv.title || s.name) ?? "" })),
      xcats: cv.payload.xcats,
      xDate: cv.payload.xDate,
    };
  }
  if (cv.op === "column" || cv.op === "bar") {
    return solError("#TYPE!", `Plot ${plotNo} is a ${cv.op} chart; bars can't share an x/y plane with a scatter or XY line`);
  }
  const labels = cv.labels;
  if (labels && labels.length > 0 && !labels.every((l) => typeof l === "number" && Number.isFinite(l))) {
    return solError("#TYPE!", `Plot ${plotNo} plots against text labels, so it can't share an x/y plane with a scatter or XY line`);
  }
  const xAt = (i: number) => (labels && labels.length > 0 ? (labels[i] as number) : i + 1);
  const toPoints = (vals: (number | null)[]) => vals.map((v, i) => { const y = num(v); return y === null ? null : { x: xAt(i), y }; });
  const raw = cv.series && cv.series.length > 0
    ? cv.series.map((s) => ({ name: s.name, values: s.values }))
    : Array.isArray(cv.values) ? [{ name: cv.title ?? "", values: cv.values }]
      : typeof cv.values === "number" ? [{ name: cv.title ?? "", values: [cv.values] }] : [];
  const st = style(raw.length > 1);
  return {
    series: raw.map((s) => ({ name: s.name, points: toPoints(s.values), line: "solid" as const, marker: o.marker ?? false, ...st })),
  };
}
