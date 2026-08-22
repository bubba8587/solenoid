import { describe, it, expect } from "vitest";
import { getPassthrough, isPassthroughNode, isPurePassthroughNode, passInputKeys, selectedPassInput, resolvePassthroughType, type ProjectContext } from "./nodes/passthrough";
import type { Shape } from "./frameShape";
import { canConnect, isDateType, type SocketDataType } from "./sockets";
import { DisplayNode } from "./nodes/display";
import { ExpectNode } from "./nodes/quality";
import { CableSwitchNode } from "./nodes/control";
import { IfNode, IFErrorNode, ChooseNode, SwitchNode, IfsNode, BooleanOpNode, ComparisonNode } from "./nodes/logic";
import { ListIndexNode, FillNode, ConcatListsNode } from "./nodes/list";
import { VStackNode, HStackTableNode } from "./nodes/matrix";
import { NumberInputNode } from "./nodes/input";

// The passthrough declaration is the ONE source of truth that trueany TYPE adoption,
// UNIT flow, the type-default DISPLAY walk, and coerceInputs' keep-tags boundary all
// read (passthrough.ts). This pins each node's declaration so the type set and the unit
// set can NEVER drift apart again (the exact bug that left Expect / Cable Switch /
// IFERROR passing type but not units before the 2026-07-15 unification).

