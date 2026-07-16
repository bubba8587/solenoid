import { describe, it, expect } from "vitest";
import { canConnect, areCompatible, type SocketDataType } from "./sockets";

// Directional connection rule, DERIVED from the (element × dimension) lattice in
// sockets.ts: widening up the dimensionality ladder (scalar → list → combo →
// matrix, same family) is allowed; narrowing a wider output into a smaller input
// is blocked at the socket (it would only ever be a runtime #SHAPE!). A scalar
// widening into a plain list (singleton) is part of this rule.

describe("canConnect (directional)", () => {
  it("allows widening a scalar/list into a table input", () => {
    expect(canConnect("number", "table")).toBe(true);
    expect(canConnect("list", "table")).toBe(true);
    expect(canConnect("numlist", "table")).toBe(true);
  });

  it("blocks narrowing a table OUTPUT into a 1-D / 0-D input", () => {
    expect(canConnect("table", "numlist")).toBe(false);
    expect(canConnect("table", "list")).toBe(false);
    expect(canConnect("table", "number")).toBe(false);
    expect(canConnect("frame", "numlist")).toBe(false);
  });

  it("still allows table → table / frame → frame; wildcards split by rank", () => {
    expect(canConnect("table", "table")).toBe(true);
    expect(canConnect("frame", "frame")).toBe(true);
    expect(canConnect("table", "trueany")).toBe(true);  // the supremum takes anything
    expect(canConnect("table", "any")).toBe(false);     // `any` is scalar-only now
    expect(canConnect("any", "numlist")).toBe(true);    // a scalar widens anywhere
  });

  it("ANY lower-rank value widens into a FRAME input (dimensional flow)", () => {
    // coerceInputs builds the frame: matrix → rows×cols, list → a single ROW,
    // scalar → 1×1. Element separation is still enforced (the frame just holds
    // whatever element type), so this is purely a dimensional widening.
    expect(canConnect("table", "frame")).toBe(true);
    expect(canConnect("strtable", "frame")).toBe(true);
    expect(canConnect("anytable", "frame")).toBe(true);
    expect(canConnect("list", "frame")).toBe(true);      // a list → one row
    expect(canConnect("strlist", "frame")).toBe(true);
    expect(canConnect("numlist", "frame")).toBe(true);   // a combo too
    expect(canConnect("number", "frame")).toBe(true);    // a scalar → 1×1
    expect(canConnect("string", "frame")).toBe(true);
    // …but a frame does NOT flow OUT into a matrix input (would lose headers).
    expect(canConnect("frame", "table")).toBe(false);
    expect(canConnect("frame", "list")).toBe(false);
  });

  it("leaves the non-2-D combos untouched (no regression)", () => {
    expect(canConnect("number", "numlist")).toBe(true);
    expect(canConnect("list", "numlist")).toBe(true);
    expect(canConnect("string", "strcombo")).toBe(true);
    expect(canConnect("date", "datecombo")).toBe(true);
    // numlist→numlist still fine; numlist→list keeps its old (symmetric) behaviour.
    expect(canConnect("numlist", "numlist")).toBe(true);
  });

  it("areCompatible stays symmetric (it's the family check, not the gate)", () => {
    expect(areCompatible("table", "numlist")).toBe(true); // same family…
    expect(canConnect("table", "numlist")).toBe(false);   // …but not a legal flow
  });

  it("the text/date 2-D matrices widen in from their own family and block narrowing", () => {
    // Widening: a scalar / list of the SAME element family flows into its matrix.
    expect(canConnect("string", "strtable")).toBe(true);
    expect(canConnect("strlist", "strtable")).toBe(true);
    expect(canConnect("strcombo", "strtable")).toBe(true);
    expect(canConnect("date", "datetable")).toBe(true);
    expect(canConnect("datelist", "datetable")).toBe(true);
    // Narrowing a 2-D matrix output into a 1-D/0-D input is blocked.
    expect(canConnect("strtable", "strlist")).toBe(false);
    expect(canConnect("datetable", "date")).toBe(false);
    // Cross-family is incompatible; same matrix / the wildcards still flow.
    expect(canConnect("strtable", "table")).toBe(false);
    expect(canConnect("number", "strtable")).toBe(false);
    expect(canConnect("strtable", "strtable")).toBe(true);
    expect(canConnect("strtable", "trueany")).toBe(true);
    expect(canConnect("strtable", "any")).toBe(false); // 2-D can't narrow into a scalar
    expect(canConnect("any", "datetable")).toBe(true);
  });

  it("anytable is a 2-D wildcard: flows into any concrete matrix, blocked from 1-D/0-D", () => {
    // A reshaper's `anytable` output drops into any concrete matrix input…
    expect(canConnect("anytable", "table")).toBe(true);
    expect(canConnect("anytable", "strtable")).toBe(true);
    expect(canConnect("anytable", "datetable")).toBe(true);
    expect(canConnect("anytable", "complextable")).toBe(true);
    expect(canConnect("anytable", "trueany")).toBe(true);
    expect(canConnect("anytable", "any")).toBe(false); // 2-D can't narrow into a scalar
    // …and a concrete matrix flows into an `anytable` input.
    expect(canConnect("table", "anytable")).toBe(true);
    expect(canConnect("strtable", "anytable")).toBe(true);
    // A 1-D list / scalar / combo of ANY family WIDENS into a 2-D `anytable` INPUT,
    // exactly as a list widens into a `table` input (TRANSPOSE of a list → a column).
    expect(canConnect("list", "anytable")).toBe(true);
    expect(canConnect("strlist", "anytable")).toBe(true);
    expect(canConnect("number", "anytable")).toBe(true);
    expect(canConnect("numlist", "anytable")).toBe(true);
    // But as an OUTPUT it's still 2-D: the narrowing block keeps an `anytable`
    // value out of 1-D/0-D inputs (the win over a plain `any` output).
    expect(canConnect("anytable", "list")).toBe(false);
    expect(canConnect("anytable", "number")).toBe(false);
    expect(canConnect("anytable", "strlist")).toBe(false);
  });

  it("a scalar widens into a plain LIST input — the uniform lattice rule", () => {
    // Previously blocked; now allowed across every family (a scalar promotes to a
    // singleton list at the coercion boundary — coerceInputs.ts / toList).
    expect(canConnect("number", "list")).toBe(true);
    expect(canConnect("string", "strlist")).toBe(true);
    expect(canConnect("date", "datelist")).toBe(true);
    expect(canConnect("complex", "complexlist")).toBe(true);
    // The reverse — narrowing a plain LIST into a scalar — stays blocked.
    expect(canConnect("list", "number")).toBe(false);
    expect(canConnect("strlist", "string")).toBe(false);
    expect(canConnect("datelist", "date")).toBe(false);
    expect(canConnect("complexlist", "complex")).toBe(false);
  });

  // A COMBO (scalar-or-list) is the exception: it MAY narrow into its element
  // scalar, because it can be a scalar (that's its purpose — e.g. an Expression's
  // numlist output feeding a number rate/count input). A plain list cannot.
  it("a combo narrows into its element scalar (a plain list does not)", () => {
    expect(canConnect("numlist", "number")).toBe(true);
    expect(canConnect("strcombo", "string")).toBe(true);
    expect(canConnect("datecombo", "date")).toBe(true);
    expect(canConnect("complexcombo", "complex")).toBe(true);
    // still NOT the plain list, and not cross-family.
    expect(canConnect("list", "number")).toBe(false);
    expect(canConnect("numlist", "string")).toBe(false);
  });
});

