import { describe, it, expect } from "vitest";
import type { ClassicPreset } from "rete";
import { extractInit } from "../../src/graph/copyPaste";
import { FilterNode } from "../../src/graph/nodes/list";
import { FilterFrameNode } from "../../src/graph/nodes/frame";

const asNode = (n: unknown) => n as ClassicPreset.Node;

describe("List Filter op config persists (the reload-reset bug)", () => {
  it("a non-default op round-trips through extractInit → constructor", () => {
    const f = new FilterNode(); // default: one row `value0`, op "gt"
    f.condConfig["0"] = { op: "noterror" };
    const init = extractInit(asNode(f));
    // The op must survive the save snapshot (was dropped: the filter checked
    // `column0`, which a value-only List Filter row never has).
    expect((init.condConfig as Record<string, { op: string }>)["0"]?.op).toBe("noterror");
    const reloaded = new FilterNode(init);
    expect(reloaded.condConfig["0"].op).toBe("noterror");
  });

  it("multiple rows each keep their op + matchCase", () => {
    const f = new FilterNode();
    f.addValueInput(); // value1
    f.addValueInput(); // value2
    f.condConfig["0"] = { op: "lt" };
    f.condConfig["1"] = { op: "contains", matchCase: true };
    f.condConfig["2"] = { op: "iserror" };
    const reloaded = new FilterNode(extractInit(asNode(f)));
    expect(reloaded.condConfig["0"].op).toBe("lt");
    expect(reloaded.condConfig["1"]).toEqual({ op: "contains", matchCase: true });
    expect(reloaded.condConfig["2"].op).toBe("iserror");
  });

  it("a removed row's orphan config is NOT persisted (byte-identical second write)", () => {
    const f = new FilterNode();
    f.addValueInput(); // value1
    f.condConfig["0"] = { op: "lt" };
    f.condConfig["1"] = { op: "gt" };
    f.removeValueInput("value1"); // condConfig["1"] lingers for undo, input gone
    const init = extractInit(asNode(f));
    expect("1" in (init.condConfig as object)).toBe(false); // orphan pruned
    expect((init.condConfig as Record<string, { op: string }>)["0"].op).toBe("lt");
  });

  it("Frame Filter op config still round-trips (no regression)", () => {
    const f = new FilterFrameNode(); // default: one pair `column0`/`value0`
    f.condConfig["0"] = { op: "contains", matchCase: true };
    const reloaded = new FilterFrameNode(extractInit(asNode(f)));
    expect(reloaded.condConfig["0"]).toEqual({ op: "contains", matchCase: true });
  });
});
