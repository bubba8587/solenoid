// [[D99]] rustIsSpec, [[C120]] linearWork
// `coreEach` answers a card's per-item calls from one `engine_call_each`; each answer must be the one `callCore` makes
// call by call. Over the frozen function-body cases: each body, each arity, each argument position mapped over the
// cases' values there while the rest hold the first case's.
import { it, expect, beforeAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { callCore, coreEach } from "../../src/graph/coreValues";
import { loadWasmEngineSync, wasmInvokeSync } from "../../src/graph/engineWasm";
import { frozen, enc } from "./coreFixtures";

process.env.TZ = "UTC";
vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 5, 15, 13, 45, 30, 250) });

type FnCase = { name: string; args: unknown[] };
let ported = new Set<string>();
beforeAll(() => {
  loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
  ported = new Set(wasmInvokeSync<string[]>("engine_ported"));
});

/** Bodies whose arguments size their answer: mapping one over another case's numbers builds huge lists. */
const SIZED = /^(MUNIT|SEQUENCE|EXPAND|GEOMETRIC|REPEAT|WRAPCOLS|WRAPROWS|PADLEFT|PADRIGHT)$/;
const PER_BATCH = 64;

const same = (got: unknown, want: unknown) => JSON.stringify(enc(got)) === JSON.stringify(enc(want));

it("a batch answers each item as its own call does", () => {
  const groups = new Map<string, FnCase[]>();
  for (const c of frozen<FnCase>("function-bodies", () => { throw new Error("frozen only"); })) {
    if (!ported.has(c.name) || c.args.length === 0 || SIZED.test(c.name)) continue;
    const key = `${c.name}/${c.args.length}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  let batches = 0, mismatches: unknown[] = [];
  for (const g of groups.values()) {
    if (g.length < 8) continue;
    g.splice(PER_BATCH);
    for (let p = 0; p < g[0].args.length; p++) {
      const calls = g.filter((c) => !Array.isArray(c.args[p])).map((c) => g[0].args.map((a, q) => (q === p ? c.args[p] : a)));
      if (calls.length < 8) continue;
      const one = calls.map((args) => callCore(g[0].name, args));
      const each = coreEach(calls.length, (i) => callCore(g[0].name, calls[i]));
      batches++;
      one.forEach((want, i) => { if (!same(each[i], want)) mismatches.push({ name: g[0].name, args: enc(calls[i]), got: enc(each[i]), want: enc(want) }); });
    }
  }
  expect(mismatches.slice(0, 5)).toEqual([]);
  expect(batches).toBeGreaterThan(500);
}, 60_000);

it("a body that reads its answer, or calls twice an item, still answers per call", () => {
  const xs = Array.from({ length: 40 }, (_, i) => i * 1.5 - 7);
  const body = (x: number) => {
    const r = callCore("ROUND", [x, 0]) as number;
    return typeof r === "number" && r > 0 ? callCore("SQRT", [r]) : callCore("ABS", [x]);
  };
  expect(coreEach(xs.length, (i) => body(xs[i]))).toEqual(xs.map(body));
});

it("the batch crosses once, and bails whole when an item would", () => {
  const each = (name: string, args: unknown[], items: unknown[][]) => wasmInvokeSync("engine_call_each", { name, args, at: [0], items, clock: null, scan: true });
  expect(each("UPPER", [null], [["a"], ["b"]])).toEqual({ each: [{ str: "A" }, { str: "B" }] });
  expect(each("ROUND", [null, 1], [[1.25], ["x"]])).toEqual({ each: [1.3, { err: "#VALUE!", msg: expect.any(String) }] });
  expect(each("UPPER", [null], [["a"], [{ __unit: { value: 1, dim: { m: 1 } } }]])).toEqual({ bail: true });
});
