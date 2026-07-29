import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyVerb, joinFrames, appendFrames, FRAME_OP_KINDS, type FrameOp, type JoinOpts } from "./frameVerbs";
import type { FrameValue, FrameColumn, FrameCell } from "./frame";
import { isSolError } from "./errorValue";

// ─── The backend parity corpus, JS side (v2.0/18-parity-corpus.md) ────────────
// One fixture set, both engines: every case here also runs through the Polars
// engine (src-tauri/src/engine/tests.rs `corpus_cases`), reading the SAME files
// with the PRODUCTION wire deserializers — the corpus format IS the wire format,
// so there is no third representation to drift. A case that passes here and
// fails in cargo (or vice versa) is a parity break by definition.

const CORPUS_DIR = path.resolve(__dirname, "../../fixtures/frame-verbs");

interface WireColumn { name: string; type: FrameColumn["type"]; values: FrameCell[] }
interface CorpusCase {
  name: string;
  frames: Record<string, { columns: WireColumn[] }>;
  // Unary verbs carry a FrameOp; the binary verbs' ops are corpus shapes over
  // the same wire vocabulary: join = `{ kind: "join" } & JoinOpts` (frames
  // "left"/"right"), append = `{ kind: "append", frames: [names…] }` (order —
  // the frames map can't carry it).
  op: { kind: string } & Record<string, unknown>;
  expect?: { columns: WireColumn[] };
  expectError?: string;
}
interface CorpusFile { verb: string; cases: CorpusCase[] }

/** The verbs that take MORE than one frame. Not derivable from `FrameOp` (they
 *  are separate backend commands, not ops), so hand-listed — the cargo runner
 *  dispatches on the same two names, and the completeness guard below requires
 *  a fixture file for each. (XLOOKUP's lookupFrameCell is oracle-only on every
 *  platform — no engine command — so it has no corpus entry, like pivot's
 *  richer half.) */
const BINARY_VERBS = ["join", "append"] as const;

/** Non-finite cells ride the wire's OWN tagged form — `{"__nf": "inf"|"-inf"|
 *  "nan"}`, the convention frameBackend/engine.rs already speak — because the
 *  corpus format IS the wire format. Decoded here exactly as frameBackend's
 *  decodeWireCell does; the Rust runner gets it for free (wire_to_solframe
 *  decodes `__nf` in its normal parse). */
const decodeCell = (v: unknown): FrameCell => {
  const nf = (v as { __nf?: string } | null)?.__nf;
  if (nf === "inf") return Infinity;
  if (nf === "-inf") return -Infinity;
  if (nf === "nan") return NaN;
  return v as FrameCell;
};

function brand(wire: { columns: WireColumn[] }): FrameValue {
  return {
    __frame: true,
    columns: wire.columns.map((c) => ({ name: c.name, type: c.type, values: c.values.map(decodeCell) })),
  };
}

/** Structural view for comparison: name/type/values only (unit/raw are
 *  node-side extras the corpus doesn't exercise). */
function dump(f: FrameValue): WireColumn[] {
  return f.columns.map((c) => ({ name: c.name, type: c.type, values: [...c.values] }));
}

/** `expect` frames decode the `__nf` sentinel exactly like inputs do (the
 *  corpus format is the wire format in BOTH directions) — toEqual treats NaN
 *  as equal to NaN, so a decoded expectation compares cleanly. */
function decodeColumns(wire: { columns: WireColumn[] }): WireColumn[] {
  return wire.columns.map((c) => ({ ...c, values: c.values.map(decodeCell) }));
}

const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json")).sort();
const corpus: CorpusFile[] = files.map((f) => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), "utf8")));

describe.each(corpus.map((c) => [c.verb, c] as const))("corpus: %s", (_verb, file) => {
  it.each(file.cases.map((c) => [c.name, c] as const))("%s", (_name, kase) => {
    // Structural sanity the cargo side relies on too.
    expect(kase.expect !== undefined || kase.expectError !== undefined, "a case needs expect XOR expectError").toBe(true);
    expect(kase.expect !== undefined && kase.expectError !== undefined, "not both").toBe(false);
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
    // Every verb leaves its input frames untouched — checked corpus-wide, so no
    // per-verb "does not mutate" test needs to exist.
    for (const [k, f] of Object.entries(inputs)) {
      expect(dump(f), `the verb mutated input frame "${k}"`).toEqual(before[k]);
    }
  });
});

describe("corpus completeness — every verb has a fixture file", () => {
  // The closed ratchet (bundle 18 step 3, promoted as FX-12): the migration
  // whitelist emptied and died — every verb both engines speak computes from
  // this ONE fixture corpus. Adding a NEW FrameOp kind fails compile
  // (FRAME_OP_KINDS) and then fails here until it ships with corpus cases; a
  // new binary verb joins BINARY_VERBS and needs a fixture file the same way.
  const INVENTORY: readonly string[] = [...FRAME_OP_KINDS, ...BINARY_VERBS];

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
