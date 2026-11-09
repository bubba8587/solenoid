// [[C130]] rustCore, [[D99]] rustIsSpec, [[C10]] socketLattice, [[socket-lattice#Enforcement]]
import { describe, expect, it } from "vitest";
import { freezes, frozen, readFrozen, replay } from "./coreFixtures";
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
  // A freeze carries each vote over from the file (`agree_types` is the core's alone).
  return c.want ?? KEPT_VOTES.get(JSON.stringify(c.ts));
}

/** Read before `frozen` rewrites the file. */
const KEPT_VOTES = new Map(
  (freezes("lattice") ? readFrozen<Case>("lattice") : [])
    .filter((c): c is Agree => c.kind === "agree")
    .map((c) => [JSON.stringify(c.ts), c.want]),
);

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
