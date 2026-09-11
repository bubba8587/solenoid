// ganttSvg(payload, opts) → a standalone SVG string. This is the headless export (the popup's
// "copy as SVG", the webpage export, a Report snapshot). It draws the tree grid AND the
// timeline so the file stands alone. Colors are passed in (an SVG cannot read CSS variables);
// omitted, a light-legible default is used so text is never invisible.

import type { GanttPayload } from "./payload";
import type { GanttColors, GridColumn } from "./frame";
import { DEFAULT_COLORS } from "./frame";
import { layoutGantt, TIER_HEIGHT } from "./layout";
import { civilFromSerial, MONTH_NAMES } from "./serial";
import { formatCell } from "./cell";

export interface GanttSvgOptions {
  width: number;
  height?: number;
  colors?: Partial<GanttColors>;
  /** Grid pane width in px; default: the sum of the columns' widths. */
  gridWidth?: number;
  rowHeight?: number;
  fontFamily?: string;
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function ganttSvg(payload: GanttPayload, opts: GanttSvgOptions): string {
  const colors: GanttColors = { ...DEFAULT_COLORS, ...(opts.colors ?? {}) };
  const columns = payload.view.columns ?? ["name", "start", "finish", "duration"];
  const gridCols = colsFor(columns);
  const gridWidth = opts.gridWidth ?? gridCols.reduce((s, c) => s + c.width, 0);

  const timelineWidth = Math.max(120, opts.width - gridWidth);
  const frame = layoutGantt(payload, { width: timelineWidth, rowHeight: opts.rowHeight });
  const headerH = frame.headerHeight;
  const bodyH = frame.contentHeight;
  const totalH = headerH + bodyH;
  const font = opts.fontFamily ?? "system-ui, sans-serif";

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${totalH}" ` +
      `viewBox="0 0 ${opts.width} ${totalH}" font-family="${esc(font)}" font-size="12">`,
  );
  parts.push(`<rect width="${opts.width}" height="${totalH}" fill="${colors.surface}"/>`);

  // ── Timeline group, offset right of the grid pane ──
  parts.push(`<g transform="translate(${gridWidth},0)">`);

  // Non-working shading (behind everything), full body height.
  for (const s of frame.shading) {
    const fill = s.kind === "holiday" ? colors.holiday : colors.weekend;
    parts.push(`<rect x="${r(s.x)}" y="${headerH}" width="${r(s.w)}" height="${r(bodyH)}" fill="${fill}"/>`);
  }
  // Vertical grid lines.
  for (const x of frame.gridColumns) {
    parts.push(`<line x1="${r(x)}" y1="${headerH}" x2="${r(x)}" y2="${r(totalH)}" stroke="${colors.gridLine}" stroke-width="1"/>`);
  }
  // Header tiers.
  let ty = 0;
  for (const tier of frame.scale.tiers) {
    for (const c of tier.cells) {
      parts.push(`<rect x="${r(c.x)}" y="${ty}" width="${r(c.w)}" height="${TIER_HEIGHT}" fill="none" stroke="${colors.border}" stroke-width="1"/>`);
      if (c.w > 8) {
        parts.push(
          `<text x="${r(c.x + 4)}" y="${ty + TIER_HEIGHT / 2 + 4}" fill="${colors.textDim}" font-size="10">${esc(clip(c.label, c.w))}</text>`,
        );
      }
    }
    ty += TIER_HEIGHT;
  }
  parts.push(`<line x1="0" y1="${headerH}" x2="${r((frame.scale.to - frame.scale.from) * frame.scale.pxPerDay)}" y2="${headerH}" stroke="${colors.borderStrong}" stroke-width="1"/>`);

  // Row baselines (faint).
  for (const row of frame.rows) {
    parts.push(`<line x1="0" y1="${r(headerH + row.y + row.h)}" x2="${r((frame.scale.to - frame.scale.from) * frame.scale.pxPerDay)}" y2="${r(headerH + row.y + row.h)}" stroke="${colors.gridLine}" stroke-width="1"/>`);
  }

  // Baseline ghosts (under the bars).
  for (const bar of frame.bars) {
    if (!bar.baseline) continue;
    parts.push(
      `<rect x="${r(bar.baseline.x)}" y="${r(headerH + bar.y + bar.h)}" width="${r(bar.baseline.w)}" height="3" rx="1" fill="${colors.baseline}"/>`,
    );
  }

