// The RenderFrame: what `layoutGantt` emits — plain numbers only, no DOM, no colors. The view
// (gantt-react) and the SVG serializer (svg.ts) both draw from this. Every x/y/w/h is a pixel
// in the timeline's own coordinate space (x grows with time from the window's left edge; y
// grows downward from row 0). The grid pane and the header live outside this box.

import type { LinkType } from "./payload";

export interface ScaleCell {
  /** Left edge in px within the timeline. */
  x: number;
  /** Width in px. */
  w: number;
  label: string;
}

export interface ScaleTier {
  cells: ScaleCell[];
}

export interface FrameScale {
  /** Header tiers, coarsest first (e.g. months over days). */
  tiers: ScaleTier[];
  pxPerDay: number;
  /** The drawn window, whole-day serials; `to` is exclusive (one past the last drawn day). */
  from: number;
  to: number;
}

export interface FrameRow {
  id: string;
  /** Top of the row band in px. */
  y: number;
  /** Row height in px. */
  h: number;
  level: number;
  summary: boolean;
  milestone: boolean;
  /** A section band header row (from group_by), not a task. */
  section?: boolean;
  /** This row has nested children (a phase). Drives aria-expanded and the disclosure caret. */
  hasChildren?: boolean;
  /** The task's index into `payload.tasks`, or -1 for a section band. */
  taskIndex: number;
}

export type BarKind = "task" | "summary" | "milestone";

export interface FrameBar {
  rowId: string;
  taskIndex: number;
  kind: BarKind;
  /** Bar rectangle (or the diamond's bounding box for a milestone). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Progress fill width in px (0 when none). */
  progressW: number;
  critical: boolean;
  violated: boolean;
  late: boolean;
  /** A per-task passthrough color from the payload, if any. */
  color?: string;
  /** Baseline ghost rect, when the payload carries a baseline for this task. */
  baseline?: { x: number; w: number };
  /** Split-bar parts (out-of-sequence progress): each part's rect, in order, with a dotted gap
   *  drawn between them. Absent: one contiguous bar (`x`/`w`). */
  segments?: Array<{ x: number; w: number }>;
  /** X of the deadline day (a flag marker), when the task carries a Deadline. */
  deadlineX?: number;
  /** The label text and where it sits relative to the bar. */
  label?: { text: string; x: number; anchor: "start" | "end"; inside: boolean };
}

export interface FrameLink {
  from: string;
  to: string;
  type: LinkType;
  critical: boolean;
  violated: boolean;
  /** Orthogonal polyline points [{x,y}...] through the timeline. */
  points: Array<{ x: number; y: number }>;
  /** The arrowhead tip (last point) and the direction it points ("left" | "right"). */
  arrow: { x: number; y: number; dir: "left" | "right" };
}

export interface FrameShadeRect {
  x: number;
  w: number;
  /** "weekend" | "holiday" — lets the view/serializer pick a shade if it wants to. */
  kind: "weekend" | "holiday";
}

export interface GridColumn {
  key: "name" | "start" | "finish" | "duration" | "float" | "complete" | "predecessors";
  label: string;
  /** Suggested column width in px. */
  width: number;
  align: "left" | "right";
}

export interface RenderFrame {
  scale: FrameScale;
  rows: FrameRow[];
  bars: FrameBar[];
  links: FrameLink[];
  /** Non-working shading rectangles spanning the full row area. */
  shading: FrameShadeRect[];
  /** Vertical grid lines at each primary-tier boundary, in px. */
  gridColumns: number[];
  /** X of the today line, or null when hidden / outside the window. */
  todayX: number | null;
  /** X of the status-date line, or null. */
  statusX: number | null;
  /** Total drawn timeline width in px. */
  width: number;
  /** Total content height in px (all rows). */
  contentHeight: number;
  /** Header height in px (sum of tier heights). */
  headerHeight: number;
  /** The grid columns for the tree pane (from view.columns). */
  columns: GridColumn[];
}

/** Theme colors the pure SVG serializer needs (it cannot read CSS variables). The React
 *  figure resolves these from the app's design tokens and passes them down; the serializer
 *  falls back to a light-theme-legible set when none are given. */
export interface GanttColors {
  text: string;
  textDim: string;
  border: string;
  borderStrong: string;
  surface: string;
  gridLine: string;
  /** Default bar fill + its progress-fill (darker) variant. */
  bar: string;
  barProgress: string;
  /** Critical path bar + progress. */
  critical: string;
  criticalProgress: string;
  /** Violated (negative float / broken link) accent. */
  violated: string;
  /** Summary bracket. */
  summary: string;
  /** Milestone diamond. */
  milestone: string;
  /** Non-working shading + holiday shading. */
  weekend: string;
  holiday: string;
  /** Today + status marker lines. */
  today: string;
  status: string;
  /** Dependency arrow + baseline ghost. */
  link: string;
  baseline: string;
}

/** A light-theme-legible default, used when no colors are supplied (headless export tests,
 *  a serializer call with only a width). The React figure overrides every field. */
export const DEFAULT_COLORS: GanttColors = {
  text: "#1a1a1a",
  textDim: "#6b7280",
  border: "#d4d4d8",
  borderStrong: "#a1a1aa",
  surface: "#ffffff",
  gridLine: "#ececf0",
  bar: "#5b8def",
  barProgress: "#2f66d4",
  critical: "#e06666",
  criticalProgress: "#c53030",
  violated: "#d81e5b",
  summary: "#4b5563",
  milestone: "#3f3f46",
  weekend: "#f4f4f6",
  holiday: "#fbeaea",
  today: "#e06666",
  status: "#5b8def",
  link: "#6b7280",
  baseline: "#c4b5a0",
};
