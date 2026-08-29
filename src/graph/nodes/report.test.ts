import { describe, it, expect } from "vitest";
import { ReportNode } from "./report";
import { installErrorGuards } from "../errorValue";

describe("ReportNode", () => {
  it("mints an `any` INPUT socket per distinct `=name` span, source order", () => {
    const n = new ReportNode({ body: "Revenue was `=revenue`, up from `=lastRevenue`." });
    expect(n.refKeys()).toEqual(["revenue", "lastRevenue"]);
    expect(n.inputs.revenue?.socket.name).toBe("trueany");
    expect(n.inputs.lastRevenue?.socket.name).toBe("trueany");
  });

  it("syncRefs reports a vanished ref as removedInputs", () => {
    const n = new ReportNode({ body: "`=a` and `=b`." });
    n.body = "just `=a` now.";
    const { removedInputs } = n.syncRefs();
    expect(removedInputs).toEqual(["b"]);
    expect(n.refKeys()).toEqual(["a"]);
    expect(n.inputs.b).toBeUndefined();
  });

  it("data(inputs) caches the resolved ref value", () => {
    const n = new ReportNode({ body: "Total: `=total`." });
    n.data({ total: [42] });
    expect(n.refValue("total")).toBe(42);
  });

  it("a document-valued ref rides data() like any wired value (a Note embed IS a ref)", () => {
    const n = new ReportNode({ body: "`=Methodology`" });
    const doc = { __document: true, body: "## How", refs: {} };
    n.data({ Methodology: [doc] });
    expect(n.refValue("Methodology")).toBe(doc);
  });

  it("is safe to call the installErrorGuards-wrapped data() with no inputs (independent ref lanes)", () => {
    const n = new ReportNode({ body: "`=x`" });
    installErrorGuards(n);
    expect(() => (n.data as () => unknown)()).not.toThrow();
  });
});
