// [[C130]] rustCore, [[D99]] rustIsSpec, [[C10]] socketLattice
// The socket lattice's frozen answers (fixtures/core/lattice.json.gz): for every pair of the 31 socket types, whether
// an output connects to an input, what an adoptive input of that base takes up from that cable, and what an adoptive
// output of that base shows for that type; per type, its rank, its element family and its forms at each rank.
import { describe, expect, it } from "vitest";
import { frozen, replay } from "./coreFixtures";
import {
  canConnect, adoptTypeForBase, projectTypeToBase, latticeRank, elementFamilyOf, typeAtRank, comboOfType,
  type SocketDataType,
} from "../../src/graph/sockets";

export const SOCKET_TYPES: SocketDataType[] = [
  "number", "list", "numlist", "string", "strlist", "strcombo", "date", "datelist", "datecombo",
  "complex", "complexlist", "complexcombo", "complextable", "logical", "logicallist", "logicalcombo", "logicaltable",
  "table", "strtable", "datetable", "anytable", "anylist", "anydata", "anycombo", "frame", "cube",
  "lambda", "chart", "document", "any", "trueany",
];

type Pair = { kind: "pair"; a: SocketDataType; b: SocketDataType; want?: unknown };
type One = { kind: "one"; t: SocketDataType; want?: unknown };
type Agree = { kind: "agree"; ts: (SocketDataType | null)[]; want?: unknown };
type Case = Pair | One | Agree;

function answer(c: Case): unknown {
  if (c.kind === "pair") {
    return { connects: canConnect(c.a, c.b), adopts: adoptTypeForBase(c.a, c.b), projects: projectTypeToBase(c.a, c.b) };
  }
  if (c.kind === "one") {
    return {
      rank: latticeRank(c.t), family: elementFamilyOf(c.t), combo: comboOfType(c.t),
      atRank: [typeAtRank(c.t, 0), typeAtRank(c.t, 1), typeAtRank(c.t, 2)],
    };
  }
  // The settle's agreement vote is the core's alone now (`lattice.rs` `agree_types`, held to these cases natively).
  return c.want;
}

describe("the socket lattice holds to its frozen answers", () => {
  const cases = frozen<Case>("lattice", () => {
    const out: Case[] = [];
    for (const a of SOCKET_TYPES) for (const b of SOCKET_TYPES) out.push({ kind: "pair", a, b });
    for (const t of SOCKET_TYPES) out.push({ kind: "one", t });
    const picks: (SocketDataType | null)[] = [null, "number", "list", "string", "frame", "trueany", "anylist"];
    for (const x of picks) for (const y of picks) out.push({ kind: "agree", ts: [x, y] });
    out.push({ kind: "agree", ts: [] }, { kind: "agree", ts: ["number", "number", "number"] }, { kind: "agree", ts: ["number", null, "list"] });
    return out;
  });

  it("every pair, every type and every vote", () => {
    expect(cases.length).toBeGreaterThan(31 * 31);
    expect(replay("lattice", cases as (Case & { want: unknown })[], answer)).toEqual([]);
  });
});
