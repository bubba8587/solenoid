import { describe, it, expect } from "vitest";
import { ReportNode } from "../../../src/graph/nodes/report";
import { installErrorGuards, isSolError, type SolError } from "../../../src/graph/errorValue";
import { isDocumentValue, type DocumentValue } from "../../../src/graph/documentValue";

const body = (out: { document: DocumentValue | SolError }) => (out.document as DocumentValue).body;

describe("ReportNode — inputs from the template", () => {
  it("mints a `trueany` INPUT per root variable, first-use order; a name used twice is ONE socket", () => {
    const n = new ReportNode({ body: "Revenue was {{ revenue }}, up from {{ lastRevenue | number_format:0 }}; {{ revenue | round }}." });
    expect(n.refKeys()).toEqual(["revenue", "lastRevenue"]);
    expect(n.inputs.revenue?.socket.name).toBe("trueany");
    expect(n.inputs.lastRevenue?.socket.name).toBe("trueany");
  });

  it("loop iterators and set locals are the template's own — no socket", () => {
    const n = new ReportNode({ body: "{% set h = title | upper %}{{ h }}{% for r in rows %}{{ r.x }} {{ loop.index }}{% endfor %}" });
    expect(n.refKeys()).toEqual(["title", "rows"]);
  });

  it("syncRefs reports a vanished variable as removedInputs", () => {
    const n = new ReportNode({ body: "{{ a }} and {{ b }}." });
    n.body = "just {{ a }} now.";
    const { removedInputs } = n.syncRefs();
    expect(removedInputs).toEqual(["b"]);
    expect(n.refKeys()).toEqual(["a"]);
    expect(n.inputs.b).toBeUndefined();
  });

  it("data(inputs) caches the resolved input value", () => {
    const n = new ReportNode({ body: "Total: {{ total }}." });
    n.data({ total: [42] });
    expect(n.refValue("total")).toBe(42);
  });

  it("is safe to call the installErrorGuards-wrapped data() with no inputs (independent lanes)", () => {
    const n = new ReportNode({ body: "{{ x }}" });
    installErrorGuards(n);
    expect(() => (n.data as () => unknown)()).not.toThrow();
  });
});

describe("ReportNode — bare `{{ name }}` embeds by kind, anything else reads data", () => {
  it("a bare tag rewrites to the internal ref span and the document carries the wired value under it", () => {
    const n = new ReportNode({ body: "Total **{{ total }}** and {{ chart }}; {{total|highlight}}" });
    expect(n.templateSource()).toBe("Total **`=total`** and `=chart`; `=total!`");
    const out = n.data({ total: [42], chart: [{ __chart: true }] });
    expect(out instanceof Promise).toBe(false); // nothing left for the engine: synchronous
    const doc = (out as { document: DocumentValue }).document;
    expect(isDocumentValue(doc)).toBe(true);
    expect(doc.body).toBe("Total **`=total`** and `=chart`; `=total!`");
    expect(doc.refs).toEqual({ total: 42, chart: { __chart: true } });
  });

  it("a wired Note embeds whole through the same bare tag (a document IS a value)", () => {
    const n = new ReportNode({ body: "{{ Methodology }}" });
    const doc = { __document: true, body: "## How", refs: {} };
    const out = n.data({ Methodology: [doc] }) as { document: DocumentValue };
    expect(out.document.body).toBe("`=Methodology`");
    expect(out.document.refs.Methodology).toBe(doc);
  });

  it("a filtered or looped name reads the DATA form: frames as rows, a document as its body", async () => {
    const n = new ReportNode({ body: "{% for r in rows %}- {{ r.Name }} ({{ r.N }})\n{% endfor %}{{ rows }} {{ note | upper }}" });
    const rows = { __frame: true, columns: [
      { name: "Name", type: "string", values: ["a", "b"] },
      { name: "N", type: "number", values: [1, 2] },
    ] };
    const out = await n.data({ rows: [rows], note: [{ __document: true, body: "how", refs: {} }] });
    expect(body(out)).toBe("- a (1)\n- b (2)`=rows` HOW"); // Knap eats the newline after endfor
    expect(n.templateVars).toEqual({ rows: [{ Name: "a", N: 1 }, { Name: "b", N: 2 }], note: "how" });
  });

  it("a filter other than highlight is not bare: Knap prints the data form", async () => {
    const n = new ReportNode({ body: "{{ total | round }}" });
    expect(body(await n.data({ total: [42.4] }))).toBe("42");
  });

  it("a broken template emits #SYNTAX! with the line and column", async () => {
    const n = new ReportNode({ body: "x\n{% for r in rows %}" });
    const out = await n.data({ rows: [[]] });
    expect(isSolError(out.document)).toBe(true);
    expect((out.document as SolError).code).toBe("#SYNTAX!");
    expect((out.document as SolError).message).toMatch(/^2:/);
  });

  it("renderedBody() renders against the last compute's variables (the export path)", async () => {
    const n = new ReportNode({ body: "{{ n | number_format:2 }} {{ n }}" });
    await n.data({ n: [1234.5] });
    expect(await n.renderedBody()).toBe("1,234.50 `=n`");
  });
});
