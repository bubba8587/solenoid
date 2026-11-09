// [[C107]] obsidianPlugin
import type { SolError } from "../../../src/graph/errorValue";
import type { FrameColType, FrameValue } from "../../../src/graph/frame";
import type { FrameOp } from "../../../src/graph/frameOps";
import type { FormatAnnotation } from "../../../src/graph/formatAnnotationStore";

export interface FrameRef {
  readonly __frameRef: number;
}
export function isFrameRef(v: unknown): v is FrameRef {
  return typeof v === "object" && v !== null && "__frameRef" in v;
}
export interface FrameSchemaColumn {
  name: string;
  type: FrameColType;
}

export function collectPreview(_out: unknown, _n?: number): Promise<FrameValue | SolError | null> {
  return Promise.resolve(null);
}

export function readFrame(_v: unknown): Promise<FrameValue | SolError | null> {
  return Promise.resolve(null);
}

export function refWithFormats(ref: FrameRef, _formats: Record<string, FormatAnnotation>): FrameRef {
  return ref;
}

export function onCoreFrames(_inputs: readonly FrameValue[], _run: (handles: string[]) => string): FrameValue {
  throw new Error("a note holds no frames on the core");
}

export function attachPivotLayout(_frame: FrameValue, _wire: unknown): void {}

export function frameFnOnCore(_name: string, _frames: readonly FrameValue[], _args: readonly unknown[] = [], _units = false):
  { frame: FrameValue; value?: unknown } | { value: unknown } | null {
  return null;
}

export function encodeOpCells(op: FrameOp): FrameOp {
  return op;
}
