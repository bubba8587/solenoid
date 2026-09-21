// [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("obsidian-plugin/src/look.css", "utf8");

describe("the Solenoid look has one source", () => {
  it("the demo vault's snippet is that file as it stands (npm run plugin:build writes it)", () => {
    expect(readFileSync("demo-vault/.obsidian/snippets/solenoid.css", "utf8")).toBe(source);
  });

  it("never draws a side stripe (DESIGN.md: tint the element itself)", () => {
    expect(source).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:\s*[^;]*solid\s+var\(--sol-(accent|number)/);
    expect(source).toMatch(/--blockquote-border-thickness:\s*0px/);
  });
});
