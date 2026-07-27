import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SOCKET_COLORS, SOCKET_TYPE_LABELS, SolenoidSocket, elementFamilyOf, latticeRank, comboOfType,
  type ElementFamily, type SocketDataType,
} from "./sockets";
import { familyOf } from "./formatModel";
import { wrapNodeData } from "./coerceInputs";

// Adding an element family is FOUR edits in sockets.ts — and then five more sites
// that neither the compiler nor any other test can see, because they live in a
// `Set<string>`, two string-keyed records, a CSS variable NAME, and a `default:`
// branch. `docs/socket-reference.md` section 10 lists them; this file makes them
// fail instead of merely being written down.
//
// Measured, not guessed: a throwaway `currency` family was added to sockets.ts and
// the whole suite still passed, while its list rung silently refused to widen a
// scalar, its combo silently refused to collapse a singleton, all four of its
// rungs drew as a plain circle, its colors resolved to undefined CSS variables,
// and the Format Controller offered it no controls. Every assertion below is one
// of those symptoms.
//
// Scope note: the WILDCARD rungs (anylist/anycombo/anytable) are deliberately not
// checked here — socketReference.test.ts already pins all 30 variants against the
// glyph table. This file is about the (family × rank) grid staying square.

const ALL = Object.keys(SOCKET_TYPE_LABELS) as SocketDataType[];

// DERIVED, never restated. Listing the families by hand here would reproduce the
// exact hole this file exists to close: a sixth family would simply not be
// iterated, and every assertion below would pass while ignoring it. (That is not
// hypothetical — the first draft of this file hardcoded the five and caught the
// `currency` experiment at only one of its five sites.)
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
  wrapNodeData(node as unknown as Parameters<typeof wrapNodeData>[0]);
  (node.data as (i: Record<string, unknown[]>) => void)({ x: [value] });
  return got;
}

const SOCKET_COMPONENT = readFileSync(resolve(__dirname, "./components/SocketComponent.tsx"), "utf8");
const PALETTE = readFileSync(resolve(__dirname, "./palette.ts"), "utf8");
const CONNECT_SWEEP = readFileSync(resolve(__dirname, "./socketConnect.test.ts"), "utf8");

describe("every element family is complete at the five sites the compiler can't see", () => {
  it("each family has all four rungs", () => {
    for (const fam of FAMILIES) {
      expect(rungsOf(fam), `${fam} rungs`).toHaveLength(4);
    }
  });

  // Site 1 — coerceInputs.coerceValue. A rung that falls through to `default:
  // return v` still CONNECTS, so the bug surfaces as a wrong-ranked value inside
  // data() rather than as a refused cable. This is the one that bites hardest.
  // (Only the rank-1 rungs are checked: the MATRIX rungs of string/date/complex
  // deliberately pass values through untouched — their producer already shaped
  // them — which is what section 5 documents as "the value passes as-is".)
  it("every strict-list rung widens a lone value, and every combo rung collapses a singleton", () => {
    // One probe per family, chosen so the family's own element coercion is a
    // no-op — a boolean for logical, a [re, im] pair for complex — leaving the
    // RANK change as the only thing the assertion can be measuring.
    // `ElementFamily` is `keyof typeof FAMILIES` over a string-indexed record, so
    // it widens to `string` — this map gets NO exhaustiveness check from tsc. Fall
    // back to a plain number for an unlisted family so the assertion below still
    // reads clearly instead of comparing `undefined` to `[undefined]`.
    const PROBE: Record<string, unknown> = {
      number: 7, string: "a", date: 7, complex: [1, 2], logical: true,
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

  // Site 2 — SocketComponent's render branches are keyed by plain strings, so an
  // unlisted rung silently falls to the final `else`: a plain circle.
  it("every family's list, combo and matrix rung has a glyph branch", () => {
    const listTypes = /const LIST_TYPES = new Set\(\[(.*?)\]\)/s.exec(SOCKET_COMPONENT)![1];
    const comboKeys = /const COMBO_COLORS[^{]*\{(.*?)\n\};/s.exec(SOCKET_COMPONENT)![1];
    const tableTypes = /const isTable =\s*(.*?);/s.exec(SOCKET_COMPONENT)![1];

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

  // Site 3 — SOCKET_COLORS only names CSS variables. A variable with no palette
  // registry row resolves to nothing, so the dot renders unfilled.
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

  // Site 5 — socketConnect.test.ts keeps its own FAM table on purpose, so that it
  // re-derives the lattice independently of sockets.ts. The cost is that a new
  // family is simply absent from the sweep, and the file still passes.
  it("the independent connection sweep covers every family", () => {
    for (const fam of FAMILIES) {
      expect(
        new RegExp(`^\\s*${fam}:\\s*\\{ scalar`, "m").test(CONNECT_SWEEP),
        `socketConnect.test.ts sweeps the ${fam} family`,
      ).toBe(true);
    }
  });
});