// The complex family was added to the lattice (FAMILIES row) with NO hand-written
// accept-sets — its connectivity should fall out identically to number/string/date,
// proving the derivation is the single source of truth (the extensibility test).
describe("complex family — derived, not hand-wired", () => {
  it("widens scalar → list / combo / matrix like every other family", () => {
    expect(canConnect("complex", "complexlist")).toBe(true);
    expect(canConnect("complex", "complexcombo")).toBe(true);
    expect(canConnect("complex", "complextable")).toBe(true);
    expect(canConnect("complexlist", "complextable")).toBe(true);
    expect(canConnect("complexcombo", "complextable")).toBe(true);
    expect(canConnect("complexlist", "complexcombo")).toBe(true);
    expect(canConnect("complexcombo", "complexlist")).toBe(true);
  });

  it("blocks narrowing back down the ladder (but a combo may reach its scalar)", () => {
    expect(canConnect("complextable", "complexlist")).toBe(false);
    expect(canConnect("complextable", "complexcombo")).toBe(false);
    expect(canConnect("complexlist", "complex")).toBe(false); // plain list → scalar blocked
    expect(canConnect("complexcombo", "complex")).toBe(true); // combo → scalar allowed (it can be a scalar)
  });

  it("is cross-family incompatible, but joins the anytable wildcard + any", () => {
    expect(canConnect("complex", "number")).toBe(false);
    expect(canConnect("complextable", "table")).toBe(false);    // distinct element family
    expect(canConnect("complextable", "strtable")).toBe(false);
    expect(canConnect("complextable", "anytable")).toBe(true);  // 2-D wildcard accepts it
    expect(canConnect("anytable", "complextable")).toBe(true);
    expect(canConnect("complextable", "trueany")).toBe(true);
    expect(canConnect("complextable", "any")).toBe(false); // scalar rung refuses a matrix
    expect(canConnect("any", "complexcombo")).toBe(true);
  });
});

