// [[D99]] rustIsSpec, [[C130]] rustCore, [[node-bodies#Freezing]], [[node-bodies#Checks]]
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import { nodeUnwire, nodeWire, readNodeReply, jsonDec, jsonEnc } from "../../src/graph/nodeWire";
import { isSolError } from "../../src/graph/errorValue";
import { isUnitCell, matrixUnitOf, withMatrixUnit, type ColumnUnit } from "../../src/graph/unitValue";
import { isCx } from "../../src/graph/cxValue";
import { isFrameRef } from "../../src/graph/frameBackend";
import { frameRefWire } from "../../src/graph/engineWasm/solenoid_graph.js";
import "../../src/graph/nodeBoundary";

/** A lazy frame as its case froze it: its frame's cells and its plan. */
const frozen = (v: unknown): unknown => (isFrameRef(v) ? JSON.parse(frameRefWire(v) ?? "null") : v);

const DIR = path.resolve(__dirname, "../../fixtures/core/nodes");
type Case = { init: unknown; inputs: [string, unknown[]][]; result: { out?: Record<string, unknown>; thrown?: unknown }; ctx: { clock: unknown };
  display?: Record<string, unknown>; prior?: Record<string, unknown>; unstable?: true };
type Reply = { out?: Record<string, unknown>; thrown?: unknown; none?: true; matrixUnits?: Record<string, unknown>; display?: Record<string, unknown> };

const REFREEZE = ["1", "nodes"].some((s) => (process.env.FREEZE_CORE ?? "").split(",").includes(s));
/** A value as the recorder freezes it (`tests/setup/nodeRecorder.ts`). */
const wireOf = (v: unknown): unknown => (isFrameRef(v) ? frozen(v) : JSON.parse(JSON.stringify(nodeWire(v) ?? null, (k, x) => (k === "ref" ? undefined : x))));
/** A shown field as the recorder freezes it; one that shows an output is that output as the case froze it. */
function shownWire(r: unknown, out: Record<string, unknown>, outWire: Record<string, unknown> | undefined): unknown {
  const o = r as { undef?: true; output?: string } | null;
  if (o && typeof o === "object" && o.undef === true) return { __undef: 1 };
  if (o && typeof o === "object" && typeof o.output === "string" && outWire && o.output in outWire) return outWire[o.output];
  const v = o && typeof o === "object" && typeof o.output === "string" ? out[o.output] : readNodeReply(r)?.value;
  const w = nodeWire(v);
  return w === undefined ? { __json: jsonEnc(v) } : wireOf(v);
}

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

const bodiless: string[] = [];

describe("card bodies on the core answer as frozen", () => {
  for (const file of files) {
    const kind = file.replace(/\.json\.gz$/, "");
    const cases = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, file))).toString("utf8")) as Case[];
    const call = (c: Case) => wasmInvokeSync<Reply>("engine_node", { ...c, kind, clock: c.ctx.clock });
    if (cases.length === 0 || call(cases[0]).none) { bodiless.push(kind); continue; }
    it(kind, () => {
      const bad: string[] = [];
      let rewritten = 0;
      // Every 25th case of each class; all of a small class's, and all while refreezing.
      const sampled = REFREEZE || cases.length <= 25 ? cases : cases.filter((_, i) => i % 25 === 0);
      for (const c of sampled) {
        if (c.unstable) continue;
        const r = call(c);
        const asFrozen = c.result;
        let moved = false;
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
            if (isFrameRef(got) ? !same(frozen(got), w) : !same(got, nodeUnwire(w))) {
              if (REFREEZE) { c.result.out[k] = wireOf(got); moved = true; rewritten++; } else bad.push(`${k}: ${JSON.stringify(got)} vs ${JSON.stringify(w)} on ${JSON.stringify(c.inputs)}`);
            }
          }
        } else if (c.result.thrown !== undefined) {
          const got = r.thrown === undefined ? "(no throw)" : readNodeReply(r.thrown)?.value;
          if (!same(got, nodeUnwire(c.result.thrown))) {
            if (REFREEZE) { c.result = { thrown: wireOf(got) }; moved = true; rewritten++; } else bad.push(`thrown ${JSON.stringify(got)} vs ${JSON.stringify(c.result.thrown)}`);
          }
        }
        if (REFREEZE) {
          // A thrown JS text stays as frozen unless the answer moved.
          if (!moved) c.result = asFrozen;
          // A shown field that moved is rewritten, with the answer or alone (a type the card reports). Its frozen value is
          // the case's display, else its prior, else its init, as `tests/nodes.rs` reads it.
          const out = Object.fromEntries(Object.entries(r.out ?? {}).map(([k, v]) => [k, readNodeReply(v)?.value]));
          const init = (c.init ?? {}) as Record<string, unknown>;
          for (const [field, v] of Object.entries(r.display ?? {})) {
            const held = [c.display, c.prior, init].find((o) => o && field in o);
            const want = held?.[field];
            if (want === undefined || (typeof want === "object" && want !== null && "__deleted" in want)) continue;
            const got = shownWire(v, out, c.result.out);
            if (JSON.stringify(want) !== JSON.stringify(got)) { (c.display ??= {})[field] = got; rewritten++; }
          }
          // A field the case froze that the core no longer shows goes.
          for (const field of Object.keys(c.display ?? {})) {
            if (!(field in (r.display ?? {}))) { delete (c.display as Record<string, unknown>)[field]; rewritten++; }
          }
          // A field the core now shows that no case froze is recorded too.
          for (const [field, v] of Object.entries(r.display ?? {})) {
            if ([c.display, c.prior, init].some((o) => o && field in o)) continue;
            const u = v as { undef?: true } | null;
            if (u && typeof u === "object" && u.undef === true) continue;
            (c.display ??= {})[field] = shownWire(v, out, c.result.out);
            rewritten++;
          }
        }
        if (bad.length >= 5) break;
      }
      if (REFREEZE && rewritten) {
        fs.writeFileSync(path.join(DIR, file), zlib.gzipSync(JSON.stringify(cases), { level: 9 }));
      }
      expect(bad).toEqual([]);
    });
  }
});

// A class the core has no body for stays in TypeScript, so its frozen cases would hold nothing to anything:
// scripts/node-cases.mjs lists it (STAYS_IN_TS) and the freeze skips it.
it("every frozen card class has a body on the core", () => {
  expect(bodiless, "delete the fixture and list the class in STAYS_IN_TS (scripts/node-cases.mjs)").toEqual([]);
});
