import { useMemo } from "react";
import { layoutCalendar, type GanttPayload } from "@solenoid/gantt-layout";
import { ganttStyles } from "./styles";

export interface CalendarViewProps {
  payload: GanttPayload;
  width: number;
  height: number;
  fontScale?: number;
}

/** The calendar sibling of the Gantt figure: the same payload as a month grid. Read-only,
 *  scrolls vertically when the span runs to several months. Styled by the app's design tokens
 *  (they resolve in inline SVG), like the Gantt figure. */
export function CalendarView({ payload, width, height, fontScale = 1 }: CalendarViewProps) {
  const frame = useMemo(() => layoutCalendar(payload, { width }), [payload, width]);
  const cellW = width / 7;

  return (
    <div className="solenoid-gantt solenoid-gantt--calendar nowheel nodrag nokeys" style={{ width, height, fontSize: `${12 * fontScale}px` }}>
      <style>{ganttStyles}</style>
      <div className="solenoid-gantt-cal__scroll" style={{ height }}>
        <svg width={width} height={frame.height} role="img" aria-label="Calendar">
          <defs>
            <pattern id="gantt-cal-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className="solenoid-gantt__hatch" x1="0" y1="0" x2="0" y2="5" />
            </pattern>
          </defs>
          {frame.months.map((m) => (
            <g key={`${m.year}-${m.month}`}>
              <text className="solenoid-gantt-cal__title" x={4} y={m.y + 16}>{m.label}</text>
              {frame.weekdayLabels.map((wd, c) => (
                <text key={c} className="solenoid-gantt-cal__weekday" x={c * cellW + 4} y={m.y + m.headerH + 13}>{wd}</text>
              ))}
              {m.cells.map((cell) => (
                <g key={cell.serial}>
                  {(cell.weekend || cell.holiday) && (
                    <rect className={cell.holiday ? "solenoid-gantt__holiday" : "solenoid-gantt__weekend"} x={cell.x} y={cell.y} width={cell.w} height={cell.h} />
                  )}
                  <rect className="solenoid-gantt-cal__cell" x={cell.x} y={cell.y} width={cell.w} height={cell.h} />
                  {cell.today && <rect className="solenoid-gantt-cal__today" x={cell.x + 1} y={cell.y + 1} width={cell.w - 2} height={cell.h - 2} />}
                  <text className={`solenoid-gantt-cal__daynum${cell.inMonth ? "" : " is-out"}`} x={cell.x + 4} y={cell.y + 12}>{cell.day}</text>
                </g>
              ))}
              {m.chips.map((ch, i) => {
                const cls = `solenoid-gantt__bar${ch.critical ? " is-critical" : ""}`;
                const name = payload.tasks[ch.taskIndex]?.name;
                return (
                  <g key={`chip${i}`}>
                    <rect className={cls} x={ch.x} y={ch.y} width={ch.w} height={ch.h} rx={2} style={ch.color ? { fill: ch.color } : undefined}>
                      {name && <title>{name}</title>}
                    </rect>
                    {ch.critical && !ch.color && <rect className="solenoid-gantt__crit-hatch" x={ch.x} y={ch.y} width={ch.w} height={ch.h} rx={2} fill="url(#gantt-cal-hatch)" />}
                    {(ch.violated || ch.late) && <rect className="solenoid-gantt__bar-flag" x={ch.x} y={ch.y} width={ch.w} height={ch.h} rx={2} strokeDasharray={ch.violated ? "3 2" : undefined} />}
                    {ch.w > 24 && <text className="solenoid-gantt-cal__chip-label" x={ch.x + 4} y={ch.y + ch.h - 3}>{ellipsis(ch.label, ch.w - 6)}</text>}
                  </g>
                );
              })}
              {m.milestones.map((ms, i) => (
                <circle key={`ms${i}`} className={`solenoid-gantt__diamond${ms.critical ? " is-critical" : ""}`} cx={ms.cx} cy={ms.cy} r={3.2}>
                  <title>{payload.tasks[ms.taskIndex]?.name}</title>
                </circle>
              ))}
              {m.overflow.map((o, i) => (
                <text key={`ov${i}`} className="solenoid-gantt-cal__overflow" x={o.x} y={o.y}>+{o.count}</text>
              ))}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/** A monospace-ish ellipsis at ~6px/char, matching the layout package's estimator. */
function ellipsis(text: string, maxPx: number): string {
  const max = Math.max(0, Math.floor(maxPx / (10 * 0.6)));
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}
