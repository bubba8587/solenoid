// [[C107]] obsidianPlugin
import type { SolError } from "../../../src/graph/errorValue";
import type { FrameColType, FrameValue } from "../../../src/graph/frame";

export type FrameRef = never;
export interface FrameSchemaColumn {
  name: string;
  type: FrameColType;
}

export function collectPreview(_out: FrameValue | SolError | null, _n?: number): Promise<FrameValue | SolError | null> {
  return Promise.resolve(null);
}

export function readFrame(_v: FrameValue | SolError | null | undefined): Promise<FrameValue | SolError | null> {
  return Promise.resolve(null);
}