  // Bars / diamonds / brackets.
  for (const bar of frame.bars) {
    const y = headerH + bar.y;
    if (bar.kind === "milestone") {
      const cx = bar.x + bar.w / 2;
      const cy = y + bar.h / 2;
      const rr = bar.w / 2;
      const fill = bar.critical ? colors.critical : colors.milestone;
      parts.push(`<path d="M${r(cx)} ${r(cy - rr)} L${r(cx + rr)} ${r(cy)} L${r(cx)} ${r(cy + rr)} L${r(cx - rr)} ${r(cy)} Z" fill="${fill}" stroke="${strokeFor(bar, colors)}" stroke-width="${bar.violated ? 1.5 : 0}"/>`);
    } else if (bar.kind === "summary") {
      const fill = bar.critical ? colors.critical : colors.summary;
      // A bracket: a bar with downward end-caps.
      parts.push(`<path d="${bracketPath(bar.x, y, bar.w, bar.h)}" fill="${fill}"/>`);
    } else {
      const fill = bar.color ?? (bar.critical ? colors.critical : colors.bar);
      const prog = bar.critical ? colors.criticalProgress : colors.barProgress;
      parts.push(`<rect x="${r(bar.x)}" y="${r(y)}" width="${r(bar.w)}" height="${r(bar.h)}" rx="2" fill="${fill}" opacity="${bar.color ? 1 : 0.85}"/>`);
      if (bar.progressW > 0) {
        parts.push(`<rect x="${r(bar.x)}" y="${r(y)}" width="${r(bar.progressW)}" height="${r(bar.h)}" rx="2" fill="${prog}"/>`);
      }
      if (bar.violated || bar.late) {
        // Non-color cue (WCAG 1.4.1): a striped hatch overlay + outline for critical/violated.
        parts.push(`<rect x="${r(bar.x)}" y="${r(y)}" width="${r(bar.w)}" height="${r(bar.h)}" rx="2" fill="none" stroke="${colors.violated}" stroke-width="1.5" stroke-dasharray="${bar.violated ? "3 2" : "0"}"/>`);
      }
    }
    if (bar.label) {
      const lx = bar.label.anchor === "end" ? bar.x - 4 : bar.x + bar.w + 4;
      parts.push(`<text x="${r(lx)}" y="${r(y + bar.h / 2 + 4)}" fill="${colors.text}" font-size="11" text-anchor="${bar.label.anchor}">${esc(bar.label.text)}</text>`);
    }
  }

  // Dependency links.
  for (const link of frame.links) {
    const d = link.points.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)} ${r(headerH + p.y)}`).join(" ");
    const stroke = link.violated ? colors.violated : link.critical ? colors.critical : colors.link;
    const dash = link.violated ? ` stroke-dasharray="4 3"` : "";
    parts.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.3"${dash}/>`);
    parts.push(arrowHead(link.arrow.x, headerH + link.arrow.y, link.arrow.dir, stroke));
  }

  // Today / status lines.
  if (frame.todayX != null) {
    parts.push(`<line x1="${r(frame.todayX)}" y1="${headerH}" x2="${r(frame.todayX)}" y2="${r(totalH)}" stroke="${colors.today}" stroke-width="1.5"/>`);
  }
  if (frame.statusX != null) {
    parts.push(`<line x1="${r(frame.statusX)}" y1="${headerH}" x2="${r(frame.statusX)}" y2="${r(totalH)}" stroke="${colors.status}" stroke-width="1.5" stroke-dasharray="2 2"/>`);
  }

  parts.push(`</g>`); // end timeline

  // ── Grid pane (left) ──
  parts.push(gridPane(payload, frame.rows, gridCols, gridWidth, headerH, colors));

  // Divider between panes.
  parts.push(`<line x1="${gridWidth}" y1="0" x2="${gridWidth}" y2="${r(totalH)}" stroke="${colors.borderStrong}" stroke-width="1"/>`);

  parts.push(`</svg>`);
  return parts.join("");
}

