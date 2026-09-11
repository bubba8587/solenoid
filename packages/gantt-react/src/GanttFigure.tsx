import { useCallback, useMemo, useRef, useState } from "react";
import type { UIEvent, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import {
  buildRows,
  buildScale,
  buildBars,
  buildLinks,
  buildColumns,
  formatCell,
  DEFAULT_ROW_HEIGHT,
  TIER_HEIGHT,
  type GanttPayload,
  type FrameBar,
  type FrameLink,
  type GanttColors,
} from "@solenoid/gantt-layout";
import { ganttStyles } from "./styles";

export interface GanttFigureProps {
  payload: GanttPayload;
  /** Total figure width in px (grid pane + timeline); split at an internal splitter. */
  width: number;
  height: number;
  /** Windowed rows (the popup) vs a capped snapshot (the canvas). */
  virtualize?: boolean;
  fontScale?: number;
  /** Optional overrides; omitted, the figure reads the app's CSS variables. */
  colors?: Partial<GanttColors>;
}

/** Canvas snapshot row cap, mirroring Record's 60-card cap (TablePopup precedent). */
const CANVAS_CAP = 60;
const MIN_GRID_W = 96;
const BUFFER_ROWS = 6;

export function GanttFigure({ payload, width, height, virtualize, fontScale = 1 }: GanttFigureProps) {
  const rowHeight = Math.round(DEFAULT_ROW_HEIGHT * fontScale);

  // Geometry that only depends on the payload + row height (not on scroll or the splitter).
  const columns = useMemo(() => buildColumns(payload), [payload]);
  const gridNaturalW = useMemo(() => columns.reduce((s, c) => s + c.width, 0), [columns]);

  // The grid defaults to its CONTENT width (name + the columns that fit), not a fixed fraction —
  // so no empty band, and never a clipped header. The user can drag the splitter from there.
  const [gridW, setGridW] = useState(() => {
    const target = Math.min(gridNaturalW, Math.max(MIN_GRID_W, width * 0.55));
    return fitColumns(columns, target).reduce((s, c) => s + c.width, 0);
  });
  // Columns that fit the current grid width; trailing ones are DROPPED, never clipped.
  const visibleCols = useMemo(() => fitColumns(columns, gridW), [columns, gridW]);
  const timelineW = Math.max(80, width - gridW - 1);

  const rows = useMemo(() => buildRows(payload, rowHeight), [payload, rowHeight]);
  const scale = useMemo(() => buildScale(payload, timelineW), [payload, timelineW]);
  const allBars = useMemo(() => buildBars(payload, rows, scale), [payload, rows, scale]);
  const allLinks = useMemo(() => buildLinks(payload, rows, [], scale, rowHeight), [payload, rows, scale, rowHeight]);

  const barsByRow = useMemo(() => {
    const m = new Map<string, FrameBar>();
    for (const b of allBars) m.set(b.rowId, b);
    return m;
  }, [allBars]);

  const contentW = (scale.to - scale.from) * scale.pxPerDay;
  const contentH = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : 0;
  const headerH = scale.tiers.length * TIER_HEIGHT;
  const bodyH = Math.max(0, height - headerH);

  // Vertical scroll shared between the two panes.
  const [scrollTop, setScrollTop] = useState(0);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const timeScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const onScroll = useCallback((from: "grid" | "time") => (e: UIEvent<HTMLDivElement>) => {
    if (syncing.current) { syncing.current = false; return; }
    const top = e.currentTarget.scrollTop;
    setScrollTop(top);
    const other = from === "grid" ? timeScrollRef.current : gridScrollRef.current;
    if (other && other.scrollTop !== top) { syncing.current = true; other.scrollTop = top; }
  }, []);

  // Which rows to render. Virtualized: a window around the scroll; capped: the first N.
  const capped = !virtualize && rows.length > CANVAS_CAP;
  const rowWindow = useMemo(() => {
    if (!virtualize) return { start: 0, end: Math.min(rows.length, CANVAS_CAP) };
    if (!rowHeight) return { start: 0, end: rows.length };
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - BUFFER_ROWS);
    const end = Math.min(rows.length, Math.ceil((scrollTop + bodyH) / rowHeight) + BUFFER_ROWS);
    return { start, end };
  }, [virtualize, rows.length, rowHeight, scrollTop, bodyH]);

  const visibleRows = rows.slice(rowWindow.start, rowWindow.end);
  const visTop = rowWindow.start * rowHeight; // rows are uniform height
  const cappedRows = capped ? rows.slice(0, CANVAS_CAP) : rows;

  // Links whose either endpoint is in (or near) the visible band.
  const visLinks = useMemo(() => {
    if (!virtualize) return allLinks;
    const lo = visTop - rowHeight * BUFFER_ROWS;
    const hi = visTop + visibleRows.length * rowHeight + rowHeight * BUFFER_ROWS;
    return allLinks.filter((l) => {
      const ys = l.points.map((p) => p.y);
      const min = Math.min(...ys), max = Math.max(...ys);
      return max >= lo && min <= hi;
    });
  }, [virtualize, allLinks, visTop, visibleRows.length, rowHeight]);

  // Splitter drag.
  const dragRef = useRef<{ x0: number; w0: number } | null>(null);
  const onSplitDown = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x0: e.clientX, w0: gridW };
  }, [gridW]);
  const onSplitMove = useCallback((e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x0;
    setGridW(Math.max(MIN_GRID_W, Math.min(width - 80, dragRef.current.w0 + dx)));
  }, [width]);
  const onSplitUp = useCallback((e: ReactPointerEvent) => {
    dragRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  const rowsToShow = virtualize ? visibleRows : cappedRows;

  return (
    <div
      className="solenoid-gantt nowheel nodrag nokeys"
      role="treegrid"
      aria-rowcount={rows.length}
      aria-colcount={visibleCols.length}
      style={{ width, height, fontSize: `${12 * fontScale}px` }}
    >
      <style>{ganttStyles}</style>

      {/* ── Grid pane ── */}
      <div className="solenoid-gantt__grid" style={{ width: gridW }}>
        <div className="solenoid-gantt__grid-head" style={{ height: headerH }} role="row">
          {visibleCols.map((c) => (
            <div key={c.key} className="solenoid-gantt__gh" role="columnheader" style={{ width: c.width, textAlign: c.align }}>
              {c.label}
            </div>
          ))}
        </div>
        <div className="solenoid-gantt__grid-scroll" ref={gridScrollRef} onScroll={onScroll("grid")} style={{ height: bodyH }}>
          <div style={{ height: contentH, position: "relative" }}>
            {rowsToShow.map((row) => {
              if (row.section) {
                return (
                  <div key={row.id} className="solenoid-gantt__section" role="row" style={{ top: row.y, height: row.h }}>
                    {row.id.replace(/^__section:/, "")}
                  </div>
                );
              }
              const t = row.taskIndex >= 0 ? payload.tasks[row.taskIndex] : undefined;
              if (!t) return null;
              return (
                <div key={row.id} className={`solenoid-gantt__row${row.summary ? " is-summary" : ""}`} role="row" aria-level={row.level + 1} style={{ top: row.y, height: row.h }}>
                  {visibleCols.map((c) => (
                    <div
                      key={c.key}
                      role="gridcell"
                      className={`solenoid-gantt__cell${c.align === "right" ? " is-num" : ""}${c.key === "name" ? " is-name" : ""}`}
                      style={{ width: c.width, textAlign: c.align, paddingLeft: c.key === "name" ? 6 + row.level * 16 : undefined }}
                      title={c.key === "name" ? t.name : undefined}
                    >
                      {formatCell(c.key, t, payload)}
                    </div>
                  ))}
                </div>
              );
            })}
            {capped && (
              <div className="solenoid-gantt__more" style={{ top: CANVAS_CAP * rowHeight }}>
                +{rows.length - CANVAS_CAP} more — expand to see all
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Splitter ── */}
      <div
        className="solenoid-gantt__splitter"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onSplitDown}
        onPointerMove={onSplitMove}
        onPointerUp={onSplitUp}
      />

      {/* ── Timeline pane ── */}
      <div className="solenoid-gantt__timeline" ref={timeScrollRef} onScroll={onScroll("time")} style={{ height }}>
        <div style={{ width: contentW, height: headerH + contentH, position: "relative" }}>
          {/* Sticky header */}
          <div className="solenoid-gantt__thead" style={{ height: headerH, width: contentW }}>
            {scale.tiers.map((tier, ti) => (
              <div key={ti} className="solenoid-gantt__tier" style={{ height: TIER_HEIGHT, top: ti * TIER_HEIGHT }}>
                {tier.cells.map((cell, ci) => (
                  <div key={ci} className="solenoid-gantt__tcell" style={{ left: cell.x, width: cell.w }}>
                    {cell.w > 14 ? cell.label : ""}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Background: shading + grid lines + markers (cheap, full size) */}
          <svg className="solenoid-gantt__bg" width={contentW} height={contentH} style={{ top: headerH }} aria-hidden="true">
            {payload.view.weekends !== false && shadingRects(payload, scale, contentH)}
            {gridLines(scale, contentH)}
            {markerLines(payload, scale, contentH)}
          </svg>

          {/* Bars for the shown rows */}
          <svg className="solenoid-gantt__bars" width={contentW} height={contentH} style={{ top: headerH }} aria-hidden="true">
            <defs>
              <pattern id="gantt-crit-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line className="solenoid-gantt__hatch" x1="0" y1="0" x2="0" y2="5" />
              </pattern>
            </defs>
            {rowsToShow.map((row) => {
              const bar = barsByRow.get(row.id);
              return bar ? <Bar key={row.id} bar={bar} payload={payload} /> : null;
            })}
          </svg>

          {/* Dependency links overlay (own SVG, hit paths carry pointer-events) */}
          <svg className="solenoid-gantt__links" width={contentW} height={contentH} style={{ top: headerH }}>
            {visLinks.map((l, i) => (
              <Link key={`${l.from}->${l.to}:${i}`} link={l} />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

function Bar({ bar, payload }: { bar: FrameBar; payload: GanttPayload }) {
  const t = payload.tasks[bar.taskIndex];
  const cls = (base: string) =>
    `${base}${bar.critical ? " is-critical" : ""}${bar.violated ? " is-violated" : ""}${bar.late ? " is-late" : ""}`;
  const title = t ? t.name : undefined;

  if (bar.kind === "milestone") {
    const cx = bar.x + bar.w / 2, cy = bar.y + bar.h / 2, r = bar.w / 2;
    return (
      <g>
        <path className={cls("solenoid-gantt__diamond")} d={`M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`}>
          {title && <title>{title}</title>}
        </path>
        {bar.label && (
          <text className="solenoid-gantt__blabel" x={bar.x + bar.w + 4} y={bar.y + bar.h / 2 + 4} textAnchor="start">{bar.label.text}</text>
        )}
      </g>
    );
  }
  if (bar.kind === "summary") {
    const rail = 3;
    const legW = Math.min(8, bar.w / 2);
    const d = `M${bar.x} ${bar.y} L${bar.x + bar.w} ${bar.y} L${bar.x + bar.w} ${bar.y + bar.h} L${bar.x + bar.w - legW} ${bar.y + rail} L${bar.x + legW} ${bar.y + rail} L${bar.x} ${bar.y + bar.h} Z`;
    return (
      <g>
        <path className={cls("solenoid-gantt__bracket")} d={d}>{title && <title>{title}</title>}</path>
      </g>
    );
  }
  return (
    <g>
      {bar.baseline && (
        <rect className="solenoid-gantt__baseline" x={bar.baseline.x} y={bar.y + bar.h + 1} width={bar.baseline.w} height={3} rx={1} />
      )}
      <rect
        className={cls("solenoid-gantt__bar")}
        x={bar.x}
        y={bar.y}
        width={bar.w}
        height={bar.h}
        rx={2}
        style={bar.color ? { fill: bar.color } : undefined}
      >
        {title && <title>{title}</title>}
      </rect>
      {bar.progressW > 0 && (
        <rect className={cls("solenoid-gantt__progress")} x={bar.x} y={bar.y} width={bar.progressW} height={bar.h} rx={2} />
      )}
      {bar.critical && !bar.color && (
        // Non-color cue for the critical path (WCAG 1.4.1): a hatch texture + a darker outline.
        <>
          <rect className="solenoid-gantt__crit-hatch" x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={2} fill="url(#gantt-crit-hatch)" />
          <rect className="solenoid-gantt__crit-outline" x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={2} />
        </>
      )}
      {(bar.violated || bar.late) && (
        <rect className="solenoid-gantt__bar-flag" x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={2} strokeDasharray={bar.violated ? "3 2" : undefined} />
      )}
      {bar.deadlineX != null && <DeadlineFlag x={bar.deadlineX} rowY={bar.y} rowH={bar.h} late={bar.late} />}
      {bar.label && (
        <text className="solenoid-gantt__blabel" x={bar.label.anchor === "end" ? bar.x - 4 : bar.x + bar.w + 4} y={bar.y + bar.h / 2 + 4} textAnchor={bar.label.anchor}>
          {bar.label.text}
        </text>
      )}
    </g>
  );
}

/** A small down-pointing flag at the deadline day — a marker, not a moved date. A late task
 *  (finish past the deadline) turns the flag into the error color (the non-color cue is its
 *  distinct pennant shape, present regardless of color). */
function DeadlineFlag({ x, rowY, rowH, late }: { x: number; rowY: number; rowH: number; late: boolean }) {
  const top = rowY - 2;
  const h = rowH + 4;
  return (
    <g className={`solenoid-gantt__deadline${late ? " is-late" : ""}`}>
      <line x1={x} y1={top} x2={x} y2={top + h} />
      <path d={`M${x} ${top} L${x + 6} ${top + 3} L${x} ${top + 6} Z`} />
    </g>
  );
}

function Link({ link }: { link: FrameLink }) {
  const d = link.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const cls = `solenoid-gantt__link${link.violated ? " is-violated" : link.critical ? " is-critical" : ""}`;
  const arrow = arrowPath(link.arrow.x, link.arrow.y, link.arrow.dir);
  // The dependency is stated in the visible grid (Predecessors column); the tooltip is
  // structural only — the relationship type, never dynamic names/dates.
  const label = `${link.type} dependency`;
  return (
    <g>
      {/* wide invisible hit path */}
      <path className="solenoid-gantt__hit" d={d} fill="none">
        <title>{label}</title>
      </path>
      <path className={cls} d={d} fill="none" strokeDasharray={link.violated ? "4 3" : undefined} />
      <path className={`${cls} solenoid-gantt__arrow`} d={arrow} />
    </g>
  );
}

function arrowPath(x: number, y: number, dir: "left" | "right"): string {
  const s = 4;
  const dx = dir === "right" ? -s : s;
  return `M${x} ${y} L${x + dx} ${y - s} L${x + dx} ${y + s} Z`;
}

/** The prefix of `cols` that fits `avail` px; the name column is always kept even if it alone
 *  exceeds the width. Trailing columns that don't fit are dropped, never clipped. */
function fitColumns(cols: ReturnType<typeof buildColumns>, avail: number): ReturnType<typeof buildColumns> {
  const out: typeof cols = [];
  let used = 0;
  for (const c of cols) {
    if (out.length && used + c.width > avail) break;
    out.push(c);
    used += c.width;
  }
  return out.length ? out : cols.slice(0, 1);
}

function shadingRects(payload: GanttPayload, scale: { from: number; to: number; pxPerDay: number }, h: number) {
  const holidays = new Set(payload.holidays);
  const out: ReactElement[] = [];
  payload.nonWorking.forEach(([a, b], i) => {
    const from = Math.max(a, scale.from);
    const to = Math.min(b + 1, scale.to);
    if (to <= from) return;
    out.push(
      <rect
        key={i}
        className={holidays.has(a) ? "solenoid-gantt__holiday" : "solenoid-gantt__weekend"}
        x={(from - scale.from) * scale.pxPerDay}
        y={0}
        width={(to - from) * scale.pxPerDay}
        height={h}
      />,
    );
  });
  return out;
}

function gridLines(scale: { tiers: { cells: { x: number }[] }[]; }, h: number) {
  const primary = scale.tiers[scale.tiers.length - 1];
  if (!primary) return null;
  return primary.cells.map((c, i) => (
    <line key={i} className="solenoid-gantt__gridline" x1={c.x} y1={0} x2={c.x} y2={h} />
  ));
}

function markerLines(payload: GanttPayload, scale: { from: number; to: number; pxPerDay: number }, h: number) {
  const out: ReactElement[] = [];
  const x = (s: number) => (s - scale.from) * scale.pxPerDay;
  const within = (s: number) => s >= scale.from && s < scale.to;
  if (payload.today != null && payload.view.today !== false && within(payload.today)) {
    out.push(<line key="today" className="solenoid-gantt__today" x1={x(payload.today)} y1={0} x2={x(payload.today)} y2={h} />);
  }
  if (payload.statusDate != null && payload.view.status !== false && within(payload.statusDate)) {
    out.push(<line key="status" className="solenoid-gantt__status" x1={x(payload.statusDate)} y1={0} x2={x(payload.statusDate)} y2={h} />);
  }
  return out;
}