describe("passthrough declarations", () => {
  it("Display / Expect are PURE single passthroughs on their value input", () => {
    for (const n of [new DisplayNode(), new ExpectNode()]) {
      const specs = getPassthrough(n);
      expect(specs).toHaveLength(1);
      expect(specs[0]).toMatchObject({ output: "out", inputs: ["in"], combine: "single", pure: true });
      expect(isPurePassthroughNode(n)).toBe(true);
    }
  });

  it("Expect forwards ONLY `in` — not its min/max/pattern check parameters", () => {
    // The old passesUnitThrough=true meant "all inputs" and couldn't express this,
    // which is why Expect never carried units. The explicit spec fixes it.
    expect(passInputKeys(new ExpectNode())).toEqual(["in"]);
  });

  it("selectors declare `agree` over their value branches (not the condition)", () => {
    expect(getPassthrough(new IfNode())[0]).toMatchObject({ output: "result", inputs: ["then", "else"], combine: "agree" });
    expect(getPassthrough(new IFErrorNode())[0]).toMatchObject({ output: "result", inputs: ["value", "fallback"], combine: "agree" });
    // Choose/Switch/Ifs enumerate their extensible value rows.
    expect(getPassthrough(new ChooseNode())[0].combine).toBe("agree");
    expect(passInputKeys(new SwitchNode())).toContain("default");
    expect(passInputKeys(new IfsNode())).toContain("otherwise");
  });

  it("IF follows its data-aware selected branch; a null selection is indeterminate", () => {
    const iff = new IfNode();
    iff._selectedUnitKey = "then";
    expect(selectedPassInput(iff)).toBe("then");
    iff._selectedUnitKey = null;
    expect(selectedPassInput(iff)).toBeNull();
  });

  it("Cable Switch is `active` in One mode, and NOT a passthrough in Many mode", () => {
    const one = new CableSwitchNode({ activeIndex: 1 });
    const keys = Object.keys(one.inputs);
    const spec = getPassthrough(one)[0];
    expect(spec).toMatchObject({ output: "out", combine: "active" });
    expect(spec.inputs).toEqual(keys);
    expect(selectedPassInput(one)).toBe(keys[1]); // the active branch
    expect(getPassthrough(new CableSwitchNode({ multiSelect: true }))).toEqual([]); // Many → Cube, not passthrough
  });

  it("Fill/Coalesce passes units like its 2×2 sibling IFERROR (audit 2026-07-16)", () => {
    // Coalesce = agree across the list + its Else fallbacks (IFERROR's missing-value
    // twin); the impute modes fill FROM the list's own values → single on the list.
    const co = new FillNode({ op: "coalesce" });
    const spec = getPassthrough(co)[0];
    expect(spec).toMatchObject({ output: "result", combine: "agree" });
    expect(spec.inputs[0]).toBe("list");
    expect(spec.inputs.length).toBeGreaterThan(1); // the Else rows are value branches
    expect(getPassthrough(new FillNode({ op: "ffill" }))[0]).toMatchObject({ inputs: ["list"], combine: "single" });
    expect(isPurePassthroughNode(co)).toBe(false); // cells change — never pure
  });

  it("the append ladder declares `agree` over its extensible rows (1-D and 2-D rungs)", () => {
    // Concat Lists (1-D) and VSTACK/HSTACK (2-D) are the same shape: element-preserving
    // combiners whose value branches are ALL their rows, so the row keys must track the
    // extensible set rather than a fixed pair (appendLadder).
    for (const n of [new ConcatListsNode(), new VStackNode(), new HStackTableNode()]) {
      const spec = getPassthrough(n)[0];
      expect(spec).toMatchObject({ output: "result", combine: "agree" });
      expect(spec.inputs).toEqual((n as { valueInputKeys(): string[] }).valueInputKeys());
      expect(isPurePassthroughNode(n)).toBe(false); // cells are rearranged/padded — never pure
    }
    const grown = new VStackNode();
    const added = grown.addValueInput();
    expect(getPassthrough(grown)[0].inputs).toContain(added); // re-read each pass, not snapshotted
  });

  it("generative / producer nodes declare NO passthrough (their output is genuinely static)", () => {
    // A Number is a source; a Boolean op / Comparison MAKE a new logical value. None
    // of them forward an input type. (INDEX does — see the extraction test below.)
    for (const n of [new NumberInputNode(), new BooleanOpNode(), new ComparisonNode()]) {
      expect(isPassthroughNode(n)).toBe(false);
    }
  });

  // INDEX is an EXTRACTION: it forwards a value out of its container, so it declares a
  // passthrough with a `project` that drops the container's RANK while keeping its
  // element family. It was static `trueany` until 2026-07-25 on the grounds that its
  // result "varies per row" — true only where the container is heterogeneous.
  it("INDEX forwards its container's element family at the COMBO rung", () => {
    const n = new ListIndexNode();
    expect(isPassthroughNode(n)).toBe(true);
    expect(isPurePassthroughNode(n)).toBe(false); // a cell is not the container
    const spec = getPassthrough(n)[0];
    expect(spec).toMatchObject({ output: "result", combine: "single" });
    expect(spec.inputs).toEqual(["list"]);

    const resolve = (t: SocketDataType | null) =>
      resolvePassthroughType(spec, () => t, (ts) => (ts[0] as SocketDataType) ?? "trueany");

    // A HOMOGENEOUS container: the family is fixed by the socket however you slice it,
    // and the combo covers both shapes the runtime arguments can produce.
    expect(resolve("datelist")).toBe("datecombo");
    expect(resolve("date")).toBe("datecombo");
    expect(resolve("datetable")).toBe("datecombo");
    expect(resolve("strlist")).toBe("strcombo");
    expect(resolve("logicaltable")).toBe("logicalcombo");
    expect(resolve("list")).toBe("numlist");
    expect(resolve("complexlist")).toBe("complexcombo");

    // Untyped wildcards: genuinely unknowable, so the placeholder stands.
    for (const t of ["anylist", "anytable", "any", "trueany"] as const) {
      expect(resolve(t)).toBe("trueany");
    }
    expect(resolve(null)).toBe("trueany"); // unwired
    // A FRAME resolves per COLUMN, not per socket — with no shape context and no
    // Column set, the extraction is the whole row, which is still a frame.
    expect(resolve("frame")).toBe("frame");
    // A CUBE's slices are always cubes: with a blank axis (here both — the
    // defaults) the result is a cube; only Row AND Column both given is an
    // unknowable single cell.
    expect(resolve("cube")).toBe("cube");
    n.literals.index = 1;
    n.literals.column = 1;
    expect(resolve("cube")).toBe("trueany");
  });

  it("INDEX over a FRAME takes the named COLUMN's family from the static shape", () => {
    const n = new ListIndexNode();
    const spec = getPassthrough(n)[0];
    const shape: Shape = {
      columns: [{ name: "Item", type: "string" }, { name: "Due", type: "date" }, { name: "Qty", type: "number" }],
    };
    const resolve = (ctx: Partial<ProjectContext>) =>
      resolvePassthroughType(spec, () => "frame", () => "trueany", {
        shapeOf: () => shape, wired: () => false, ...ctx,
      });

    // No Column → the whole row (or the whole frame): still a frame.
    expect(resolve({})).toBe("frame");
    n.literals.column = 0; // Excel's explicit "all columns"
    expect(resolve({})).toBe("frame");

    // A named column: THAT column's family, at the combo rung (whole column for a
    // blank Row, one cell otherwise).
    n.literals.column = 2;
    expect(resolve({})).toBe("datecombo");
    n.literals.column = 1;
    expect(resolve({})).toBe("strcombo");
    n.literals.column = 3;
    expect(resolve({})).toBe("numlist");

    // Out of range (a #REF! at runtime), an unknown upstream shape (CSV / Web
    // Source), a data-driven column count, and a WIRED Column (a runtime value the
    // literal no longer decides) all stay the placeholder.
    n.literals.column = 9;
    expect(resolve({})).toBe("trueany");
    n.literals.column = 2;
    expect(resolve({ shapeOf: () => null })).toBe("trueany");
    expect(resolve({ shapeOf: () => ({ ...shape, dynamic: true }) })).toBe("trueany");
    expect(resolve({ wired: (k) => k === "column" })).toBe("trueany");
  });

  // The point of the change: a date pulled out of a date list stays a DATE downstream.
  // `isDateType` reads the socket, so a static `trueany` output rendered a raw serial.
  it("an extracted date is still date-typed, and reaches both a scalar and a list input", () => {
    const spec = getPassthrough(new ListIndexNode())[0];
    const out = resolvePassthroughType(spec, () => "datelist", () => "trueany");
    expect(isDateType(out)).toBe(true);
    expect(canConnect(out, "date")).toBe(true);      // one cell → a scalar date input
    expect(canConnect(out, "datelist")).toBe(true);  // a whole axis → a date list input
    // Element separation still holds — extraction never crosses families.
    expect(canConnect(out, "number")).toBe(false);
    expect(canConnect(out, "string")).toBe(false);
  });
});
