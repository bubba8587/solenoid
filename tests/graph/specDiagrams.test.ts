// [[A1]] visualGraphCalculator
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { render } from "pele";

// The specs draw their mechanisms as Mermaid blocks, plain text Obsidian renders with pele, the renderer
// MermaidView uses. Every block under tree/ and docs/ must render, and none may hold a `[[`, which
// tools/dte.py would read as a citation.

const ROOT = path.resolve(__dirname, "../..");

function mdFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "archive" ? [] : mdFiles(p);
    return e.name.endsWith(".md") ? [p] : [];
  });
}

const files = [...mdFiles(path.join(ROOT, "tree")), ...mdFiles(path.join(ROOT, "docs"))];

const blocks = files.flatMap((f) =>
  [...fs.readFileSync(f, "utf8").matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m, i) => ({
    at: `${path.relative(ROOT, f)}#${i}`,
    src: m[1],
  })),
);

describe("spec diagrams", () => {
  it("the specs have diagrams", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("every Mermaid block renders with pele", () => {
    const bad = blocks.flatMap(({ at, src }) => {
      try {
        render(src);
        return [];
      } catch (e) {
        return [`${at}: ${(e as Error).message.split("\n")[0]}`];
      }
    });
    expect(bad).toEqual([]);
  });

  it("no Mermaid block holds a wikilink", () => {
    expect(blocks.filter((b) => b.src.includes("[[")).map((b) => b.at)).toEqual([]);
  });

  it("a Mermaid block starts after a blank line, so it never runs on from a paragraph", () => {
    const bad = files.flatMap((f) => {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      return lines.flatMap((l, i) =>
        /^\s*```mermaid/.test(l) && i > 0 && lines[i - 1].trim() !== "" ? [`${path.relative(ROOT, f)}:${i + 1}`] : [],
      );
    });
    expect(bad).toEqual([]);
  });

  // pele reads a `;` outside quotes as a line break, so a state or mindmap label holding one renders as stray
  // boxes with no parse error.
  it("no Mermaid block has a semicolon outside quotes", () => {
    const bad = blocks.filter((b) => b.src.split("\n").some((l) => l.replace(/"[^"]*"/g, "").includes(";")));
    expect(bad.map((b) => b.at)).toEqual([]);
  });
});
