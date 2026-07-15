import { describe, it, expect } from "vitest";
import {
  frontmatterToYaml, yamlScalar, frameToMarkdownTable, mermaidToMarkdown, mathToMarkdown, valueToObsidianBlock,
} from "./obsidianMarkdown";
import { buildFrame } from "./frame";
import { type MermaidValue } from "./mermaidValue";

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
