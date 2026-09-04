// Frame-input EXAMPLE hints: a node class declares, per frame input, a tiny
// example frame (columns + a few sample rows) and hovering that input's socket
// shows it as a floating mini-table (FrameHintLayer). The declaration lives on
// the CLASS (static `frameHints`, keyed by input key) — the same
// declare-on-the-class shape as `literals`/`stringLiterals` — so the sample sits
// next to the socket it documents and survives minification (no name lookups).
// frameLabelGrammar gives the input its terse role LABEL; the hint is the worked example.

import type { FrameColType } from "./frame";
import { createValueStore } from "./storeKit";

export type FrameHintColumn = {
  name: string;
  type: FrameColType;
  /** 3–5 sample cells; a date column's cells are day serials (formatted by the
   *  layer through `formatFrameCell`, so they render as the app default). */
  cells: (string | number | boolean)[];
};
export type FrameHint = { columns: FrameHintColumn[] };

/** Read a node class's declared hint for one input, if any. */
export function frameHintFor(node: object, socketKey: string): FrameHint | undefined {
  const ctor = node.constructor as { frameHints?: Record<string, FrameHint> };
  return ctor.frameHints?.[socketKey];
}

/** The hovered socket's screen rect (the layer positions off its left edge). */
export type HintAnchor = { left: number; right: number; centerY: number };

/** The floating layer carries one of two payloads at a time (one open at a time):
 *  the declared EXAMPLE mini-table for an unwired frame input, or a live VALUE peek
 *  of a socket's output — a scaled-down Display (hover peek on any socket). */
export type FrameHintState =
  | { kind: "example"; hint: FrameHint; anchor: HintAnchor }
  | { kind: "value"; value: unknown; nodeId: string; anchor: HintAnchor };

export const frameHintStore = createValueStore<FrameHintState>();