function gridPane(
  payload: GanttPayload,
  rows: ReturnType<typeof layoutGantt>["rows"],
  cols: GridColumn[],
  gridWidth: number,
  headerH: number,
  colors: GanttColors,
): string {
  const parts: string[] = [];
  // Column headers on the bottom tier row.
  let x = 0;
  for (const c of cols) {
    parts.push(`<text x="${r(c.align === "right" ? x + c.width - 6 : x + 6)}" y="${headerH - 6}" fill="${colors.textDim}" font-size="10" text-anchor="${c.align === "right" ? "end" : "start"}">${esc(c.label)}</text>`);
    x += c.width;
  }
  parts.push(`<line x1="0" y1="${headerH}" x2="${gridWidth}" y2="${headerH}" stroke="${colors.borderStrong}" stroke-width="1"/>`);

  for (const row of rows) {
    const yMid = headerH + row.y + row.h / 2 + 4;
    if (row.section) {
      parts.push(`<rect x="0" y="${r(headerH + row.y)}" width="${gridWidth}" height="${r(row.h)}" fill="${colors.gridLine}"/>`);
      parts.push(`<text x="8" y="${r(yMid)}" fill="${colors.text}" font-size="11" font-weight="600">${esc(row.id.replace(/^__section:/, ""))}</text>`);
      continue;
    }
    const t = row.taskIndex >= 0 ? payload.tasks[row.taskIndex] : undefined;
    if (!t) continue;
    let cx = 0;
    for (const c of cols) {
      const val = formatCell(c.key, t, payload);
      const indent = c.key === "name" ? row.level * 16 + 6 : 6;
      const tx = c.align === "right" ? cx + c.width - 6 : cx + indent;
      const weight = c.key === "name" && t.summary ? ' font-weight="600"' : "";
      const fam = c.align === "right" ? ` font-family="${MONO}"` : "";
      parts.push(`<text x="${r(tx)}" y="${r(yMid)}" fill="${colors.text}" font-size="11" text-anchor="${c.align === "right" ? "end" : "start"}"${weight}${fam}>${esc(clip(val, c.width - indent - 6))}</text>`);
      cx += c.width;
    }
  }
  return parts.join("");
}

function bracketPath(x: number, y: number, w: number, h: number): string {
  const cap = Math.min(6, w / 2);
  // A flat top with legs dropping at each end.
  return (
    `M${r(x)} ${r(y)} L${r(x + w)} ${r(y)} L${r(x + w)} ${r(y + h + cap)} L${r(x + w - cap)} ${r(y + h)} ` +
    `L${r(x + cap)} ${r(y + h)} L${r(x)} ${r(y + h + cap)} Z`
  );
}

function arrowHead(x: number, y: number, dir: "left" | "right", fill: string): string {
  const s = 4;
  const dx = dir === "right" ? -s : s;
  return `<path d="M${r(x)} ${r(y)} L${r(x + dx)} ${r(y - s)} L${r(x + dx)} ${r(y + s)} Z" fill="${fill}"/>`;
}

function strokeFor(bar: { violated: boolean }, colors: GanttColors): string {
  return bar.violated ? colors.violated : "none";
}

function colsFor(keys: GanttPayload["view"]["columns"] & {}): GridColumn[] {
  const table: Record<string, GridColumn> = {
    name: { key: "name", label: "Task", width: 200, align: "left" },
    start: { key: "start", label: "Start", width: 92, align: "left" },
    finish: { key: "finish", label: "Finish", width: 92, align: "left" },
    duration: { key: "duration", label: "Days", width: 56, align: "right" },
    float: { key: "float", label: "Float", width: 56, align: "right" },
    complete: { key: "complete", label: "%", width: 44, align: "right" },
    predecessors: { key: "predecessors", label: "Predecessors", width: 160, align: "left" },
  };
  const out: GridColumn[] = [];
  for (const k of keys ?? ["name", "start", "finish", "duration"]) {
    if (table[k] && !out.some((c) => c.key === k)) out.push({ ...table[k] });
  }
  if (!out.some((c) => c.key === "name")) out.unshift({ ...table.name });
  return out;
}

// Rounding + escaping helpers.
function r(n: number): number {
  return Math.round(n * 100) / 100;
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;"));
}
/** Truncate text to roughly fit `px` at the header font (drop, don't overflow). */
function clip(s: string, px: number): string {
  const max = Math.max(0, Math.floor(px / (10 * 0.6)));
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

// Keep MONTH_NAMES/civilFromSerial imported for potential future header polish without churn.
void MONTH_NAMES;
void civilFromSerial;
