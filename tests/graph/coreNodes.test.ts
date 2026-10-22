// [[D99]] rustIsSpec, [[D102]] graphOnCore
// Every card body on the core, through the wasm module the app runs, answers its frozen cases (fixtures/core/nodes/,
// frozen by scripts/freeze-nodes.mjs). `crates/solenoid-core/tests/nodes.rs` holds the native build to the same cases.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import { readReply } from "../../src/graph/coreValues";
import { dec } from "./coreFixtures";
import { isSolError } from "../../src/graph/errorValue";
import { isUnitCell } from "../../src/graph/unitValue";

const DIR = path.resolve(__dirname, "../../fixtures/core/nodes");
type Case = { init: unknown; inputs: [string, unknown[]][]; result: { out?: Record<string, unknown>; thrown?: unknown }; ctx: { clock: unknown }; unstable?: true };
type Reply = { out?: Record<string, unknown>; thrown?: unknown; none?: true };

/** The frozen wire value as the TS held it: errors by code and message, unit cells by what crosses back. */
function same(got: unknown, want: unknown): boolean {
  if (Array.isArray(got) || Array.isArray(want)) {
    return Array.isArray(got) && Array.isArray(want) && got.length === want.length && got.every((g, i) => same(g, want[i]));
  }
  if (isSolError(got) || isSolError(want)) return isSolError(got) && isSolError(want) && got.code === want.code && got.message === want.message;
  if (isUnitCell(got) || isUnitCell(want)) {
    return isUnitCell(got) && isUnitCell(want) && Object.is(got.value, want.value) && got.display === want.display && !!got.ratio === !!want.ratio;
  }
  if (typeof got === "object" && got && typeof want === "object" && want) return JSON.stringify(got) === JSON.stringify(want);
  return Object.is(got, want);
}

function frozenWire(v: unknown): unknown {
  const o = v as { __unit?: { value: unknown; display?: string; ratio?: boolean } } | null;
  if (o && typeof o === "object" && !Array.isArray(o) && o.__unit) {
    const u = o.__unit;
    return { __unitCell: true, value: dec(u.value), dim: {}, ...(u.display ? { display: u.display } : {}), ...(u.ratio ? { ratio: true } : {}) };
  }
  if (Array.isArray(v)) return v.map(frozenWire);
  return dec(v);
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json.gz")).sort() : [];

describe("card bodies on the core answer as frozen", () => {
  for (const file of files) {
    const kind = file.replace(/\.json\.gz$/, "");
    const cases = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, file))).toString("utf8")) as Case[];
    const call = (c: Case) => wasmInvokeSync<Reply>("engine_node", { ...c, kind, clock: c.ctx.clock });
    if (cases.length === 0 || call(cases[0]).none) continue;
    it(kind, () => {
      const bad: string[] = [];
      for (const c of cases) {
        if (c.unstable) continue;
        const r = call(c);
        if (c.result.out) {
          for (const [k, w] of Object.entries(c.result.out)) {
            const got = r.out && k in r.out ? readReply(r.out[k])?.value : "(missing)";
            if (!same(got, frozenWire(w))) bad.push(`${k}: ${JSON.stringify(got)} vs ${JSON.stringify(w)} on ${JSON.stringify(c.inputs)}`);
          }
        } else if (c.result.thrown !== undefined) {
          const got = r.thrown === undefined ? "(no throw)" : readReply(r.thrown)?.value;
          if (!same(got, frozenWire(c.result.thrown))) bad.push(`thrown ${JSON.stringify(got)} vs ${JSON.stringify(c.result.thrown)}`);
        }
        if (bad.length >= 5) break;
      }
      expect(bad).toEqual([]);
    });
  }
});
