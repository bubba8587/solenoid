// [[C10]] socketLattice, [[socket-lattice#Enforcement]]
import { describe, it, expect } from "vitest";
import { cx } from "../../src/graph/cxValue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SOCKET_COLORS, SOCKET_TYPE_LABELS, SolenoidSocket, elementFamilyOf, latticeRank, comboOfType,
  type ElementFamily, type SocketDataType,
} from "../../src/graph/sockets";
import { familyOf } from "../../src/graph/formatModel";
import { throughBoundary } from "./boundaryKit";



const ALL = Object.keys(SOCKET_TYPE_LABELS) as SocketDataType[];

// Derived from the code, so a new family is iterated too.
const FAMILIES: ElementFamily[] = [
  ...new Set(ALL.map(elementFamilyOf).filter((f): f is ElementFamily => f !== null)),
];

/** The four rungs of a family, recovered from the type list rather than restated:
 *  every type whose element family is `fam`, at any rank. */
function rungsOf(fam: ElementFamily): SocketDataType[] {
  return ALL.filter((t) => elementFamilyOf(t) === fam);
}

/** Push one value through the coercion boundary at a given socket type and return
 *  what the node's data() actually receives. */
function arrivesAt(dataType: SocketDataType, value: unknown): unknown {
  let got: unknown;
  const node = {
    inputs: { x: { socket: new SolenoidSocket(dataType) } },
    data: (i: Record<string, unknown[]>) => { got = i.x[0]; },
  };
  throughBoundary(node as unknown as Parameters<typeof throughBoundary>[0]);
  (node.data as (i: Record<string, unknown[]>) => void)({ x: [value] });
  return got;
}

const SOCKET_COMPONENT = readFileSync(resolve(__dirname, "../../src/graph/components/SocketComponent.tsx"), "utf8");
const PALETTE = readFileSync(resolve(__dirname, "../../src/graph/palette.ts"), "utf8");

describe("every element family is complete at the five sites the compiler can't see", () => {
  it("each family has all four rungs", () => {
    for (const fam of FAMILIES) {
      expect(rungsOf(fam), `${fam} rungs`).toHaveLength(4);
    }
  });


  it("every strict-list rung widens a lone value, and every combo rung collapses a singleton", () => {
    // A probe the family's element coercion leaves alone, so only the rank can change; an unlisted family gets a number.
    const PROBE: Record<string, unknown> = {
      number: 7, string: "a", date: 7, complex: cx(1, 2), logical: true,
    };
    for (const fam of FAMILIES) {
      const probe = PROBE[fam] ?? 7;
      const rungs = rungsOf(fam);
      const rank1 = rungs.filter((t) => latticeRank(t) === 1);
      expect(rank1, `${fam} has a list and a combo rung`).toHaveLength(2);
      const combo = comboOfType(rungs[0])!;
      const list = rank1.find((t) => t !== combo)!;

      expect(arrivesAt(list, probe), `${list} widens a lone value to a singleton`).toEqual([probe]);
      expect(arrivesAt(combo, [probe]), `${combo} collapses a one-element list`).toEqual(probe);
    }
  });


  it("every family's list, combo and matrix rung has a glyph branch", () => {
    const listTypes = /const LIST_TYPES = new Set\(\[(.*?)\]\)/s.exec(SOCKET_COMPONENT)![1];
    const comboKeys = /const COMBO_COLORS[^{]*\{(.*?)\n\};/s.exec(SOCKET_COMPONENT)![1];
    const tableTypes = /const TABLE_TYPES = new Set\(\[(.*?)\]\)/s.exec(SOCKET_COMPONENT)![1];

    for (const fam of FAMILIES) {
      const rungs = rungsOf(fam);
      const inOneOf = (t: SocketDataType) =>
        listTypes.includes(`"${t}"`) || new RegExp(`^\\s{2}${t}:`, "m").test(comboKeys) || tableTypes.includes(`"${t}"`);
      // Three of the four rungs draw as something other than a circle; the scalar
      // IS the circle, so it is the only one allowed to be absent.
      const nonCircle = rungs.filter(inOneOf);
      expect(nonCircle, `${fam}: list/combo/matrix rungs with a glyph branch`).toHaveLength(3);
    }
  });


  it("every socket color names a variable the palette actually defines", () => {
    for (const t of ALL) {
      const v = /var\((--[a-z-]+)\)/.exec(SOCKET_COLORS[t])?.[1];
      expect(v, `${t} names a CSS variable`).toBeTruthy();
      expect(new RegExp(`var:\\s*"${v}"`).test(PALETTE), `${t} -> ${v} has a palette.ts row`).toBe(true);
    }
  });

  // Site 4 — formatModel.familyOf ends in `default: return "none"`, which is a
  // fail-safe for the structural types but wrong for a real element family: it
  // leaves the Format Controller with no controls at all.
  it("every family-bearing rung resolves to a real FC family", () => {
    for (const fam of FAMILIES) {
      for (const rung of rungsOf(fam)) {
        expect(familyOf(rung), `FC family of ${rung}`).not.toBe("none");
      }
    }
  });
});
