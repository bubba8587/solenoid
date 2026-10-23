// [[D99]] rustIsSpec, [[D102]] graphOnCore
// Every card body on the core, through the wasm module the app runs, answers its frozen cases (fixtures/core/nodes/,
// frozen by scripts/freeze-nodes.mjs). `crates/solenoid-core/tests/nodes.rs` holds the native build to the same cases.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import { nodeUnwire, readNodeReply, jsonDec } from "../../src/graph/nodeWire";
import { isSolError } from "../../src/graph/errorValue";
import { isUnitCell, matrixUnitOf, withMatrixUnit, type ColumnUnit } from "../../src/graph/unitValue";
import { isCx } from "../../src/graph/cxValue";

const DIR = path.resolve(__dirname, "../../fixtures/core/nodes");
type Case = { init: unknown; inputs: [string, unknown[]][]; result: { out?: Record<string, unknown>; thrown?: unknown }; ctx: { clock: unknown }; unstable?: true };
type Reply = { out?: Record<string, unknown>; thrown?: unknown; none?: true; matrixUnits?: Record<string, unknown> };

/** The frozen wire value as the TS held it: errors by code and message, unit cells by what crosses back. */
function same(got: unknown, want: unknown): boolean {
  if (JSON.stringify(matrixUnitOf(got) ?? null) !== JSON.stringify(matrixUnitOf(want) ?? null)) return false;
  if (Array.isArray(got) || Array.isArray(want)) {
    return Array.isArray(got) && Array.isArray(want) && got.length === want.length && got.every((g, i) => same(g, want[i]));
  }
  if (isSolError(got) || isSolError(want)) return isSolError(got) && isSolError(want) && got.code === want.code && got.message === want.message;
  if (isUnitCell(got) || isUnitCell(want)) {
    return isUnitCell(got) && isUnitCell(want) && Object.is(got.value, want.value) && got.display === want.display && !!got.ratio === !!want.ratio;
  }
  if (isCx(got) || isCx(want)) return isCx(got) && isCx(want) && Object.is(got.re, want.re) && Object.is(got.im, want.im);
  if (typeof got === "object" && got && typeof want === "object" && want) {
    // Plain data comes back with its keys sorted, so compare by key.
    const g = got as Record<string, unknown>, w = want as Record<string, unknown>;
    const keys = new Set([...Object.keys(g), ...Object.keys(w)]);
    return [...keys].every((k) => same(g[k], w[k]));
  }
  return Object.is(got, want);
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
        // A JS exception froze as its text; the error guard shows it as this error (`fromThrown`).
        const js = (c.result as { thrownJs?: string }).thrownJs;
        if (js !== undefined) {
          const i = js.indexOf(": ");
          const [name, msg] = i < 0 ? ["Error", js] : [js.slice(0, i), js.slice(i + 2)];
          c.result = { thrown: name === "ShapeError" ? { __err: "#SHAPE!", msg } : { __err: "#ERROR!", msg: `This node failed to compute: ${msg}` } };
        }
        if (c.result.out) {
          for (const [k, w] of Object.entries(c.result.out)) {
            const from = (r.out?.[k] as { input?: [string, number] } | undefined)?.input;
            const got = from ? nodeUnwire(c.inputs.find(([key]) => key === from[0])?.[1][from[1]])
              : r.out && k in r.out ? readNodeReply(r.out[k])?.value : "(missing)";
            if (r.matrixUnits?.[k]) withMatrixUnit(got, jsonDec(r.matrixUnits[k]) as ColumnUnit);
            if (!same(got, nodeUnwire(w))) bad.push(`${k}: ${JSON.stringify(got)} vs ${JSON.stringify(w)} on ${JSON.stringify(c.inputs)}`);
          }
        } else if (c.result.thrown !== undefined) {
          const got = r.thrown === undefined ? "(no throw)" : readNodeReply(r.thrown)?.value;
          if (!same(got, nodeUnwire(c.result.thrown))) bad.push(`thrown ${JSON.stringify(got)} vs ${JSON.stringify(c.result.thrown)}`);
        }
        if (bad.length >= 5) break;
      }
      expect(bad).toEqual([]);
    });
  }
});
