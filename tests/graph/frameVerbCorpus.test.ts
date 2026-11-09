// [[C130]] rustCore, [[C10]] socketLattice, [[frame-verbs#The corpus]]
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FRAME_OP_KINDS, type FrameOp, type JoinOpts } from "../../src/graph/frameOps";
import { applyVerb, joinFrames, appendFrames, bindColumns } from "./coreVerbs";
import type { FrameValue, FrameColumn, FrameCell } from "../../src/graph/frame";
import { isSolError, solError, type SolErrorCode } from "../../src/graph/errorValue";

const CORPUS_DIR = path.resolve(__dirname, "../../fixtures/frame-verbs");

interface WireColumn { name: string; type: FrameColumn["type"]; values: FrameCell[]; unit?: FrameColumn["unit"]; format?: FrameColumn["format"] }
interface CorpusCase {
  name: string;
  frames: Record<string, { columns: WireColumn[] }>;
  op: { kind: string } & Record<string, unknown>;
  expect?: { columns: WireColumn[] };
  expectError?: string;
}
interface CorpusFile { verb: string; cases: CorpusCase[] }

const BINARY_VERBS = ["join", "append", "bindColumns"] as const;

const PIPELINE_VERB = "pipeline";

const decodeCell = (v: unknown): FrameCell => {
  const nf = (v as { __nf?: string } | null)?.__nf;
  if (nf === "inf") return Infinity;
  if (nf === "-inf") return -Infinity;
  if (nf === "nan") return NaN;
  return v as FrameCell;
};

const decodeInputCell = (v: unknown): FrameCell => {
  const code = (v as { __err?: string } | null)?.__err;
  return typeof code === "string" ? solError(code as SolErrorCode, "corpus") : decodeCell(v);
};

function brand(wire: { columns: WireColumn[] }): FrameValue {
  return {
    __frame: true,
    columns: wire.columns.map((c) => ({ ...c, values: c.values.map(decodeInputCell) })),
  };
}

function dump(f: FrameValue): WireColumn[] {
  return f.columns.map((c) => ({
    name: c.name, type: c.type,
    values: c.values.map((v): FrameCell => {
      if (typeof v === "number" && Object.is(v, -0)) return 0;
      if (isSolError(v)) return { __err: v.code } as unknown as FrameCell;
      return v;
    }),
    ...(c.unit ? { unit: c.unit } : {}), ...(c.format ? { format: c.format } : {}),
  }));
}

function decodeColumns(wire: { columns: WireColumn[] }): WireColumn[] {
  return wire.columns.map((c) => ({ ...c, values: c.values.map(decodeCell) }));
}

const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json")).sort();
const corpus: CorpusFile[] = files.map((f) => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), "utf8")));

describe.each(corpus.map((c) => [c.verb, c] as const))("corpus: %s", (_verb, file) => {
  it.each(file.cases.map((c) => [c.name, c] as const))("%s", (_name, kase) => {
    const inputs = Object.fromEntries(Object.entries(kase.frames).map(([k, w]) => [k, brand(w)]));
    const before = Object.fromEntries(Object.entries(inputs).map(([k, f]) => [k, dump(f)]));
    let out: FrameValue | undefined;
    let err: unknown;
    try {
      if (kase.op.kind === "join") {
        const { kind: _kind, ...opts } = kase.op;
        out = joinFrames(inputs.left, inputs.right, opts as unknown as JoinOpts);
      } else if (kase.op.kind === "append") {
        out = appendFrames((kase.op.frames as string[]).map((n) => inputs[n]));
      } else if (kase.op.kind === "bindColumns") {
        out = bindColumns((kase.op.frames as string[]).map((n) => inputs[n]));
      } else if (kase.op.kind === "pipeline") {
        out = (kase.op.ops as FrameOp[]).reduce((f, o) => applyVerb(f, o), inputs.in);
      } else {
        out = applyVerb(inputs.in, kase.op as unknown as FrameOp);
      }
    } catch (e) { err = e; }
    if (kase.expectError !== undefined) {
      expect(isSolError(err), `expected ${kase.expectError}, got ${JSON.stringify(out && dump(out))}`).toBe(true);
      expect((err as { code: string }).code).toBe(kase.expectError);
    } else {
      expect(err, `oracle threw: ${(err as Error)?.message ?? err}`).toBeUndefined();
      expect(dump(out!)).toEqual(decodeColumns(kase.expect!));
    }
    for (const [k, f] of Object.entries(inputs)) {
      expect(dump(f), `the verb mutated input frame "${k}"`).toEqual(before[k]);
    }
  });
});

describe("corpus completeness — every verb has a fixture file", () => {
  const INVENTORY: readonly string[] = [...FRAME_OP_KINDS, ...BINARY_VERBS, PIPELINE_VERB];

  it("fixture files cover the verb inventory exactly", () => {
    const covered = new Set(corpus.map((c) => c.verb));
    const missing = INVENTORY.filter((k) => !covered.has(k));
    const unknown = [...covered].filter((v) => !INVENTORY.includes(v));
    expect(missing, "verbs without corpus fixtures — a verb without cases does not ship").toEqual([]);
    expect(unknown, "fixture files for verbs outside FRAME_OP_KINDS + BINARY_VERBS").toEqual([]);
  });

  it("every fixture file has cases, each named uniquely", () => {
    for (const file of corpus) {
      expect(file.cases.length, `${file.verb}.json is empty`).toBeGreaterThan(0);
      const names = file.cases.map((c) => c.name);
      expect(new Set(names).size, `${file.verb}.json has duplicate case names`).toBe(names.length);
    }
  });
});
