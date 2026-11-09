// [[C130]] rustCore
// The core's store of eager frames by handle (`frame_backend.rs`), driven from the tests: a frame in, verbs run on it
// by handle, a frame out. The app reaches it only for the eager frame tools (`frameFnOnCore`); the cards' lazy frames
// are core values (`frame_ref.rs`).
import { wasmInvokeSync, wasmSourceBin, wasmReadBin } from "../../src/graph/engineWasm";
import { encodeBinary, decodeBinary } from "../../src/graph/binaryCells";
import { encodeOpCells } from "../../src/graph/frameBackend";
import type { FrameValue, FrameColumn, FrameCell } from "../../src/graph/frame";
import type { FrameOp, JoinOpts } from "../../src/graph/frameOps";

export type Handle = string;

export interface Preview {
  schema: Omit<FrameColumn, "values" | "raw">[];
  rows: FrameCell[][];
  rowCount: number;
  truncated: boolean;
}

const read = (h: Handle, column?: string, limit?: number) => {
  const b = wasmReadBin(h, column, limit);
  return b && { columns: decodeBinary(b), rowCount: b.rowCount };
};

export function coreStore() {
  return {
    source: async (f: FrameValue): Promise<Handle> => wasmSourceBin(encodeBinary(f)),
    apply: async (h: Handle, op: FrameOp): Promise<Handle> => wasmInvokeSync("engine_apply", { handle: h, op: encodeOpCells(op) }),
    applyMany: async (h: Handle, ops: readonly FrameOp[]): Promise<Handle> => wasmInvokeSync("engine_apply_many", { handle: h, ops: ops.map(encodeOpCells) }),
    join: async (l: Handle, r: Handle, opts: JoinOpts): Promise<Handle> => wasmInvokeSync("engine_join", { left: l, right: r, opts }),
    append: async (hs: readonly Handle[]): Promise<Handle> => wasmInvokeSync("engine_append", { handles: hs }),
    bindColumns: async (hs: readonly Handle[]): Promise<Handle> => wasmInvokeSync("engine_bind_columns", { handles: hs }),
    preview: async (h: Handle, n: number): Promise<Preview> => {
      const r = read(h, undefined, n)!;
      const take = Math.max(0, Math.min(n, r.rowCount));
      const rows: FrameCell[][] = [];
      for (let i = 0; i < take; i++) rows.push(r.columns.map((c) => (i < c.values.length ? c.values[i] : null)));
      return { schema: r.columns.map(({ values: _v, raw: _r, ...c }) => c), rows, rowCount: r.rowCount, truncated: r.rowCount > take };
    },
    collect: async (h: Handle): Promise<FrameValue> => ({ __frame: true, columns: read(h)!.columns }),
    column: async (h: Handle, name: string): Promise<FrameColumn | null> => read(h, name)?.columns[0] ?? null,
    drop: (h: Handle): void => { wasmInvokeSync("engine_drop", { handle: h }); },
  };
}
