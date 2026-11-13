// [[B11]] maximalMerge, [[reports-and-notes#A box]]
// A Dashboard box's Filter: the one its value's popup carries, narrowing the box the way the popup narrows the view. A
// table's rows hold every word (`cardMatches`, the Table popup's test), read from the whole table, not its preview; a
// Pivot and a Profile narrow themselves; a Gantt keeps its matching tasks (`ganttMatching`); a Record or Cards figure
// narrows its records on the core (`setRecordQuery`), as the popup does.
import { isChartValue, type ChartValue } from "../chartValue";
import { isFrameValue, type FrameValue } from "../frame";
import { pivotLayoutOf } from "../pivotLayout";
import { describeTilesOf } from "../describeProfile";
import { cardMatches } from "../cardLayout";
import { fullList, frameRows } from "../listPreview";
import { frameFormatStore } from "../frameFormatStore";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { fmtCell } from "./FrameDisplay";
import { ganttMatching } from "./ganttFilter";
import { recordFilterTarget } from "./recordNav";
import type { GanttPayload } from "@solenoid/gantt-layout";

/** How a box's Filter narrows it: a table's rows, a view that filters itself (Pivot, Profile), a Gantt's tasks, a
 *  Record's records. Null when the value's popup has no Filter. */
export type BoxFilterKind = "rows" | "view" | "gantt" | "records";

export function boxFilterKind(value: unknown, sourceId: string | undefined): BoxFilterKind | null {
  if (isFrameValue(value)) return pivotLayoutOf(value) || describeTilesOf(value) ? "view" : "rows";
  if (!isChartValue(value)) return null;
  if (value.op === "gantt" && value.payload?.kind === "gantt") return "gantt";
  if (value.op === "record" && sourceId && recordFilterTarget(sourceId)) return "records";
  return null;
}

const matches = (n: number) => `${n} ${n === 1 ? "match" : "matches"}`;

type Filtered = { frame: FrameValue; matched: number; total: number };
const cache = new WeakMap<FrameValue, { key: string; out: Filtered }>();

/** The rows holding every word of `query`, each cell read as the box shows it; the frame itself when blank. */
export function filterFrameRows(frame: FrameValue, query: string, sourceId?: string): Filtered {
  const q = query.trim();
  if (!q) return { frame, matched: frameRows(frame), total: frameRows(frame) };
  const key = `${sourceId ?? ""}\u0001${q}\u0001${frameFormatStore.version()}`;
  const hit = cache.get(frame);
  if (hit?.key === key) return hit.out;
  const whole = fullList(frame);
  const annOf = (c: { name: string; format?: FormatAnnotation }) =>
    (sourceId ? frameFormatStore.get(sourceId, c.name) : undefined) ?? c.format;
  const anns = whole.columns.map(annOf);
  const total = frameRows(whole);
  const keep: number[] = [];
  for (let r = 0; r < total; r++) {
    if (cardMatches(whole.columns.map((c, j) => fmtCell(c.values[r] ?? null, c.type, anns[j])), q)) keep.push(r);
  }
  const out: Filtered = {
    frame: {
      __frame: true,
      columns: whole.columns.map((c) => ({
        ...c,
        values: keep.map((r) => c.values[r] ?? null),
        ...(c.raw ? { raw: keep.map((r) => c.raw![r]) } : {}),
      })) as FrameValue["columns"],
    },
    matched: keep.length,
    total,
  };
  cache.set(frame, { key, out });
  return out;
}

/** A Gantt's matching tasks, or the chart itself when blank. */
export function filterGantt(chart: ChartValue, query: string): { chart: ChartValue; matched: number | null } {
  if (!query.trim() || chart.payload?.kind !== "gantt") return { chart, matched: null };
  const f = ganttMatching(chart.payload as GanttPayload, query);
  return { chart: { ...chart, payload: f.payload }, matched: f.matches };
}

/** What the Filter field trails while it holds text: `3 of 12` rows, `4 matches`, or nothing for a view. */
export function boxFilterCount(kind: BoxFilterKind, value: unknown, query: string, sourceId?: string): string | undefined {
  if (!query.trim()) return undefined;
  if (kind === "rows" && isFrameValue(value)) {
    const f = filterFrameRows(value, query, sourceId);
    return `${f.matched} of ${f.total}`;
  }
  if (kind === "gantt" && isChartValue(value)) {
    const m = filterGantt(value, query).matched;
    return m === null ? undefined : matches(m);
  }
  if (kind === "records" && isChartValue(value) && value.payload?.kind === "record") return matches(value.payload.total);
  return undefined;
}
