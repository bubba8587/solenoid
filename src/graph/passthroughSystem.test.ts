import { describe, it, expect } from "vitest";
import { getPassthrough, isPassthroughNode, isPurePassthroughNode, passInputKeys, selectedPassInput } from "./nodes/passthrough";
import { DisplayNode } from "./nodes/display";
import { ExpectNode } from "./nodes/quality";
import { CableSwitchNode } from "./nodes/control";
import { IfNode, IFErrorNode, ChooseNode, SwitchNode, IfsNode, BooleanOpNode, ComparisonNode } from "./nodes/logic";
import { ListIndexNode, FillNode } from "./nodes/list";
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

  it("generative / producer nodes declare NO passthrough (their output is genuinely static)", () => {
    // INDEX/XLOOKUP results vary per row; a Number is a source; a Boolean op / Comparison
    // MAKE a new logical value. None of them forward an input type.
    for (const n of [new ListIndexNode(), new NumberInputNode(), new BooleanOpNode(), new ComparisonNode()]) {
      expect(isPassthroughNode(n)).toBe(false);
    }
  });
});
