import { describe, it, expect } from "vitest";
import { externalLinkTarget } from "../../src/graph/externalLinks";

const ORIGIN = "http://localhost:1420";

describe("externalLinkTarget", () => {
  it("an off-origin http(s) link opens outside the app", () => {
    expect(externalLinkTarget("https://example.com/a?b=1", ORIGIN)).toBe("https://example.com/a?b=1");
    expect(externalLinkTarget("http://obsidian.md", ORIGIN)).toBe("http://obsidian.md/");
  });
  it("same-origin, hash and relative links stay in-app", () => {
    expect(externalLinkTarget("http://localhost:1420/docs", ORIGIN)).toBeNull();
    expect(externalLinkTarget("#section", ORIGIN)).toBeNull();
    expect(externalLinkTarget("/path", ORIGIN)).toBeNull();
  });
  it("mailto opens outside; other schemes are left alone", () => {
    expect(externalLinkTarget("mailto:a@b.c", ORIGIN)).toBe("mailto:a@b.c");
    expect(externalLinkTarget("obsidian://open?vault=x", ORIGIN)).toBeNull();
    expect(externalLinkTarget("javascript:void(0)", ORIGIN)).toBeNull();
  });
});
