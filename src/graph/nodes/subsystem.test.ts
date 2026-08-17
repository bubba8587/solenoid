import { describe, it, expect } from "vitest";
import { SubsystemNode } from "./subsystem";
import { extractInit } from "../copyPaste";
import { isFrameValue } from "../frame";

describe("SubsystemNode", () => {
  const TEXT = "module, role, imports\nprocess.ts, recompute, 12\nsockets.ts, lattice, 9";

  it("outputs its module table as a frame, memoized while the text is unchanged", () => {
    const n = new SubsystemNode({ label: "Engine / core", frameText: TEXT });
    const out = n.data().modules;
    expect(isFrameValue(out)).toBe(true);
    expect(out.columns.map((c) => c.name)).toEqual(["module", "role", "imports"]);
    expect(out.columns[0].values).toEqual(["process.ts", "sockets.ts"]);
    expect(n.data().modules).toBe(out);
    n.frameText = "module\nx.ts";
    expect(n.data().modules).not.toBe(out);
  });

  it("declares the dependency input as multi-connection and data-inert", () => {
    const n = new SubsystemNode();
    expect(n.inputs.deps?.multipleConnections).toBe(true);
    // data() reads nothing from inputs — the wiring IS the information.
    expect(n.data().modules.columns[0].name).toBe("module");
  });

  it("round-trips through extractInit", () => {
    const n = new SubsystemNode({ label: "Cables", frameText: TEXT });
    const init = extractInit(n) as { label?: string; frameText?: string };
    expect(init.label).toBe("Cables");
    expect(init.frameText).toBe(TEXT);
    const back = new SubsystemNode(init);
    expect(back.label).toBe("Cables");
    expect(back.data().modules.columns[0].values).toEqual(["process.ts", "sockets.ts"]);
  });
});
