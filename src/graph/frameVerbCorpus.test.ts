import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyVerb, FRAME_OP_KINDS, type FrameOp } from "./frameVerbs";
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
  op: FrameOp;
  expect?: { columns: WireColumn[] };
  expectError?: string;
}
interface CorpusFile { verb: string; cases: CorpusCase[] }

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

const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json")).sort();
const corpus: CorpusFile[] = files.map((f) => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), "utf8")));

describe.each(corpus.map((c) => [c.verb, c] as const))("corpus: %s", (_verb, file) => {
  it.each(file.cases.map((c) => [c.name, c] as const))("%s", (_name, kase) => {
    // Structural sanity the cargo side relies on too.
    expect(kase.expect !== undefined || kase.expectError !== undefined, "a case needs expect XOR expectError").toBe(true);
    expect(kase.expect !== undefined && kase.expectError !== undefined, "not both").toBe(false);
    const input = brand(kase.frames.in);
    let out: FrameValue | undefined;
    let err: unknown;
    try { out = applyVerb(input, kase.op); } catch (e) { err = e; }
    if (kase.expectError !== undefined) {
      expect(isSolError(err), `expected ${kase.expectError}, got ${JSON.stringify(out && dump(out))}`).toBe(true);
      expect((err as { code: string }).code).toBe(kase.expectError);
    } else {
      expect(err, `oracle threw: ${(err as Error)?.message ?? err}`).toBeUndefined();
      expect(dump(out!)).toEqual(kase.expect!.columns);
    }
  });
});

describe("corpus completeness — every unary verb has a fixture file", () => {
  // The ratchet (bundle 18 step 3): verbs still covered ONLY by the
  // hand-mirrored test pairs sit in this whitelist. Migrating a verb = moving
  // its pair's cases into fixtures/frame-verbs/<verb>.json and DELETING it
  // here; the guard closes fully when the list is empty, and then promotes as
  // FX-12. Adding a NEW FrameOp kind fails compile (FRAME_OP_KINDS) and then
  // fails here until it ships with corpus cases.
  const NOT_YET_MIGRATED = new Set([
    "select", "drop", "rename", "head", "filterMulti", "groupBy", "unpivot", "pivot",
  ]);

  it("fixture files + the migration whitelist cover FRAME_OP_KINDS exactly", () => {
    const covered = new Set(corpus.map((c) => c.verb));
    const missing = FRAME_OP_KINDS.filter((k) => !covered.has(k) && !NOT_YET_MIGRATED.has(k));
    const doubled = FRAME_OP_KINDS.filter((k) => covered.has(k) && NOT_YET_MIGRATED.has(k));
    const unknown = [...covered].filter((v) => !(FRAME_OP_KINDS as readonly string[]).includes(v));
    expect(missing, "verbs with neither fixtures nor a whitelist entry").toEqual([]);
    expect(doubled, "verbs with fixtures still on the whitelist — delete the entry").toEqual([]);
    expect(unknown, "fixture files for verbs not in FRAME_OP_KINDS (binary verbs get their own inventory when they migrate)").toEqual([]);
  });

  it("every fixture file has cases, each named uniquely", () => {
    for (const file of corpus) {
      expect(file.cases.length, `${file.verb}.json is empty`).toBeGreaterThan(0);
      const names = file.cases.map((c) => c.name);
      expect(new Set(names).size, `${file.verb}.json has duplicate case names`).toBe(names.length);
    }
  });
});
