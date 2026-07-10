import { describe, it, expect } from "vitest";
import { CableSwitchNode } from "./control";
import { isCubeValue, type CubeValue } from "../frame";

describe("Input Switch (CableSwitchNode)", () => {
  it("single mode routes the active input through", () => {
    const n = new CableSwitchNode(); // seeds v0, v1
    n.activeIndex = 1;
    expect(n.data({ v0: [10], v1: [20] }).out).toBe(20);
    n.activeIndex = 0;
    expect(n.data({ v0: [10], v1: [20] }).out).toBe(10);
  });

  it("multi mode collects the checked inputs into a name+value cube", () => {
    const n = new CableSwitchNode();
    n.multiSelect = true;
    n.titles = { v0: "North", v1: "South" };
    n.selectedKeys = ["v0", "v1"];
    const out = n.data({ v0: [100], v1: [200] }).out;
    expect(isCubeValue(out)).toBe(true);
    const cube = out as CubeValue;
    expect(cube.columns.map((c) => c.name)).toEqual(["name", "value"]);
    expect(cube.columns[0].cells).toEqual(["North", "South"]);
    expect(cube.columns[1].cells).toEqual([100, 200]);
  });

  it("multi mode with nothing checked outputs null", () => {
    const n = new CableSwitchNode();
    n.multiSelect = true;
    expect(n.data({ v0: [1], v1: [2] }).out).toBeNull();
  });

  it("collects ONLY the checked slots, in slot order (not selection order)", () => {
    const n = new CableSwitchNode();
    n.addValueInput(); // v2
    n.multiSelect = true;
    n.selectedKeys = ["v2", "v0"]; // deliberately out of order
    n.titles = { v0: "A", v2: "C" };
    const cube = n.data({ v0: [1], v1: [2], v2: [3] }).out as CubeValue;
    expect(cube.columns[0].cells).toEqual(["A", "C"]); // v0 before v2
    expect(cube.columns[1].cells).toEqual([1, 3]);
  });

  it("collects a whole wired value (e.g. a list) as one cube cell", () => {
    const n = new CableSwitchNode();
    n.multiSelect = true;
    n.selectedKeys = ["v0"];
    const cube = n.data({ v0: [[1, 2, 3]] }).out as CubeValue;
    expect(cube.columns[1].cells).toEqual([[1, 2, 3]]); // the list rides in whole
  });

  it("titleFor falls back to a positional name", () => {
    const n = new CableSwitchNode();
    n.titles = { v0: "Named" };
    expect(n.titleFor("v0")).toBe("Named");
    expect(n.titleFor("v1")).toBe("Input 2");
  });

  it("output socket is a Cube in Many mode, `any` in One", () => {
    const dt = (n: CableSwitchNode) => (n.outputs.out!.socket as unknown as { dataType: string }).dataType;
    expect(dt(new CableSwitchNode())).toBe("trueany");
    expect(dt(new CableSwitchNode({ multiSelect: true }))).toBe("cube");
    const n = new CableSwitchNode({ multiSelect: true });
    n.multiSelect = false;
    expect(n.syncOutputType()).toBe(true);
    expect(dt(n)).toBe("trueany");
    expect(n.syncOutputType()).toBe(false); // idempotent
  });

  it("removeValueInput drops the slot's title and selection", () => {
    const n = new CableSwitchNode();
    n.titles = { v0: "A", v1: "B" };
    n.selectedKeys = ["v0", "v1"];
    n.removeValueInput("v1");
    expect(n.titles).toEqual({ v0: "A" });
    expect(n.selectedKeys).toEqual(["v0"]);
  });
});
