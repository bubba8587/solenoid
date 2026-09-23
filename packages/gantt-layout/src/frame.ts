// [[C69]] ganttPackages, [[C100]] chartIsAValue

import type { LinkType } from "./payload";

export interface ScaleCell {
  x: number;
  w: number;
  label: string;
}

export interface ScaleTier {
  cells: ScaleCell[];
}

export interface FrameScale {
  tiers: ScaleTier[];
  pxPerDay: number;
  from: number;
  to: number;
}

export interface FrameRow {
  id: string;
  y: number;
  h: number;
  level: number;
  summary: boolean;
  milestone: boolean;
  section?: boolean;
  hasChildren?: boolean;
  taskIndex: number;
}

export type BarKind = "task" | "summary" | "milestone";

export interface FrameBar {
  rowId: string;
  taskIndex: number;
  kind: BarKind;
  x: number;
  y: number;
  w: number;
  h: number;
  progressW: number;
  critical: boolean;
  violated: boolean;
  late: boolean;
  color?: string;
  baseline?: { x: number; w: number };
  segments?: Array<{ x: number; w: number }>;
  deadlineX?: number;
  label?: { text: string; x: number; anchor: "start" | "end"; inside: boolean };
}

export interface FrameLink {
  from: string;
  to: string;
  type: LinkType;
  critical: boolean;
  violated: boolean;
  points: Array<{ x: number; y: number }>;
  arrow: { x: number; y: number; dir: "left" | "right" };
}

export interface FrameShadeRect {
  x: number;
  w: number;
  kind: "weekend" | "holiday";
}

export interface HistoSegment {
  resourceIndex: number;
  units: number;
  x: number;
  y: number;
  w: number;
  h: number;
  over: boolean;
}

export interface FrameHistogram {
  resources: string[];
  segments: HistoSegment[];
  maxUnits: number;
  capacityY: number;
  legend: Array<{ resourceIndex: number; x: number; label: string }>;
  legendH: number;
  bodyTop: number;
  bodyH: number;
  height: number;
}

export interface GridColumn {
  key: "name" | "start" | "finish" | "duration" | "float" | "complete" | "predecessors";
  label: string;
  width: number;
  align: "left" | "right";
}

export interface RenderFrame {
  scale: FrameScale;
  rows: FrameRow[];
  bars: FrameBar[];
  links: FrameLink[];
  shading: FrameShadeRect[];
  gridColumns: number[];
  todayX: number | null;
  statusX: number | null;
  width: number;
  contentHeight: number;
  headerHeight: number;
  columns: GridColumn[];
  histogram?: FrameHistogram;
}

export interface GanttColors {
  text: string;
  textDim: string;
  border: string;
  borderStrong: string;
  surface: string;
  gridLine: string;
  bar: string;
  barProgress: string;
  critical: string;
  criticalProgress: string;
  violated: string;
  summary: string;
  milestone: string;
  weekend: string;
  holiday: string;
  today: string;
  status: string;
  link: string;
  baseline: string;
}

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
