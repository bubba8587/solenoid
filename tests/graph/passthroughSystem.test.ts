import { describe, it, expect } from "vitest";
import { getPassthrough, isPurePassthroughNode, passInputKeys, selectedPassInput } from "../../src/graph/nodes/passthrough";
import type { Shape } from "../../src/graph/frameShape";
import { settledOutputs } from "./settleKit";
import { canConnect, isDateType, MutableSocket, type SocketDataType } from "../../src/graph/sockets";
import { DisplayNode } from "../../src/graph/nodes/display";
import { ExpectNode } from "../../src/graph/nodes/quality";
import { CableSwitchNode } from "../../src/graph/nodes/control";
import { IfNode, IFErrorNode, ChooseNode, SwitchNode, IfsNode, BooleanOpNode, ComparisonNode } from "../../src/graph/nodes/logic";
import { ListIndexNode, FillNode, ConcatListsNode } from "../../src/graph/nodes/list";
import { StackNode } from "../../src/graph/nodes/matrix";
import { ValueInputNode } from "../../src/graph/nodes/control";

// [[type-propagation-on-in-place-socket-retype#Passthrough is one declaration]], [[type-propagation-on-in-place-socket-retype#A trueany output declares its passthrough]]

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

  it("Fill/Coalesce passes units like its 2×2 sibling IFERROR", () => {
    const co = new FillNode({ op: "coalesce" });
    const spec = getPassthrough(co)[0];
    expect(spec).toMatchObject({ output: "result", combine: "agree" });
    expect(spec.inputs[0]).toBe("list");
    expect(spec.inputs.length).toBeGreaterThan(1); // the Else rows are value branches
    expect(getPassthrough(new FillNode({ op: "ffill" }))[0]).toMatchObject({ inputs: ["list"], combine: "single" });
    expect(isPurePassthroughNode(co)).toBe(false); // cells change — never pure
  });

  it("the append ladder declares `agree` over its extensible rows (1-D and 2-D rungs)", () => {

    for (const n of [new ConcatListsNode(), new StackNode({ op: "vstack" }), new StackNode({ op: "hstack" })]) {
      const spec = getPassthrough(n)[0];
      expect(spec).toMatchObject({ output: "result", combine: "agree" });
      expect(spec.inputs).toEqual((n as { valueInputKeys(): string[] }).valueInputKeys());
      expect(isPurePassthroughNode(n)).toBe(false); // cells are rearranged/padded — never pure
    }
    const grown = new StackNode({ op: "vstack" });
    const added = grown.addValueInput();
    expect(getPassthrough(grown)[0].inputs).toContain(added); // re-read each pass, not snapshotted
  });

  it("generative / producer nodes declare NO passthrough (their output is genuinely static)", () => {

    for (const n of [new ValueInputNode(), new BooleanOpNode(), new ComparisonNode()]) {
      expect(getPassthrough(n)).toEqual([]);
    }
  });


  it("INDEX forwards its container's element family at the COMBO rung", () => {
    const n = new ListIndexNode();
    expect(getPassthrough(n).length).toBeGreaterThan(0);
    expect(isPurePassthroughNode(n)).toBe(false); // a cell is not the container
    const spec = getPassthrough(n)[0];
    expect(spec).toMatchObject({ output: "result", combine: "single" });
    expect(spec.inputs).toEqual(["list"]);

    const resolve = (t: SocketDataType | null) => settledOutputs(n, t ? { list: t } : {}).result;

    // A homogeneous container: the socket fixes the family however it is sliced.
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
    // A Frame with no shape context and no Column set: the whole row, still a frame.
    expect(resolve("frame")).toBe("frame");
    // A Cube with both axes blank (the defaults).
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
    void spec;
    const resolve = (ctx: { shape?: Shape | null; wiredColumn?: boolean }) =>
      settledOutputs(n, { list: { type: "frame", shape: "shape" in ctx ? ctx.shape : shape }, ...(ctx.wiredColumn ? { column: "number" as const } : {}) }).result;

    // No Column → the whole row (or the whole frame): still a frame.
    expect(resolve({})).toBe("frame");
    n.literals.column = 0; // Excel's explicit "all columns"
    expect(resolve({})).toBe("frame");


    n.literals.column = 2;
    expect(resolve({})).toBe("datecombo");
    n.literals.column = 1;
    expect(resolve({})).toBe("strcombo");
    n.literals.column = 3;
    expect(resolve({})).toBe("numlist");

    // Out of range, an unknown upstream shape, a data-driven column count and a wired Column.
    n.literals.column = 9;
    expect(resolve({})).toBe("trueany");
    n.literals.column = 2;
    expect(resolve({ shape: null })).toBe("trueany");
    expect(resolve({ shape: { ...shape, dynamic: true } })).toBe("trueany");
    expect(resolve({ wiredColumn: true })).toBe("trueany");
  });


  it("an extracted date is still date-typed, and reaches both a scalar and a list input", () => {
    const out = settledOutputs(new ListIndexNode(), { list: "datelist" }).result;
    expect(isDateType(out)).toBe(true);
    expect(canConnect(out, "date")).toBe(true);      // one cell → a scalar date input
    expect(canConnect(out, "datelist")).toBe(true);  // a whole axis → a date list input

    expect(canConnect(out, "number")).toBe(false);
    expect(canConnect(out, "string")).toBe(false);
  });
});

// [[C136]] typesKnownAfterCalc, [[socket-lattice#An empty answer keeps the type it last carried; before any, its source's declared type]]
describe("every passthrough output can take the type of its value", () => {
  it("its socket is retypeable, and branches that vote declare `selected`", async () => {
    const { FLAT_CATALOG } = await import("../../src/graph/catalogUtils");

    const COMBINERS = new Set(["ConcatListsNode", "SetsNode", "InterleaveNode", "StackNode"]);
    const gaps: string[] = [];
    const seen = new Set<string>();
    for (const entry of FLAT_CATALOG.values()) {
      let n: object;
      try { n = entry.create() as object; } catch { continue; }
      const cls = n.constructor.name;
      if (seen.has(cls)) continue;
      seen.add(cls);
      for (const s of getPassthrough(n)) {
        const socket = (n as { outputs?: Record<string, { socket?: unknown }> }).outputs?.[s.output]?.socket;
        const wildcard = ["any", "anycombo", "anylist", "anytable", "anydata", "trueany"].includes((socket as { dataType?: string })?.dataType ?? "");
        if (wildcard && !(socket instanceof MutableSocket)) gaps.push(`${cls}.${s.output}: a fixed wildcard the value can't type`);
        if (s.combine === "agree" && s.inputs.length > 1 && !s.selected && !COMBINERS.has(cls)) gaps.push(`${cls}.${s.output}: voting branches with no selected`);
      }
    }
    expect(gaps).toEqual([]);
  });
});