describe("logical family — lattice derivation falls out automatically", () => {
  it("widens scalar → list → combo → matrix like every other family", () => {
    expect(canConnect("logical", "logicallist")).toBe(true);   // scalar → list
    expect(canConnect("logical", "logicaltable")).toBe(true);  // scalar → matrix
    expect(canConnect("logicallist", "logicaltable")).toBe(true);
    expect(canConnect("logicalcombo", "logical")).toBe(true);  // combo may narrow to its scalar
  });
  it("blocks narrowing and cross-family, but the wildcards bridge", () => {
    expect(canConnect("logicaltable", "logicallist")).toBe(false); // narrowing blocked
    expect(canConnect("logical", "string")).toBe(false);           // distinct family, no coercion edge
    expect(canConnect("logicaltable", "anytable")).toBe(true);     // 2-D wildcard accepts it
    expect(canConnect("any", "logicalcombo")).toBe(true);          // a scalar fits a combo
    expect(areCompatible("logical", "logicallist")).toBe(true);
  });
  it("logical ↔ number coercion edges are permitted (boolean ↔ 0/1)", () => {
    expect(canConnect("logical", "number")).toBe(true);       // a>b → math (coerces to 1/0)
    expect(canConnect("logicalcombo", "numlist")).toBe(true);
    expect(canConnect("number", "logical")).toBe(true);       // a 0/1 → a logic input
    expect(canConnect("list", "logicallist")).toBe(true);
    expect(canConnect("logicaltable", "number")).toBe(false); // rank still can't narrow
  });
});

