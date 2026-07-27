import { describe, it, expect } from "vitest";
import { ConduitNode, conduitInKey } from "./nodes/conduit";
import { FilterNode } from "./nodes/list";
import { canConnect, AdoptiveSocket, SolenoidSocket, type SocketDataType } from "./sockets";
import { resolvePassthroughType } from "./nodes/passthrough";
import { tagDim, isUnitCell } from "./unitValue";
import { displayMagnitudeOf } from "./unitBridge";

const agree = (types: (SocketDataType | null)[]): SocketDataType => {
  const wired = types.filter((t): t is SocketDataType => t != null && t !== "trueany");
  return wired.length && wired.every((t) => t === wired[0]) ? wired[0] : "trueany";
};

describe("Conduit lane accepts any cable (trueany, not scalar any)", () => {
  it("the lane input is trueany and accepts a 1-D anylist output (the List Filter case)", () => {
    const c = new ConduitNode();
    const sock = c.inputs[conduitInKey(0)]!.socket as SolenoidSocket;
    expect(sock.dataType).toBe("trueany");
    // A plain `any` (scalar) rejected anylist — that was the bug.
    expect(canConnect("any", "any")).toBe(true);
    expect(canConnect("anylist", "any")).toBe(false); // list into scalar any: narrowing, refused
    expect(canConnect("anylist", "trueany")).toBe(true); // list into the Conduit lane: OK
    expect(canConnect("numlist", "trueany")).toBe(true);
    expect(canConnect("frame", "trueany")).toBe(true);
  });
});

describe("List Filter output adopts the input's concrete type", () => {
  it("both outputs are anylist-based adoptive sockets (revert to anylist unwired)", () => {
    const f = new FilterNode();
    for (const key of ["result", "dropped"]) {
      const s = f.outputs[key]!.socket;
      expect(s).toBeInstanceOf(AdoptiveSocket);
      expect((s as AdoptiveSocket).base).toBe("anylist");
    }
  });

  it("passthrough() forwards the `list` input to both outputs → adopts numlist", () => {
    const f = new FilterNode();
    const specs = f.passthrough();
    expect(specs.map((s) => s.output).sort()).toEqual(["dropped", "result"]);
    for (const spec of specs) {
      expect(resolvePassthroughType(spec, (k) => (k === "list" ? "numlist" : null), agree)).toBe("numlist");
      expect(resolvePassthroughType(spec, () => "trueany", agree)).toBe("trueany"); // unwired → placeholder
    }
  });
});

describe("List Filter preserves units (passthrough) while filtering by magnitude", () => {
  it("filters on the display magnitude but keeps the dimensioned cells on the output", () => {
    const m = { length: 1 }; // meters
    const list = [tagDim(3, m), tagDim(1, m), tagDim(5, m)];
    expect(list.every(isUnitCell)).toBe(true); // sanity: real UnitCells
    const f = new FilterNode();
    f.condConfig["0"] = { op: "gt" };
    f.stringLiterals["value0"] = "2";
    const out = f.data({ list: [list] });
    expect(out.result!.every(isUnitCell)).toBe(true); // units survive the filter
    expect(out.result!.map((c) => displayMagnitudeOf(c as never))).toEqual([3, 5]);
    expect(out.dropped!.map((c) => displayMagnitudeOf(c as never))).toEqual([1]);
  });

  it("a plain numeric list still filters normally (no regression)", () => {
    const f = new FilterNode();
    f.condConfig["0"] = { op: "gte" };
    f.stringLiterals["value0"] = "3";
    const out = f.data({ list: [[1, 2, 3, 4]] });
    expect(out.result).toEqual([3, 4]);
    expect(out.dropped).toEqual([1, 2]);
  });
});
