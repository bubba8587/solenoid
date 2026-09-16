import { describe, it, expect } from "vitest";
import { touches, watchVaultFolder } from "../../src/graph/vaultWatch";

describe("vaultWatch (bundle E)", () => {
  it("touches: matches the note's absolute path across slash styles and case", () => {
    expect(touches(["C:/v/Notes/Deep Work.md"], "C:/v/", "Notes/Deep Work.md")).toBe(true);
    expect(touches(["C:\\v\\Notes\\deep work.md"], "C:/v", "Notes/Deep Work.md")).toBe(true);
    expect(touches(["C:/v/Notes/Other.md"], "C:/v", "Notes/Deep Work.md")).toBe(false);
  });
  it("off desktop the watcher is a no-op that still returns an unwatch", async () => {
    const un = await watchVaultFolder("C:/v", "Notes", () => {});
    expect(typeof un).toBe("function");
    un();
  });
});
