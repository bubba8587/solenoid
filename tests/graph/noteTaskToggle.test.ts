// [[B1]] obsidianBet
import { describe, it, expect } from "vitest";
import { toggleTaskMarker } from "../../src/graph/noteMarkdown";

describe("toggleTaskMarker — the Nth rendered checkbox ticks its own line", () => {
  it("an ordered-list task counts", () => {
    const body = "1. [ ] a\n\n- [ ] b";
    expect(toggleTaskMarker(body, 0)).toBe("1. [x] a\n\n- [ ] b");
    expect(toggleTaskMarker(body, 1)).toBe("1. [ ] a\n\n- [x] b");
  });
  it("a task inside a blockquote counts", () => {
    const body = "> - [ ] q\n\n- [ ] b";
    expect(toggleTaskMarker(body, 0)).toBe("> - [x] q\n\n- [ ] b");
    expect(toggleTaskMarker(body, 1)).toBe("> - [ ] q\n\n- [x] b");
  });
  it("a bare marker with nothing after it renders no box and is not counted", () => {
    expect(toggleTaskMarker("* [ ]\n- [ ] b", 0)).toBe("* [ ]\n- [x] b");
  });
  it("frontmatter and code are skipped; a checked box unticks", () => {
    const body = "---\nk: \"- [ ] no\"\n---\n```\n- [ ] code\n```\n\n    - [ ] indented code\n\n- [X] done";
    expect(toggleTaskMarker(body, 0)).toBe(body.replace("- [X] done", "- [ ] done"));
  });
  it("a click on a box the source did not produce changes nothing", () => {
    expect(toggleTaskMarker("- [ ] a", 3)).toBe("- [ ] a");
  });
});
