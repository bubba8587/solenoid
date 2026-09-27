// [[D87]] knapNotes
import { describe, it, expect } from "vitest";
import { renderKnapNote, renderKnapUnits, knapUnits, knapVariables, isKnapNote, bodyStartLine } from "../../obsidian-plugin/src/knapNote";
import { bareTags } from "../../src/graph/knapTemplate";

const NOTE = [
  "---",            // 0
  "knap: true",     // 1
  "qty: 3",         // 2
  "---",            // 3
  "# Order {{ qty }}", // 4
  "",               // 5
  "{% for p in rows %}", // 6
  "- {{ p.item }}", // 7
  "{% endfor %}",   // 8
  "",               // 9
  "{% if qty > 5 %}", // 10
  "",               // 11
  "Big order.",     // 12
  "",               // 13
  "{% endif %}",    // 14
  "",               // 15
  "Plain words, {{ unknown }} kept, {{ grid }} chipped.", // 16
].join("\n");
const VARS = { knap: true, qty: 3, rows: [{ item: "a" }, { item: "b" }], grid: [[1, 2]] };

describe("a knap note renders once and each section takes its share", () => {
  it("fills a tag in place and leaves an untouched line as its source", async () => {
    const r = await renderKnapNote(NOTE, VARS, []);
    expect(r.bodyStart).toBe(4);
    expect(r.slice(4, 4)).toBe("# Order 3");
    expect(r.source(4, 4)).toBe("# Order {{ qty }}");
  });

  it("repeats a loop's lines and drops its tag lines", async () => {
    const r = await renderKnapNote(NOTE, VARS, []);
    expect(r.slice(6, 6).trim()).toBe("");
    expect(r.slice(7, 8).replace(/\n+/g, "\n")).toBe("- a\n- b");
  });

  it("drops a false if across sections", async () => {
    const r = await renderKnapNote(NOTE, VARS, []);
    expect(r.slice(12, 12).trim()).toBe("");
    const big = await renderKnapNote(NOTE, { ...VARS, qty: 9 }, []);
    expect(big.slice(12, 12)).toBe("Big order.");
  });

  it("keeps an unknown tag and turns a chip name into the internal span", async () => {
    const r = await renderKnapNote(NOTE, VARS, ["grid"]);
    expect(r.slice(16, 16)).toBe("Plain words, {{ unknown }} kept, `=grid` chipped.");
  });

  it("leaves a tag that spans lines whole", async () => {
    const r = await renderKnapNote("{{ qty\n}} items", { qty: 2 }, []);
    expect(r.slice(0, 1)).toBe("2 items");
  });

  it("reports an error by note line and column, shows it at the top and leaves the source", async () => {
    const r = await renderKnapNote("---\nknap: true\n---\n\nok\n{{ qty | nosuchfilter }}", { qty: 1 }, []);
    expect(r.error).toBe("6:10 Unknown filter \"nosuchfilter\"");
    expect(r.errorLine).toBe(4);
    expect(r.slice(4, 5)).toBe("ok\n{{ qty | nosuchfilter }}");
  });
});

describe("knap note properties", () => {
  it("switches on only for a true knap property", () => {
    expect(isKnapNote({ knap: true })).toBe(true);
    expect(isKnapNote({ knap: "true" })).toBe(false);
    expect(isKnapNote(null)).toBe(false);
  });

  it("finds the body after the frontmatter", () => {
    expect(bodyStartLine(["# no frontmatter"])).toBe(0);
    expect(bodyStartLine(["---", "a: 1", "---", "body"])).toBe(3);
    expect(bodyStartLine(["---", "unclosed"])).toBe(0);
  });

  it("reads a quoted Knap field as what it renders to", async () => {
    const vars = await knapVariables({ price: 2, qty: 3, total: "{{ price | calc:\"*3\" }}", when: "{{ day }}", day: "2026-09-01" });
    expect(vars.total).toBe(6);
    expect(vars.when).toBe("2026-09-01");
  });
});

describe("bareTags", () => {
  it("finds a bare tag on a named value, not one a loop shadows", () => {
    const body = "{{ a }} {% for a in xs %}{{ a }}{% endfor %} {{ a | upper }}";
    expect(bareTags(body, ["a"])).toEqual([{ name: "a", from: 0, to: 7, highlight: false }]);
  });
});

describe("Live Preview's pieces", () => {
  const body = "Hi {{ name }}, {% set n = 2 %}{{ n }}.\n\n{% for r in rows %}\n- {{ r }}\n{% endfor %}\n\n{% if no %}\nnever\n{% endif %}\n{# note #} {{ grid }} {{ unknown }}";

  it("fences each top-level tag and each block whole", () => {
    expect(knapUnits(body).map((u) => body.slice(u.from, u.to))).toEqual([
      "{{ name }}", "{% set n = 2 %}", "{{ n }}", "{% for r in rows %}\n- {{ r }}\n{% endfor %}",
      "{% if no %}\nnever\n{% endif %}", "{# note #}", "{{ grid }}", "{{ unknown }}",
    ]);
  });

  it("renders each piece with the whole note in scope", async () => {
    const { units, failed } = await renderKnapUnits(body, { name: "Ana", rows: ["a", "b"], no: false, grid: [[1]] }, ["grid"]);
    expect(failed).toBe(false);
    expect(units.map((u) => u.output.trim())).toEqual(["Ana", "", "2", "- a\n- b", "", "", "`=grid`", "{{ unknown }}"]);
  });

  it("gives no pieces when Knap refuses the body", async () => {
    expect(await renderKnapUnits("{{ x | nosuchfilter }}", { x: 1 }, [])).toEqual({ units: [], failed: true });
  });
});
