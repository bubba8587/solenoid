import { describe, it, expect } from "vitest";
import {
  hasKnapSyntax, extractKnapVariables, embedBareVariables, toTemplateValue, frameToTemplateRows, renderKnap, renderKnapPages, knapErrorText,
} from "../../src/graph/knapTemplate";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";
import { makeDocument } from "../../src/graph/documentValue";
import { solError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";

const serial = (iso: string) => Math.round(parseDateToSerial(iso));

describe("hasKnapSyntax", () => {
  it("only a `{{` or `{%` tag makes a body a template — the internal ref span does not", () => {
    expect(hasKnapSyntax("plain `=x` text")).toBe(false);
    expect(hasKnapSyntax("{{ x }}")).toBe(true);
    expect(hasKnapSyntax("{% if x %}{% endif %}")).toBe(true);
  });
});

describe("extractKnapVariables", () => {
  it("yields ROOT names in first-use order, de-duplicated", () => {
    expect(extractKnapVariables("{{ b }} {{ a.name }} {{ b | upper }} {{ items[0].x }}")).toEqual(["b", "a", "items"]);
  });
  it("skips the template's own names: for iterators, loop, and set variables", () => {
    const body = "{% set h = title | upper %}{{ h }}{% for row in rows %}{{ row.name }} {{ loop.index }} {{ unit }}{% endfor %}";
    expect(extractKnapVariables(body)).toEqual(["title", "rows", "unit"]);
  });
  it("reads names inside conditions and filter arguments", () => {
    expect(extractKnapVariables("{% if a > b %}{{ c | join:sep }}{% elseif d %}x{% endif %}")).toEqual(["a", "b", "c", "sep", "d"]);
  });
  it("keeps what parsed through a syntax error, so sockets survive a mid-edit body", () => {
    expect(extractKnapVariables("{{ a }} {% if b %}unclosed")).toEqual(["a", "b"]);
  });
  it("a tag-less body has no variables (and never parses)", () => {
    expect(extractKnapVariables("just `=ref` prose")).toEqual([]);
  });
});

describe("embedBareVariables", () => {
  it("rewrites a bare `{{ input }}` to the ref span, `| highlight` to the tinted span, and leaves the rest to Knap", () => {
    const src = "{{ a }} {{b}} {{ a | highlight }} {{ a | upper }} {{ a.x }} {{ local }} {% if a %}{{ a }}{% endif %}";
    expect(embedBareVariables(src, ["a", "b"])).toBe("`=a` `=b` `=a!` {{ a | upper }} {{ a.x }} {{ local }} {% if a %}`=a`{% endif %}");
  });
  it("with no inputs or no tag the body is untouched", () => {
    expect(embedBareVariables("{{ a }}", [])).toBe("{{ a }}");
    expect(embedBareVariables("plain", ["a"])).toBe("plain");
  });
});

describe("toTemplateValue", () => {
  const frame: FrameValue = {
    __frame: true,
    columns: [
      { name: "Name", type: "string", values: ["a", "b"] },
      { name: "When", type: "date", values: [serial("2026-03-01"), null] },
      { name: "N", type: "number", values: [1, solError("#DIV/0!", "x")] },
    ],
  };
  it("a frame becomes rows of {column: value}; date cells read as ISO text, an error cell as its code", () => {
    expect(frameToTemplateRows(frame)).toEqual([
      { Name: "a", When: "2026-03-01", N: 1 },
      { Name: "b", When: null, N: "#DIV/0!" },
    ]);
    expect(toTemplateValue(frame)).toEqual(frameToTemplateRows(frame));
  });
  it("a date serial reads as ISO ONLY when the source socket says date; a bare number stays a number", () => {
    const s = serial("2026-03-01");
    expect(toTemplateValue(s, "date")).toBe("2026-03-01");
    expect(toTemplateValue(s + 0.5, "date")).toBe("2026-03-01T12:00:00");
    expect(toTemplateValue(s, "number")).toBe(s);
    expect(toTemplateValue(s)).toBe(s);
    expect(toTemplateValue([s, null], "datelist")).toEqual(["2026-03-01", null]);
  });
  it("scalars, lists, null and errors pass as plain data", () => {
    expect(toTemplateValue("t")).toBe("t");
    expect(toTemplateValue(true)).toBe(true);
    expect(toTemplateValue(undefined)).toBe(null);
    expect(toTemplateValue([1, "x"])).toEqual([1, "x"]);
    expect(toTemplateValue(solError("#N/A", "m"))).toBe("#N/A");
  });
  it("a wired document reads as its body; a chart has no data form", () => {
    expect(toTemplateValue(makeDocument("## How"))).toBe("## How");
    expect(toTemplateValue({ __chart: true })).toBe(null);
  });
});

describe("renderKnap", () => {
  it("renders variables, filters, loops and conditions to markdown", async () => {
    const r = await renderKnap(
      "# {{ title | upper }}\n{% for r in rows %}- {{ r.Name }}: {{ r.When | date:\"DD MMM YYYY\" }}\n{% endfor %}{% if none %}never{% endif %}",
      { title: "Report", rows: [{ Name: "a", When: "2026-03-01" }] },
    );
    expect(r.errors).toEqual([]);
    // Knap drops the newline that follows a block tag.
    expect(r.output).toBe("# REPORT\n- a: 01 Mar 2026");
  });
  it("a tag-less body passes through untouched (no engine call)", async () => {
    const r = await renderKnap("plain `=x`", {});
    expect(r).toEqual({ output: "plain `=x`", errors: [] });
  });
  it("the internal ref span survives the render as text (the ref path resolves it later)", async () => {
    const r = await renderKnap("{{ a }} and `=chart`", { a: 1 });
    expect(r.output).toBe("1 and `=chart`");
  });
  it("a broken template reports line:column errors and no output", async () => {
    const r = await renderKnap("ok\n{% if x %}", {});
    expect(r.output).toBe("");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(knapErrorText(r.errors)).toMatch(/^2:\d+ .*endif/);
  });
});

describe("renderKnap keepUnknown (a Note's mode)", () => {
  it("a bare tag naming no variable stays literal; known ones render; logic on unknowns is Knap's", async () => {
    const r = await renderKnap("# {{ title }} for {{ person }}{% if person %} yes{% endif %} {{ person | upper }}", { title: "T" }, { keepUnknown: true });
    expect(r.output).toBe("# T for {{ person }}"); // the endif eats the space after it
  });
});

describe("renderKnapPages", () => {
  it("one page per row with row and index; the name template names it, blank → the index", async () => {
    const r = await renderKnapPages("{{ index }}: {{ row.n }} of {{ total }}", { total: 2 }, [{ n: "a" }, { n: "b" }], "{{ row.n }}-page");
    expect(r.errors).toEqual([]);
    expect(r.pages).toEqual([{ name: "a-page", body: "1: a of 2" }, { name: "b-page", body: "2: b of 2" }]);
    expect((await renderKnapPages("x", {}, [{}, {}], "")).pages.map((p) => p.name)).toEqual(["1", "2"]);
  });
  it("a broken template stops the batch with its errors", async () => {
    const r = await renderKnapPages("{% if x %}", {}, [{}], "");
    expect(r.pages).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
