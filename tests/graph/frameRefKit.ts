// [[C130]] rustCore
// Lazy frames for the tests (`frame_ref.rs`): a frame with an op planned on it, a ref's plan as the verbs read it,
// and what the frame layer did since the last ask.
import "../../src/graph/nodeBoundary";
import { frameRefThen, frameRefWire } from "../../src/graph/engineWasm/solenoid_graph.js";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import { isFrameRef, type FrameRef } from "../../src/graph/frameBackend";
import type { FrameOp } from "../../src/graph/frameOps";
import type { FrameValue } from "../../src/graph/frame";

/** The rows a sketch-mode flush samples (`frame_ref.rs` `SKETCH_SAMPLE_ROWS`). */
export const SKETCH_SAMPLE_ROWS = 10_000;

/** A frame (a value or a ref) with `op` planned after its own ops. */
export function planned(frame: FrameValue | FrameRef, op: FrameOp | Record<string, unknown>): FrameRef {
  return frameRefThen(frame, JSON.stringify(op)) as FrameRef;
}

/** A frame as a ref planning nothing that changes it. */
export const lazy = (f: FrameValue | FrameRef): FrameRef => planned(f, { kind: "drop", columns: [] });

/** A ref's frozen form: its frame's cells and its plan. */
export function wireOf(ref: unknown): { base: { __frame: { columns: { name: string }[] } }; plan: { kind: string }[] } {
  if (!isFrameRef(ref)) throw new Error(`not a lazy frame: ${JSON.stringify(ref)}`);
  return (JSON.parse(frameRefWire(ref) ?? "null") as { __lazy: ReturnType<typeof wireOf> }).__lazy;
}

/** The kinds of a ref's planned ops. */
export const planOf = (ref: unknown): string[] => wireOf(ref).plan.map((op) => op.kind);

/** What the frame layer did since the last ask: plans run, ops applied, frame values taken in, refs read whole. */
export function frameStats(): { runs: number; ops: number; taken: number; collects: number } {
  return wasmInvokeSync("engine_frame_stats");
}
