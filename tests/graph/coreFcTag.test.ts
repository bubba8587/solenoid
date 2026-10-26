// [[D99]] rustIsSpec, [[C25]] firstClassUnits, [[D43]] unitByGranularity
// Tagging a value with a Format Controller's unit, frozen (fixtures/core/fc-tag.json.gz): a number takes the unit, a
// quantity of its dimension shows in it, a clash or a ratio is #UNIT!, a list tags each item, and a grid takes the unit
// as its own, a held one rescaling. Inputs are built from unit ids so the case reads the same every run.
import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { enc, frozen } from "./coreFixtures";
import { applyFcUnit } from "../../src/graph/unitBridge";
import { fcUnitToUnit } from "../../src/graph/dimension";
import { fromUnit, withMatrixUnit, matrixUnitOf } from "../../src/graph/unitValue";
import { solError } from "../../src/graph/errorValue";

type In = number | string | boolean | null | { q: number; id: string } | { ratio: number } | { err: string } | In[] | { grid: (number | string | null)[][]; held?: string };
type Case = { value: In; id: string; custom?: string; want?: unknown };

/** An answer as plain data, an error as its code and message whichever module made it. */
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(enc(v)), (_k, x) =>
  x && typeof x === "object" && (x.__solError || x.__err) ? { err: x.code ?? x.__err, msg: x.message ?? x.msg } : x);

function build(v: In): unknown {
  if (Array.isArray(v)) return v.map(build);
  if (v && typeof v === "object") {
    if ("q" in v) return fromUnit(v.q, fcUnitToUnit(v.id)!, v.id);
    if ("ratio" in v) return { __unitCell: true, value: v.ratio, dim: {}, ratio: true };
    if ("err" in v) return solError(v.err as never, "e");
    const u = v.held ? fcUnitToUnit(v.held)! : null;
    return u ? withMatrixUnit(v.grid.map((r) => [...r]), { dim: u.dim, display: v.held }) : v.grid.map((r) => [...r]);
  }
  return v;
}

const VALUES: In[] = [
  5, -2.5, 0, null, "text", true, { err: "#N/A" }, { q: 5, id: "km" }, { q: 20, id: "degC" }, { q: 3, id: "s" }, { ratio: 2 },
  [1, 2, null], [{ q: 1, id: "km" }, { q: 2, id: "m" }], [{ q: 1, id: "km" }, 3], [],
  { grid: [[5, 2]] }, { grid: [[5, 2]], held: "km" }, { grid: [[5, 2]], held: "m" }, { grid: [[20, 30]], held: "degC" },
  { grid: [["a", 2]] }, { grid: [[null, 2], [3, 4]] }, { grid: [["", 7]], held: "km" },
];
const UNITS: [string, string?][] = [["km"], ["m"], ["s"], ["degF"], ["usd"], ["none"], ["custom", "poop"], ["custom", "Poop"], ["custom", "  "], ["nonsense"]];

describe("tagging a value with an FC unit holds to its frozen answers", () => {
  it("every value, every unit", () => {
    const fresh: Case[] = [];
    for (const value of VALUES) {
      for (const [id, custom] of UNITS) {
        const out = applyFcUnit(build(value), id, custom);
        fresh.push({ value, id, ...(custom !== undefined ? { custom } : {}), want: { out: plain(out), table: plain(matrixUnitOf(out) ?? null) } });
      }
    }
    const cases = frozen<Case>("fc-tag", () => fresh);
    expect(cases.length).toBe(fresh.length);
    const bad = cases.filter((c, i) => !isDeepStrictEqual(plain(c.want), fresh[i].want)).map((c) => `${JSON.stringify(c.value)} ${c.id} ${c.custom ?? ""}`);
    expect(bad).toEqual([]);
  });
});