// ─── Whole-lattice invariants (machine-checked) ────────────────────────────────
// Governing rule (dev-notes): enforce TYPE separation (element families never
// auto-cross — the ONE exception is logical↔number), allow DIMENSIONAL flow
// (scalar → list/combo → matrix → frame). This sweeps the ENTIRE cross product so
// any future rework that drops a cross-type edge (the recurring failure mode) fails
// loudly here instead of silently.
describe("lattice invariants — TYPE separation + DIMENSIONAL flow (full sweep)", () => {
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
  const allTypes = fams.flatMap((f) => DIMS.map((d) => FAM[f][d]));
  // logical ↔ number is the only deliberate cross-family bridge (0/1 ⟷ TRUE/FALSE).
  const bridged = (a: string, b: string) =>
    (a === "number" && b === "logical") || (a === "logical" && b === "number");

  it("WITHIN a family: a value widens UP (+ combo→scalar), and never narrows", () => {
    for (const f of fams) for (const dOut of DIMS) for (const dIn of DIMS) {
      const expected = RANK[dOut] <= RANK[dIn] || (dOut === "combo" && dIn === "scalar");
      expect(canConnect(FAM[f][dOut], FAM[f][dIn])).toBe(expected);
    }
  });

  it("CROSS-family is blocked everywhere EXCEPT logical↔number (rank-mirrored)", () => {
    for (const fOut of fams) for (const fIn of fams) {
      if (fOut === fIn) continue;
      for (const dOut of DIMS) for (const dIn of DIMS) {
        const expected = bridged(fOut, fIn) && RANK[dOut] <= RANK[dIn];
        expect(canConnect(FAM[fOut][dOut], FAM[fIn][dIn])).toBe(expected);
      }
    }
  });

  it("every rank≤2 value (ANY family) widens INTO the 2-D containers (anytable, frame)", () => {
    for (const t of allTypes) {
      expect(canConnect(t, "anytable")).toBe(true);
      expect(canConnect(t, "frame")).toBe(true);
    }
    expect(canConnect("anytable", "anytable")).toBe(true);
    expect(canConnect("anytable", "frame")).toBe(true);
  });

  it("anytable OUTPUT stays 2-D: → a concrete matrix / frame, never narrows to 1-D", () => {
    for (const f of fams) {
      expect(canConnect("anytable", FAM[f].matrix)).toBe(true);
      expect(canConnect("anytable", FAM[f].list)).toBe(false);
      expect(canConnect("anytable", FAM[f].scalar)).toBe(false);
    }
    expect(canConnect("anytable", "frame")).toBe(true);
  });

  it("frame OUTPUT flows only into another frame (it'd lose headers elsewhere)", () => {
    for (const t of allTypes) expect(canConnect("frame", t)).toBe(false);
    expect(canConnect("frame", "anytable")).toBe(false);
    expect(canConnect("frame", "frame")).toBe(true);
  });

  // `trueany` is the supremum wildcard — the ONLY type that bridges everything,
  // object family included (Display / selectors / Cast / Report refs / composite
  // ports / unwired Conduit lanes).
  it("`trueany` bridges everything, both directions", () => {
    for (const t of [...allTypes, "anytable", "anylist", "frame", "cube", "lambda", "chart", "document", "any"] as SocketDataType[]) {
      expect(canConnect(t, "trueany")).toBe(true);
      expect(canConnect("trueany", t)).toBe(true);
    }
  });

  // `any` is the rank-0 rung of the wildcard ladder (any → anylist → anytable):
  // an element-agnostic SINGLE value. Its input takes any family scalar (and a
  // combo, which can be a scalar); a container does NOT narrow into it. Its
  // output — a scalar of unknown family — widens anywhere data flows, but never
  // into the object family.
  it("`any` INPUT: family scalars + combos in; lists/matrices/containers refused", () => {
    for (const f of fams) {
      expect(canConnect(FAM[f].scalar, "any")).toBe(true);
      expect(canConnect(FAM[f].combo, "any")).toBe(true);   // combo CAN be a scalar
      expect(canConnect(FAM[f].list, "any")).toBe(false);   // 1-D can't narrow
      expect(canConnect(FAM[f].matrix, "any")).toBe(false); // 2-D can't narrow
    }
    for (const t of ["anylist", "anytable", "frame", "cube", "lambda", "chart", "document"] as SocketDataType[]) {
      expect(canConnect(t, "any")).toBe(false);
    }
    expect(canConnect("any", "any")).toBe(true); // identity
  });

  it("`any` OUTPUT: widens into every data input (scalar → everywhere), never the object family", () => {
    for (const t of [...allTypes, "anytable", "anylist", "frame", "cube"] as SocketDataType[]) {
      expect(canConnect("any", t)).toBe(true);
    }
    expect(canConnect("any", "lambda")).toBe(false);
    expect(canConnect("any", "chart")).toBe(false);
    expect(canConnect("any", "document")).toBe(false);
  });

  // `anylist` is the rank-1 element-agnostic wildcard — the 1-D sibling of `anytable`.
  // Same shape as the anytable invariants, one rank down: any scalar/list/combo widens
  // IN; the output stays 1-D (drops into a concrete list/combo, widens up into the 2-D
  // containers) and never narrows to a scalar or fills an element-specific matrix.
  it("anylist INPUT: any rank≤1 value (any family) widens in; a matrix / 2-D does not", () => {
    for (const f of fams) {
      expect(canConnect(FAM[f].scalar, "anylist")).toBe(true);
      expect(canConnect(FAM[f].list, "anylist")).toBe(true);
      expect(canConnect(FAM[f].combo, "anylist")).toBe(true);
      expect(canConnect(FAM[f].matrix, "anylist")).toBe(false); // narrowing 2-D → 1-D
    }
    expect(canConnect("anytable", "anylist")).toBe(false);
    expect(canConnect("anylist", "anylist")).toBe(true);        // identity
  });

  it("anylist OUTPUT: → any concrete list/combo + widens up (anytable/frame/cube), never a scalar or element-specific matrix", () => {
    for (const f of fams) {
      expect(canConnect("anylist", FAM[f].list)).toBe(true);
      expect(canConnect("anylist", FAM[f].combo)).toBe(true);
      expect(canConnect("anylist", FAM[f].scalar)).toBe(false); // no narrowing to a scalar
      expect(canConnect("anylist", FAM[f].matrix)).toBe(false); // element-specific 2-D, not a wildcard
    }
    expect(canConnect("anylist", "anytable")).toBe(true);
    expect(canConnect("anylist", "frame")).toBe(true);
    expect(canConnect("anylist", "cube")).toBe(true);
  });

  // The OBJECT socket family (`lambda`, `chart`, `document`) sits OUTSIDE the
  // element×dimension lattice entirely — none is in FAMILIES/MATRIX_TYPES/
  // FAMILY_VALUE_TYPES, so `accepts()` falls through to identity + `trueany` only
  // (no entry in SOCKET_ACCEPTS). Every member gets the identical identity-only
  // treatment — extend OBJECT_TYPES when a new object socket ships and the sweep
  // covers it for free.
  const OBJECT_TYPES = ["lambda", "chart", "document"] as const satisfies readonly SocketDataType[];
  it("object types are identity-only: self + trueany, never a regular lattice type", () => {
    for (const o of OBJECT_TYPES) {
      expect(canConnect(o, o)).toBe(true);
      for (const t of [...allTypes, "anytable", "frame", "cube"] as SocketDataType[]) {
        expect(canConnect(o, t)).toBe(false);
        expect(canConnect(t, o)).toBe(false);
      }
    }
  });

  it("object types don't cross into each other — distinct object-family members", () => {
    for (const a of OBJECT_TYPES) for (const b of OBJECT_TYPES) {
      if (a !== b) expect(canConnect(a, b)).toBe(false);
    }
  });
});

