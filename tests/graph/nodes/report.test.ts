import { describe, it, expect } from "vitest";
import { ReportNode } from "../../../src/graph/nodes/report";
import { installErrorGuards, isSolError, type SolError } from "../../../src/graph/errorValue";
import { isDocumentValue, type DocumentValue } from "../../../src/graph/documentValue";

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

describe("ReportNode — Knap template body", () => {
  it("a `{{ name }}` variable mints an input like a ref does; a name used both ways is ONE socket", () => {
    const n = new ReportNode({ body: "`=total` then {{ total | number_format:2 }} and {% for r in rows %}{{ r.x }}{% endfor %}" });
    expect(n.refKeys()).toEqual(["total", "rows"]);
    expect(n.inputs.rows?.socket.name).toBe("trueany");
  });

  it("a tag-less body computes synchronously, the body untouched", () => {
    const n = new ReportNode({ body: "Total: `=total`." });
    const out = n.data({ total: [42] });
    expect(out instanceof Promise).toBe(false);
    expect((out as { document: { body: string } }).document.body).toBe("Total: `=total`.");
  });

  it("a templated body renders at compute: frames loop as rows, refs survive as text", async () => {
    const n = new ReportNode({ body: "{% for r in rows %}- {{ r.Name }} ({{ r.N }})\n{% endfor %}see `=chart`" });
    const rows = { __frame: true, columns: [
      { name: "Name", type: "string", values: ["a", "b"] },
      { name: "N", type: "number", values: [1, 2] },
    ] };
    const out = await n.data({ rows: [rows], chart: [{ __chart: true }] });
    expect(isDocumentValue(out.document)).toBe(true);
    expect((out.document as DocumentValue).body).toBe("- a (1)\n- b (2)see `=chart`"); // Knap eats the newline after endfor
    expect((out.document as DocumentValue).refs.chart).toEqual({ __chart: true });
    expect(n.templateVars).toEqual({ rows: [{ Name: "a", N: 1 }, { Name: "b", N: 2 }], chart: null });
  });

  it("a broken template emits #SYNTAX! with the line and column", async () => {
    const n = new ReportNode({ body: "x\n{% for r in rows %}" });
    const out = await n.data({ rows: [[]] });
    expect(isSolError(out.document)).toBe(true);
    expect((out.document as SolError).code).toBe("#SYNTAX!");
    expect((out.document as SolError).message).toMatch(/^2:/);
  });
});
