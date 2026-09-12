// The calendar figure: the SAME GanttPayload drawn as a month grid (the sibling of the Gantt
// timeline, § 6.3). One cell per day, multi-day tasks laid as chips across the days they span,
// milestones as dots, weekends shaded, today outlined. Pure numbers, like the Gantt RenderFrame;
// reuses the serial math and the drawn-finish rule so the two figures agree.

import type { GanttPayload } from "./payload";
import { resolveWindow, drawnLastDay } from "./scale";
import { civilFromSerial, startOfWeek, dayOfWeek, MONTH_NAMES_FULL, DAY_NAMES } from "./serial";

export interface CalCell {
  serial: number;
  day: number; // 1..31
  x: number;
  y: number;
  w: number;
  h: number;
  inMonth: boolean;
  weekend: boolean;
  holiday: boolean;
  today: boolean;
}

export interface CalChip {
  taskIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color?: string;
  critical: boolean;
  violated: boolean;
  late: boolean;
  /** The task continues past this week's edge (draw a flat, not rounded, end). */
  clipLeft: boolean;
  clipRight: boolean;
}

export interface CalMilestone {
  taskIndex: number;
  cx: number;
  cy: number;
  label: string;
  critical: boolean;
}

export interface CalMonthBlock {
  year: number;
  month: number; // 1..12
  label: string;
  x: number;
  y: number;
  w: number;
  /** Header (title) band height and the weekday-row height, from the block top. */
  headerH: number;
  weekdayH: number;
  rowH: number;
  weeks: number;
  cells: CalCell[];
  chips: CalChip[];
  milestones: CalMilestone[];
  /** "+N more" overflow markers when a week has more lanes than the cap. */
  overflow: Array<{ x: number; y: number; count: number }>;
}

export interface CalendarFrame {
  width: number;
  height: number;
  weekStart: number; // 0 = Sunday, 1 = Monday
  weekdayLabels: string[];
  months: CalMonthBlock[];
}

export interface CalendarOptions {
  width: number;
  /** Max chip lanes drawn per week before an overflow marker; default 4. */
  laneCap?: number;
}

const MONTH_HEADER_H = 24;
const WEEKDAY_H = 18;
const DAY_NUM_H = 15;
const LANE_H = 15;
const MONTH_GAP = 12;
const CHIP_PAD = 2;

export function layoutCalendar(payload: GanttPayload, opts: CalendarOptions): CalendarFrame {
  const laneCap = opts.laneCap ?? 4;
  const width = opts.width;
  const cellW = width / 7;
  const weekStart = payload.view.week === "us" ? 0 : 1;
  const minutes = payload.view.minutes;

  const { from, to } = resolveWindow(payload);
  // Whole weeks covering the window.
  const gridStart = startOfWeek(from, weekStart);
  const gridEnd = startOfWeek(to - 1, weekStart) + 6;

  const holidays = new Set(payload.holidays);
  const weekendDays = new Set(payload.weekend.length ? payload.weekend : [0, 6]);
  const today = payload.today;

  // Group weeks into month blocks by the month of each week's mid day (its 4th day), so every
  // week belongs to exactly one month and adjacent months never duplicate a boundary week.
  interface WeekSpec { start: number; year: number; month: number; }
  const weekSpecs: WeekSpec[] = [];
  for (let ws = gridStart; ws <= gridEnd; ws += 7) {
    const mid = civilFromSerial(ws + 3);
    weekSpecs.push({ start: ws, year: mid.year, month: mid.month });
  }

  const months: CalMonthBlock[] = [];
  let y = 0;
  let i = 0;
  while (i < weekSpecs.length) {
    const { year, month } = weekSpecs[i];
    const blockWeeks: WeekSpec[] = [];
    while (i < weekSpecs.length && weekSpecs[i].year === year && weekSpecs[i].month === month) {
      blockWeeks.push(weekSpecs[i]);
      i++;
    }
    months.push(buildMonth(payload, { year, month, weeks: blockWeeks }, {
      width, cellW, y, weekendDays, holidays, today, minutes, laneCap,
    }));
    y = months[months.length - 1].y + monthHeight(months[months.length - 1]);
    y += MONTH_GAP;
  }

  const height = months.length ? y - MONTH_GAP : 0;
  const weekdayLabels = Array.from({ length: 7 }, (_, k) => DAY_NAMES[(weekStart + k) % 7]);
  return { width, height, weekStart, weekdayLabels, months };
}

function monthHeight(m: CalMonthBlock): number {
  return m.headerH + m.weekdayH + m.weeks * m.rowH;
}

interface MonthInput { year: number; month: number; weeks: Array<{ start: number }>; }
interface MonthCtx {
  width: number;
  cellW: number;
  y: number;
  weekendDays: Set<number>;
  holidays: Set<number>;
  today: number | null;
  minutes?: boolean;
  laneCap: number;
}

