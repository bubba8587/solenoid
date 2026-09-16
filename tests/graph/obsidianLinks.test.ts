import { describe, it, expect } from "vitest";
import { vaultName, obsidianFileParam, obsidianOpenUrl } from "../../src/graph/obsidianLinks";

describe("obsidianOpenUrl (bundle D)", () => {
  it("vault = the folder's base name; file = vault-relative, forward slashes, no .md", () => {
    expect(vaultName("C:\\Users\\me\\Vaults\\Second Brain\\")).toBe("Second Brain");
    expect(vaultName("/home/me/vault")).toBe("vault");
    expect(obsidianFileParam("Projects\\Website launch.md")).toBe("Projects/Website launch");
    expect(obsidianFileParam("/Daily/2026-09-07.md")).toBe("Daily/2026-09-07");
  });
  it("builds the encoded URI; blank vault or file → null", () => {
    expect(obsidianOpenUrl("C:/v/Second Brain", "Projects/Website launch.md"))
      .toBe("obsidian://open?vault=Second%20Brain&file=Projects%2FWebsite%20launch");
    expect(obsidianOpenUrl("", "a.md")).toBeNull();
    expect(obsidianOpenUrl("C:/v", "")).toBeNull();
  });
});
