// [[C114]] cardsView
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { helpSection } from "../../src/graph/helpSection";

describe("helpSection", () => {
  it("takes one ## section, heading included, up to the next", () => {
    const md = "# Doc\n\nintro\n\n## A\n\none\n\n## B\n\ntwo\n";
    expect(helpSection(md, "A")).toBe("## A\n\none");
    expect(helpSection(md, "B")).toBe("## B\n\ntwo");
    expect(helpSection(md, "C")).toBe("");
  });

  it("finds the Cards section the popup's card-rules button shows", () => {
    const help = readFileSync(new URL("../../src/graph/help/help.md", import.meta.url), "utf8");
    const cards = helpSection(help, "Cards");
    expect(cards.startsWith("## Cards")).toBe(true);
    expect(cards).toContain("| Headline |");
  });
});
