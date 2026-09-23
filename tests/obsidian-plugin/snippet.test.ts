// [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { defaultLookCss } from "../../obsidian-plugin/src/lookTokens";

describe("the demo vault's snippet", () => {
  it("is exactly what the plugin build writes, so a build leaves the tree clean", () => {
    const look = readFileSync("obsidian-plugin/src/look.css", "utf8");
    const snippet = readFileSync("demo-vault/.obsidian/snippets/solenoid.css", "utf8");
    expect(snippet).toBe(look + defaultLookCss());
  });
});
