// [[C10]] socketLattice, [[socket-lattice#Enforcement]]
import { describe, it, expect } from "vitest";
import { canConnect, areCompatible, adoptTypeForBase, projectTypeToBase, type SocketDataType } from "../../src/graph/sockets";

describe("cube — universal recursive container (lattice supremum)", () => {
  it("areCompatible(cube, …) is symmetric over everything it accepts", () => {
    expect(areCompatible("cube", "frame")).toBe(true);
    expect(areCompatible("number", "cube")).toBe(true);
  });
});


describe("adoptTypeForBase / projectTypeToBase — one answer per connectable pair", () => {
  const RANK_BASES = ["anylist", "anytable"] as const;
  const EVERY: SocketDataType[] = [
    "number","list","numlist","table","string","strlist","strcombo","strtable",
    "date","datelist","datecombo","datetable","complex","complexlist","complexcombo","complextable",
    "logical","logicallist","logicalcombo","logicaltable","anytable","anylist","anycombo","anydata",
    "frame","cube","lambda","chart","document","any","trueany",
  ];

  it("they agree for every type that can legally connect into the base", () => {
    for (const base of RANK_BASES) for (const t of EVERY) {
      if (!canConnect(t, base)) continue; // outside the domain adoption is ever asked about
      expect(`${base}|${t}|${adoptTypeForBase(base, t)}`).toBe(`${base}|${t}|${projectTypeToBase(base, t)}`);
    }
  });

  it("a rank-bearing port KEEPS its rung when a wildcard lands on it", () => {
    for (const base of RANK_BASES) for (const w of ["any", "anylist", "anycombo", "trueany"] as SocketDataType[]) {
      if (!canConnect(w, base)) continue;
      expect(adoptTypeForBase(base, w)).toBe(base);
    }
    // …so the port still refuses what its rung refuses.
    expect(canConnect("frame", adoptTypeForBase("anylist", "trueany"))).toBe(false);
    expect(canConnect("lambda", adoptTypeForBase("anylist", "trueany"))).toBe(false);
    expect(canConnect("table", adoptTypeForBase("anylist", "trueany"))).toBe(false);
  });

  it("but a CONCRETE wire is still adopted, at the port's rank", () => {
    expect(adoptTypeForBase("anylist", "date")).toBe("datelist");    // scalar widens to the rung
    expect(adoptTypeForBase("anylist", "datelist")).toBe("datelist"); // same rank, verbatim
    expect(adoptTypeForBase("anytable", "strlist")).toBe("strtable");
    expect(adoptTypeForBase("anytable", "logicaltable")).toBe("logicaltable");
    // A `trueany` BASE has no rank to keep, so it adopts anything verbatim.
    expect(adoptTypeForBase("trueany", "frame")).toBe("frame");
    expect(adoptTypeForBase("trueany", "lambda")).toBe("lambda");
  });


  it("only the OUTPUT side projects DOWN a rank, and that pair never connects", () => {
    expect(projectTypeToBase("anylist", "strtable")).toBe("strlist");
    expect(adoptTypeForBase("anylist", "strtable")).toBe("strtable");
  });
});


describe("the lattice rule: families stay apart, values widen", () => {
  const FAM = {
    number:  { scalar: "number",  list: "list",        combo: "numlist",      matrix: "table" },
    string:  { scalar: "string",  list: "strlist",     combo: "strcombo",     matrix: "strtable" },
    date:    { scalar: "date",    list: "datelist",    combo: "datecombo",    matrix: "datetable" },
    complex: { scalar: "complex", list: "complexlist", combo: "complexcombo", matrix: "complextable" },
    logical: { scalar: "logical", list: "logicallist", combo: "logicalcombo", matrix: "logicaltable" },
  } as const satisfies Record<string, Record<string, SocketDataType>>;
  const RANK = { scalar: 0, list: 1, combo: 1, matrix: 2 } as const;
  const DIMS = ["scalar", "list", "combo", "matrix"] as const;
  const fams = Object.keys(FAM) as (keyof typeof FAM)[];
  const bridged = (a: string, b: string) => (a === "number" && b === "logical") || (a === "logical" && b === "number");
  const dimFlows = (dOut: keyof typeof RANK, dIn: keyof typeof RANK) => RANK[dOut] <= RANK[dIn] || (dOut === "combo" && dIn === "scalar");

  it("within a family a value widens up (and a combo reaches its scalar), never narrows", () => {
    for (const f of fams) for (const dOut of DIMS) for (const dIn of DIMS) {
      expect(canConnect(FAM[f][dOut], FAM[f][dIn])).toBe(dimFlows(dOut, dIn));
    }
  });

  it("across families only logical and number connect, by the same widening rule", () => {
    for (const fOut of fams) for (const fIn of fams) {
      if (fOut === fIn) continue;
      for (const dOut of DIMS) for (const dIn of DIMS) {
        expect(canConnect(FAM[fOut][dOut], FAM[fIn][dIn])).toBe(bridged(fOut, fIn) && dimFlows(dOut, dIn));
      }
    }
  });
});