function buildMonth(payload: GanttPayload, input: MonthInput, ctx: MonthCtx): CalMonthBlock {
  const { year, month, weeks } = input;
  const { cellW, width, laneCap } = ctx;
  const gridY = ctx.y + MONTH_HEADER_H + WEEKDAY_H;

  // First pass: lanes per week, to fix the row height for the whole month.
  const perWeek = weeks.map((wk) => planWeek(payload, wk.start, ctx));
  const maxLanes = Math.min(laneCap, Math.max(1, ...perWeek.map((w) => w.laneCount)));
  const rowH = DAY_NUM_H + maxLanes * LANE_H + 4;

  const cells: CalCell[] = [];
  const chips: CalChip[] = [];
  const milestones: CalMilestone[] = [];
  const overflow: CalMonthBlock["overflow"] = [];

  weeks.forEach((wk, wi) => {
    const rowTop = gridY + wi * rowH;
    for (let col = 0; col < 7; col++) {
      const serial = wk.start + col;
      const c = civilFromSerial(serial);
      cells.push({
        serial,
        day: c.day,
        x: col * cellW,
        y: rowTop,
        w: cellW,
        h: rowH,
        inMonth: c.month === month && c.year === year,
        weekend: ctx.weekendDays.has(dayOfWeek(serial)),
        holiday: ctx.holidays.has(serial),
        today: ctx.today != null && Math.floor(ctx.today) === serial,
      });
    }
    const plan = perWeek[wi];
    for (const ch of plan.chips) {
      if (ch.lane >= maxLanes) continue; // folded into the overflow marker
      const t = payload.tasks[ch.taskIndex];
      chips.push({
        taskIndex: ch.taskIndex,
        x: ch.startCol * cellW + CHIP_PAD,
        y: rowTop + DAY_NUM_H + ch.lane * LANE_H,
        w: (ch.endCol - ch.startCol + 1) * cellW - CHIP_PAD * 2,
        h: LANE_H - 2,
        label: t.name,
        color: t.color,
        critical: !!t.critical && payload.view.critical !== false,
        violated: !!t.violated,
        late: !!t.late,
        clipLeft: ch.clipLeft,
        clipRight: ch.clipRight,
      });
    }
    for (const ms of plan.milestones) {
      const t = payload.tasks[ms.taskIndex];
      milestones.push({
        taskIndex: ms.taskIndex,
        cx: ms.col * cellW + cellW / 2,
        cy: rowTop + DAY_NUM_H + Math.min(maxLanes, 1) * LANE_H - LANE_H / 2,
        label: t.name,
        critical: !!t.critical && payload.view.critical !== false,
      });
    }
    // Overflow markers for lanes beyond the cap.
    const hidden = plan.chips.filter((c) => c.lane >= maxLanes);
    if (hidden.length) {
      const byCol = new Map<number, number>();
      for (const c of hidden) for (let col = c.startCol; col <= c.endCol; col++) byCol.set(col, (byCol.get(col) ?? 0) + 1);
      for (const [col, count] of byCol) overflow.push({ x: col * cellW + 3, y: rowTop + rowH - 12, count });
    }
  });

  return {
    year, month, label: `${MONTH_NAMES_FULL[month - 1]} ${year}`,
    x: 0, y: ctx.y, w: width,
    headerH: MONTH_HEADER_H, weekdayH: WEEKDAY_H, rowH, weeks: weeks.length,
    cells, chips, milestones, overflow,
  };
}

interface PlannedChip { taskIndex: number; startCol: number; endCol: number; lane: number; clipLeft: boolean; clipRight: boolean; }
interface PlannedMilestone { taskIndex: number; col: number; }

/** Assign this week's task spans to lanes (greedy), and collect milestone dots. */
function planWeek(payload: GanttPayload, weekStart: number, ctx: MonthCtx): { chips: PlannedChip[]; milestones: PlannedMilestone[]; laneCount: number } {
  const weekEnd = weekStart + 6;
  const spans: Array<{ taskIndex: number; startCol: number; endCol: number; clipLeft: boolean; clipRight: boolean }> = [];
  const milestones: PlannedMilestone[] = [];

  payload.tasks.forEach((t, taskIndex) => {
    if (t.summary) return; // summaries are not drawn as calendar chips
    if (t.milestone) {
      const s = Math.floor(t.start);
      if (s >= weekStart && s <= weekEnd) milestones.push({ taskIndex, col: s - weekStart });
      return;
    }
    const s = Math.floor(t.start);
    const e = drawnLastDay(t.finish, ctx.minutes);
    const from = Math.max(s, weekStart);
    const to = Math.min(e, weekEnd);
    if (to < from) return;
    spans.push({ taskIndex, startCol: from - weekStart, endCol: to - weekStart, clipLeft: s < weekStart, clipRight: e > weekEnd });
  });

  // Greedy lane assignment by start column.
  spans.sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);
  const laneEnds: number[] = []; // last endCol occupied per lane
  const chips: PlannedChip[] = spans.map((sp) => {
    let lane = laneEnds.findIndex((end) => end < sp.startCol);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(sp.endCol); } else { laneEnds[lane] = sp.endCol; }
    return { ...sp, lane };
  });
  return { chips, milestones, laneCount: Math.max(laneEnds.length, milestones.length ? 1 : 0) };
}
