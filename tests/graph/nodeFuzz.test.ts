// [[D99]] rustIsSpec
// Feeds every catalog card random values of its sockets' types, so the recorder (tests/setup/nodeRecorder.ts) freezes
// each body on more than the hand-written tests reach. Runs only while recording: `FREEZE_NODES=1`.
import { describe, it } from "vitest";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import { throughBoundary } from "./boundaryKit";
import { declaredTypeOf } from "../../src/graph/sockets";
import { solError } from "../../src/graph/errorValue";
import { cx } from "../../src/graph/cxValue";
import { applyFcUnit } from "../../src/graph/unitBridge";

type Card = { unitAware?: boolean; inputs: Record<string, { socket?: unknown } | undefined>; data: (i: Record<string, unknown[]>) => unknown };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["", "a", "Hello", "hello world", "  pad  ", "x,y", "42", "3.5", "-7", "TRUE", "ÄÖü", "naïve café", "2024-01-15", "abc123", "A-B_C", "Mississippi", "😀ok"];

function gen(r: () => number) {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const num = (): unknown => {
    const u = r();
    if (u < 0.06) return null;
    if (u < 0.09) return solError(pick(["#N/A", "#VALUE!", "#DIV/0!"] as const), "fuzz");
    if (u < 0.35) return Math.floor(r() * 11) - 5;
    if (u < 0.5) return pick([0, 1, 2, 10, 100, 0.5, -0.25, 1e-6, 365, 3.14159]);
    if (u < 0.55) return pick([1e300, -1e300, -0, 1e15]);
    return Math.round((r() * 200 - 100) * 1000) / 1000;
  };
  const str = (): unknown => (r() < 0.06 ? null : pick(WORDS));
  const bool = (): unknown => (r() < 0.1 ? null : r() < 0.5);
  const date = (): unknown => (r() < 0.06 ? null : 36526 + Math.floor(r() * 20000) + pick([0, 0, 0.25, 0.5]));
  const complex = (): unknown => cx(Math.floor(r() * 9) - 4, Math.floor(r() * 9) - 4);
  const any = (): unknown => pick([num, str, bool, date])();
  const list = (cell: () => unknown): unknown => Array.from({ length: Math.floor(r() * 7) }, cell);
  const table = (cell: () => unknown): unknown => {
    const rows = 1 + Math.floor(r() * 3), cols = 1 + Math.floor(r() * 3);
    return Array.from({ length: rows }, () => Array.from({ length: cols }, cell));
  };
  const scalarOrList = (cell: () => unknown) => (): unknown => (r() < 0.6 ? cell() : list(cell));
  const by: Record<string, () => unknown> = {
    number: scalarOrList(num), numlist: scalarOrList(num), list: () => list(num), table: () => table(num),
    string: scalarOrList(str), strlist: () => list(str), strcombo: scalarOrList(str), strtable: () => table(str),
    date: scalarOrList(date), datelist: () => list(date), datecombo: scalarOrList(date), datetable: () => table(date),
    logical: scalarOrList(bool), logicallist: () => list(bool), logicalcombo: scalarOrList(bool), logicaltable: () => table(bool),
    complex: complex, complexlist: () => list(complex), complexcombo: scalarOrList(complex), complextable: () => table(complex),
    any: scalarOrList(any), anylist: () => list(any), anycombo: scalarOrList(any), anytable: () => table(any), anydata: scalarOrList(any),
  };
  // A unit-aware card also meets numbers carrying a unit, alone or in a list, often all in one unit.
  const UNITS = ["m", "km", "cm", "s", "h", "kg", "g", "degC", "degF", "K", "usd", "eur", "m/s", "kmh", "L"];
  const NUMERIC = new Set(["number", "numlist", "list", "table", "any", "anylist", "anycombo", "anydata"]);
  const withUnit = (v: unknown, unit: string): unknown =>
    Array.isArray(v) ? v.map((x) => withUnit(x, r() < 0.3 ? pick(UNITS) : unit)) : typeof v === "number" ? applyFcUnit(v, unit) : v;
  return (dt: string | undefined, unitAware = false): unknown | undefined => {
    const v = dt === undefined ? scalarOrList(any)() : by[dt]?.();
    return unitAware && dt !== undefined && NUMERIC.has(dt) && r() < 0.5 ? withUnit(v, pick(UNITS)) : v;
  };
}

describe.runIf(!!process.env.FREEZE_NODES)("every card on random values of its socket types", () => {
  it("records", async () => {
    const r = rng(20261022);
    const value = gen(r);
    for (const entry of FLAT_CATALOG.values()) {
      for (let i = 0; i < 150; i++) {
        let card: Card;
        try { card = entry.create() as unknown as Card; } catch { break; }
        const inputs: Record<string, unknown[]> = {};
        for (const [k, input] of Object.entries(card.inputs)) {
          if (r() < 0.2) continue;
          const dt = declaredTypeOf(input?.socket);
          const v = value(dt, card.unitAware === true);
          if (v === undefined) continue;
          inputs[k] = [v];
        }
        throughBoundary(card as never);
        try {
          await Promise.race([Promise.resolve(card.data(inputs)), new Promise((res) => setTimeout(res, 2000))]);
        } catch { /* a thrown answer is recorded too */ }
      }
    }
  }, 3_600_000);
});
