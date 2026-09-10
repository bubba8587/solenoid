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
    const n = new ReportNode({ body: "{% set h = title | upper %}{{ h }}{% for r in items %}{{ r.x }} {{ loop.index }}{% endfor %}" });
    expect(n.refKeys()).toEqual(["title", "items"]);
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
    const n = new ReportNode({ body: "{% for r in ledger %}- {{ r.Name }} ({{ r.N }})\n{% endfor %}{{ ledger }} {{ note | upper }}" });
    const ledger = { __frame: true, columns: [
      { name: "Name", type: "string", values: ["a", "b"] },
      { name: "N", type: "number", values: [1, 2] },
    ] };
    const out = await n.data({ ledger: [ledger], note: [{ __document: true, body: "how", refs: {} }] });
    expect(body(out)).toBe("- a (1)\n- b (2)`=ledger` HOW"); // Knap eats the newline after endfor
    expect(n.templateVars).toEqual({ ledger: [{ Name: "a", N: 1 }, { Name: "b", N: 2 }], note: "how" });
  });

  it("a filter other than highlight is not bare: Knap prints the data form", async () => {
    const n = new ReportNode({ body: "{{ total | round }}" });
    expect(body(await n.data({ total: [42.4] }))).toBe("42");
  });

  it("a broken template emits #SYNTAX! with the line and column", async () => {
    const n = new ReportNode({ body: "x\n{% for r in items %}" });
    const out = await n.data({ items: [[]] });
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

describe("ReportNode — a wired template Note", () => {
  const tpl = (body: string) => ({ __document: true, body: "rendered", refs: {}, source: body }) as const;

  it("the template's variables become the inputs (persisted as sideVars); the body's are set aside", async () => {
    const n = new ReportNode({ body: "{{ own }}" });
    expect(n.refKeys()).toEqual(["own"]);
    const out = await n.data({ template: [tpl("Dear {{ person }}, {{ amount | number_format:2 }}")], person: ["Ada"], amount: [12.5] });
    expect(n.refKeys()).toEqual(["person", "amount"]);
    expect(n.sideVars).toEqual(["person", "amount"]);
    expect(n.activeSource()).toBe("Dear {{ person }}, {{ amount | number_format:2 }}");
    expect(body(out)).toBe("Dear `=person`, 12.50");
    // Unwired again: the body's own variables come back and sideVars clears.
    n.data({ own: [1] });
    expect(n.refKeys()).toEqual(["own"]);
    expect(n.sideVars).toEqual([]);
  });

  it("a saved sideVars list mints its sockets at construction, before the first compute", () => {
    const n = new ReportNode({ body: "", sideVars: ["person"] });
    expect(n.inputs.person?.socket.name).toBe("trueany");
  });

  it("an input left unwired falls back to the template note's own frontmatter field", async () => {
    const n = new ReportNode();
    const out = await n.data({ template: [tpl("---\ntitle: Weekly\nn: 3\n---\n# {{ title }} x{{ n | round }} {{ person }}")] , person: ["Ada"] });
    expect(n.refKeys()).toEqual(["title", "n", "person"]);
    expect(n.refValue("title")).toBe("Weekly");
    expect(body(out)).toBe("---\ntitle: Weekly\nn: 3\n---\n# `=title` x3 `=person`");
  });

  it("`template` is itself a name: bare embeds the note, filtered reads its source", async () => {
    const n = new ReportNode();
    const out = await n.data({ template: [tpl("{{ template | length }} {{ template }}")] });
    expect(body(out)).toBe("38 `=template`");
    expect((out.document as DocumentValue).refs.template).toEqual(tpl("{{ template | length }} {{ template }}"));
  });
});

describe("ReportNode — rows: one page per row", () => {
  const people = { __frame: true, columns: [
    { name: "Name", type: "string", values: ["Ada", "Bob"] },
    { name: "Owed", type: "number", values: [10, 0] },
  ] };

  it("renders the template once per row with `row` and `index`, names each page, joins the body", async () => {
    const n = new ReportNode({ body: "# {{ row.Name }}\n{% if row.Owed > 0 %}Pay {{ row.Owed }} to {{ treasurer }}{% else %}Settled{% endif %} ({{ index }}/{{ rows | length }})", pageName: "{{ row.Name | upper }}" });
    const out = await n.data({ rows: [people], treasurer: ["Cy"] });
    const doc = out.document as DocumentValue;
    expect(doc.pages).toEqual([
      { name: "ADA", body: "# Ada\nPay 10 to `=treasurer` (1/2)" },
      { name: "BOB", body: "# Bob\nSettled (2/2)" },
    ]);
    expect(doc.body).toBe("# Ada\nPay 10 to `=treasurer` (1/2)\n\n---\n\n# Bob\nSettled (2/2)");
    expect(n.pages).toEqual(doc.pages);
    expect(n.rows).toEqual([{ Name: "Ada", Owed: 10 }, { Name: "Bob", Owed: 0 }]);
  });

  it("a blank page name numbers the pages; a bare `{{ rows }}` embeds the whole frame", async () => {
    const n = new ReportNode({ body: "{{ row.Name }} of {{ rows }}" });
    const doc = (await n.data({ rows: [people] })).document as DocumentValue;
    expect(doc.pages?.map((p) => p.name)).toEqual(["1", "2"]);
    expect(doc.pages?.[0].body).toBe("Ada of `=rows`");
    expect(doc.refs.rows).toBe(people);
  });

  it("no rows wired → no pages, a single document", async () => {
    const n = new ReportNode({ body: "plain" });
    const doc = (n.data({}) as { document: DocumentValue }).document;
    expect(doc.pages).toBeUndefined();
    expect(n.pages).toBeNull();
  });
});
