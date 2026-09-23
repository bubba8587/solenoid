// [[D18]] frameLabelHint, [[C13]] frameLabelGrammar
// A node class declares a per-input example frame (static `frameHints`) that hovering the socket shows as a mini-table;
// on the class, so it sits beside the socket it documents and survives minification.

import type { FrameColType } from "./frame";
import { createValueStore } from "./storeKit";

export type FrameHintColumn = {
  name: string;
  type: FrameColType;
  /** 3 to 5 sample cells; a date column holds day serials, formatted by the layer. */
  cells: (string | number | boolean)[];
};
export type FrameHint = { columns: FrameHintColumn[] };

export function frameHintFor(node: object, socketKey: string): FrameHint | undefined {
  const ctor = node.constructor as { frameHints?: Record<string, FrameHint> };
  return ctor.frameHints?.[socketKey];
}

export type HintAnchor = { left: number; right: number; centerY: number };

/** One payload at a time: the example mini-table for an unwired frame input, or a live value peek. */
export type FrameHintState =
  | { kind: "example"; hint: FrameHint; anchor: HintAnchor }
  | { kind: "value"; value: unknown; nodeId: string; anchor: HintAnchor };

export const frameHintStore = createValueStore<FrameHintState>();