// ─── Cube — the lattice SUPREMUM (closes the socket types) ─────────────────────
// A `cube` is the universal recursive container (a frame whose cells hold any
// value). The governing rule: EVERY data value widens UP into a cube input
// (including a frame and another cube); a cube OUTPUT preserves its nesting, so it
// flows ONLY into another cube or `trueany` — never down into a frame / matrix / list
// (that would silently drop the nesting). This is the top of the dimensional ladder.
describe("cube — universal recursive container (lattice supremum)", () => {
  const FAM = {
    number:  { scalar: "number",  list: "list",        combo: "numlist",      matrix: "table" },
    string:  { scalar: "string",  list: "strlist",     combo: "strcombo",     matrix: "strtable" },
    date:    { scalar: "date",    list: "datelist",    combo: "datecombo",    matrix: "datetable" },
    complex: { scalar: "complex", list: "complexlist", combo: "complexcombo", matrix: "complextable" },
    logical: { scalar: "logical", list: "logicallist", combo: "logicalcombo", matrix: "logicaltable" },
  } as const satisfies Record<string, Record<string, SocketDataType>>;
  const DIMS = ["scalar", "list", "combo", "matrix"] as const;
  const allTypes = (Object.keys(FAM) as (keyof typeof FAM)[]).flatMap((f) => DIMS.map((d) => FAM[f][d]));

  it("EVERY rank≤2 value (any family) widens INTO a cube input", () => {
    for (const t of allTypes) expect(canConnect(t, "cube")).toBe(true);
  });

  it("the 2-D containers (anytable, frame) and another cube also widen in", () => {
    expect(canConnect("anytable", "cube")).toBe(true);
    expect(canConnect("frame", "cube")).toBe(true);   // a frame is a cube of flat cells
    expect(canConnect("cube", "cube")).toBe(true);    // identity
  });

  it("a cube OUTPUT preserves nesting: only → cube / trueany, never a narrower container", () => {
    for (const t of allTypes) expect(canConnect("cube", t)).toBe(false);
    expect(canConnect("cube", "frame")).toBe(false);   // would drop the nesting
    expect(canConnect("cube", "anytable")).toBe(false);
    expect(canConnect("cube", "table")).toBe(false);
    expect(canConnect("cube", "list")).toBe(false);
    expect(canConnect("cube", "number")).toBe(false);
    expect(canConnect("cube", "cube")).toBe(true);
    expect(canConnect("cube", "trueany")).toBe(true);
    expect(canConnect("cube", "any")).toBe(false); // a cube can't narrow into a scalar
  });

  it("the wildcards vs a cube: trueany both ways; scalar `any` widens IN only", () => {
    expect(canConnect("trueany", "cube")).toBe(true);
    expect(canConnect("cube", "trueany")).toBe(true);
    expect(canConnect("any", "cube")).toBe(true);   // a scalar widens into the supremum
  });

  it("areCompatible(cube, …) is symmetric over everything it accepts", () => {
    expect(areCompatible("cube", "frame")).toBe(true);
    expect(areCompatible("number", "cube")).toBe(true);
  });
});
