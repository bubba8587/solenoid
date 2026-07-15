import { describe, it, expect } from "vitest";
import {
  frontmatterToYaml, yamlScalar, frameToMarkdownTable, mermaidToMarkdown, mathToMarkdown, valueToObsidianBlock,
  assembleDocumentMarkdown,
} from "./obsidianMarkdown";
import { buildFrame } from "./frame";
import { type MermaidValue } from "./mermaidValue";
import { makeDocument } from "./documentValue";

describe("frontmatterToYaml", () => {
  it("emits a --- fenced block; numbers/booleans bare, order preserved", () => {
    expect(frontmatterToYaml({ title: "Weekly", count: 3, done: true })).toBe(
      '---\ntitle: Weekly\ncount: 3\ndone: true\n---\n',
    );
  });
  it("quotes only ambiguous strings (leading space, colon, number-like, keyword, empty)", () => {
    expect(yamlScalar("clean text")).toBe("clean text");
    expect(yamlScalar(" leading")).toBe('" leading"');
    expect(yamlScalar("a: b")).toBe('"a: b"');
    expect(yamlScalar("2026-01-01")).toBe('"2026-01-01"'); // number-like → quoted so it stays a string
    expect(yamlScalar("true")).toBe('"true"');
    expect(yamlScalar("")).toBe('""');
  });
  it("a multi-line / tabbed string is quoted with the newline escaped (stays valid one-line YAML)", () => {
    // The bug this guards: a raw newline spliced into a flow scalar corrupts the
    // whole --- block (the second line reads as new YAML). Escape it instead.
    expect(yamlScalar("line1\nline2")).toBe('"line1\\nline2"');
    expect(yamlScalar("a\tb")).toBe('"a\\tb"');
    expect(yamlScalar('has "quote"\nand nl')).toBe('"has \\"quote\\"\\nand nl"');
    // A lone backslash in a PLAIN scalar is literal → stays unquoted; but once a
    // value is quoted for another reason (here a newline), the backslash escapes too.
    expect(yamlScalar("back\\slash")).toBe("back\\slash");
    expect(yamlScalar("back\\slash\nnl")).toBe('"back\\\\slash\\nnl"');
    // the emitted block is a single line per key — no stray newline splices in
    expect(frontmatterToYaml({ notes: "one\ntwo" })).toBe('---\nnotes: "one\\ntwo"\n---\n');
  });
  it("renders a list as a YAML block sequence", () => {
    expect(frontmatterToYaml({ tags: ["finance", "q3"] })).toBe(
      "---\ntags:\n  - finance\n  - q3\n---\n",
    );
    expect(frontmatterToYaml({ tags: [] })).toBe("---\ntags: []\n---\n");
  });
  it("empty record → empty string (no fence)", () => {
    expect(frontmatterToYaml({})).toBe("");
  });
});

describe("frameToMarkdownTable", () => {
  it("emits a GitHub-flavored pipe table with a header + separator", () => {
    const f = buildFrame([[1, 2], [3, 4]], ["a", "b"]);
    expect(frameToMarkdownTable(f)).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |",
    );
  });
  it("escapes a pipe in a cell / header so the table stays intact", () => {
    const f = buildFrame([[1]], ["a|b"]);
    expect(frameToMarkdownTable(f)).toContain("a\\|b");
  });
});

describe("mermaid / math", () => {
  it("mermaid → a fenced ```mermaid block from the source", () => {
    const m: MermaidValue = { __mermaid: true, source: "graph TD; A-->B" };
    expect(mermaidToMarkdown(m)).toBe("```mermaid\ngraph TD; A-->B\n```");
  });
  it("math → a $$ display block", () => {
    expect(mathToMarkdown("E = mc^2")).toBe("$$\nE = mc^2\n$$");
  });
});

describe("valueToObsidianBlock — kind dispatch", () => {
  it("frame → a markdown table; mermaid → markdown; a chart is deferred to Run", () => {
    expect(valueToObsidianBlock(buildFrame([[1]], ["x"])).kind).toBe("md");
    expect(valueToObsidianBlock({ __mermaid: true, source: "pie" } as MermaidValue)).toEqual({
      kind: "md",
      md: "```mermaid\npie\n```",
    });
    const chart = valueToObsidianBlock({ __chart: true, kind: "line" });
    expect(chart.kind).toBe("chart");
    // a plain scalar falls back to its string form
    expect(valueToObsidianBlock(42)).toEqual({ kind: "md", md: "42" });
  });
});

describe("assembleDocumentMarkdown — the walk", () => {
  it("prepends a Note's frontmatter to its body (no refs)", async () => {
    const doc = makeDocument("# Heading\n\nBody text.", {}, { title: "Weekly", done: true });
    const md = await assembleDocumentMarkdown(doc, (_n, v) => String(v));
    expect(md).toBe("---\ntitle: Weekly\ndone: true\n---\n# Heading\n\nBody text.");
  });

  it("substitutes every `=name` span (all occurrences) via the resolver", async () => {
    const doc = makeDocument("Revenue `=rev`, again `=rev`, and `=cost`.", { rev: 100, cost: 40 });
    const md = await assembleDocumentMarkdown(doc, (name, v) => `[${name}=${String(v)}]`);
    expect(md).toBe("Revenue [rev=100], again [rev=100], and [cost=40].");
  });

  it("awaits an async resolver (a chart/image write) and leaves `![[Note]]` intact", async () => {
    const doc = makeDocument("Chart: `=fig`\n\n![[Other Note]]", { fig: { __chart: true } });
    const md = await assembleDocumentMarkdown(doc, async (name) => `![[${name}.png]]`);
    expect(md).toBe("Chart: ![[fig.png]]\n\n![[Other Note]]");
  });

  it("an unresolved ref (empty result) drops the span", async () => {
    const doc = makeDocument("a `=x` b", {});
    expect(await assembleDocumentMarkdown(doc, () => "")).toBe("a  b");
  });
});
