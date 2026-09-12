import { describe, it, expect } from "vitest";
import { renderKnap, embedBareVariables, renderKnapPages } from "../../src/graph/knapTemplate";

describe("Knap template locals are the template's own", () => {
  it("a Note's loop iterator, loop and set names render, never park as unknown tags", async () => {
    const body = "{% for t in tags %}[{{ t }}]{% endfor %} {% set y = 1 %}{{ y }} {% for t in tags %}{{ loop.index }}{% endfor %} {{ missing }}";
    const r = await renderKnap(body, { tags: ["a", "b"] }, { keepUnknown: true });
    expect(r.errors).toEqual([]);
    expect(r.output.replace(/\s+/g, "")).toBe("[a][b]112{{missing}}"); // knap adds loop newlines
  });

  it("a loop iterator that shares a wired name is not rewritten to the wired embed inside its loop", () => {
    const body = "{{ item }}|{% for item in list %}{{ item }}{% endfor %}|{{ item | highlight }}";
    expect(embedBareVariables(body, ["item", "list"])).toBe("`=item`|{% for item in list %}{{ item }}{% endfor %}|`=item!`");
  });

  it("two records that render one page name get distinct names", async () => {
    const r = await renderKnapPages("{{ record.n }}", {}, [{ n: "A" }, { n: "a" }, { n: "B" }], "{{ record.n }}");
    expect(r.errors).toEqual([]);
    expect(r.pages.map((p) => p.name)).toEqual(["A", "a (2)", "B"]);
  });
});

describe("SEQUENCE rank reconcile", () => {
  it("a wired blank or an empty result keeps the 2-D socket rank", async () => {
    const { SeriesNode } = await import("../../src/graph/nodes/list");
    const n = new SeriesNode({ op: "sequence" }) as unknown as { data: (i: Record<string, unknown[]>) => unknown; lastRank: number; literals: Record<string, number> };
    n.literals.count = 2; n.literals.cols = 2;
    n.data({});
    expect(n.lastRank).toBe(2);
    n.data({ count: [null] });
    expect(n.lastRank).toBe(2);
    n.data({ count: [0] });
    expect(n.lastRank).toBe(2);
  });
});
