// [[C10]] socketLattice, [[C130]] rustCore
// A verb's static output shape is the core's verb run on an empty frame of its input's shape (graph-core.md § Phase D),
// so it can never disagree with what the verb answers; a verb that refuses the shape throws, as it would on data.
import { isFrameValue, type FrameValue } from "./frame";
import type { GraphNode } from "./graphModel";
import type { FrameHint } from "./frameHint";
import { cardOutputsOnCore } from "./nodeOnCore";
import { onCoreFrames, encodeOpCells, frameFnOnCore, type FrameSchemaColumn } from "./frameBackend";
import { wasmInvokeSync } from "./engineWasm";
import type { FrameOp, JoinOpts } from "./frameOps";

export type ShapeColumn = FrameSchemaColumn;

export interface Shape {
  columns: ShapeColumn[];
  dynamic?: boolean;
}

export function columnNamesOf(shape: Shape | null | undefined): string[] {
  return shape ? shape.columns.map((c) => c.name) : [];
}

export function shapeOfFrameValue(f: FrameValue): Shape {
  return { columns: f.columns.map((c) => ({ name: c.name, type: c.type })) };
}

export function emptyFrameOf(shape: Shape): FrameValue {
  return { __frame: true, columns: shape.columns.map((c) => ({ name: c.name, type: c.type, values: [] })) };
}

/** How many leading key columns a totals row writes "Grand Total" / "Total" into, so they run as text. */
export function totalLabelledKeys(depth: number, nKeys: number): number {
  return depth === 0 || nKeys === 0 ? 0 : 1 + Math.min(Math.abs(depth) - 1, nKeys - 1);
}

/** One row of plausible cells for `shape` (text, a number, TRUE, a date), for a card whose columns appear only once a
 *  row does: the card's own function run on it answers the columns it makes. */
export function sampleRowOf(shape: Shape): FrameValue {
  const cell = (t: string) => (t === "string" ? "a" : t === "logical" ? true : t === "date" ? 45000 : 1);
  return { __frame: true, columns: shape.columns.map((c) => ({ name: c.name, type: c.type, values: [cell(c.type)] })) };
}

/** The columns of `outKey` as the card's own body on the core answers it over sample `inputs`, the card untouched
 *  (`cardOutputsOnCore`); null when the body answers no frame there. */
export function cardShapeOnCore(node: GraphNode, outKey: string, inputs: Record<string, unknown[]>): Shape | null {
  const v = cardOutputsOnCore(node, inputs)?.[outKey];
  return isFrameValue(v) ? shapeOfFrameValue(v) : null;
}

/** A frame hint's sample table as a frame. */
export function hintFrame(hint: FrameHint): FrameValue {
  return { __frame: true, columns: hint.columns.map((c) => ({ name: c.name, type: c.type, values: [...c.cells] })) };
}

/** The columns a core frame function (`frame_fns.rs`) answers over one sample row of each input. */
export function sampleShapeOnCore(name: string, inputs: readonly Shape[], args: unknown[] = []): Shape | null {
  const r = frameFnOnCore(name, inputs.map(sampleRowOf), args);
  return r && "frame" in r ? shapeOfFrameValue(r.frame) : null;
}

function onEmpty(inputs: readonly Shape[], run: (handles: string[]) => string): Shape {
  return shapeOfFrameValue(onCoreFrames(inputs.map(emptyFrameOf), run));
}

/** The shape `op` leaves. A pivot's and a split's columns grow with the data (`dynamic`), and a pivot's totals write
 *  "Total" into its leading row keys, which an empty frame never shows. */
export function shapeOf(op: FrameOp, input: Shape): Shape {
  const out = onEmpty([input], (h) => wasmInvokeSync<string>("engine_apply", { handle: h[0], op: encodeOpCells(op) }));
  if (op.kind === "pivot") {
    const labelled = totalLabelledKeys(op.rowTotalDepth ?? 0, op.rowFields.filter((f) => f.trim() !== "").length);
    return { columns: out.columns.map((c, k) => (k < labelled ? { ...c, type: "string" } : c)), dynamic: true };
  }
  return op.kind === "splitColumn" && op.delimiter !== "" ? { ...out, dynamic: true } : out;
}

export function shapeOfJoin(left: Shape, right: Shape, opts: JoinOpts): Shape {
  return onEmpty([left, right], (h) => wasmInvokeSync<string>("engine_join", { left: h[0], right: h[1], opts }));
}

export function shapeOfAppend(shapes: readonly Shape[]): Shape {
  return onEmpty(shapes, (h) => wasmInvokeSync<string>("engine_append", { handles: h }));
}

export function shapeOfAddIndex(input: Shape, name: string): Shape {
  return shapeOf({ kind: "addIndex", name, start: 1 }, input);
}

export function shapeOfSplitColumn(input: Shape, column: string, delimiter: string): Shape {
  return shapeOf({ kind: "splitColumn", column, delimiter }, input);
}
