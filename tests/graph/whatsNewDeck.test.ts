// [[A1]] visualGraphCalculator
// The What's New deck combines the newest x.y with its patch releases, newest first, and a new x.y starts over.
import { describe, expect, it } from "vitest";
import { RELEASES, SLIDES, WHATS_NEW_TITLE, WHATS_NEW_VERSION, deckReleases, versionsLabel, type ReleaseSlides } from "../../src/graph/whatsNewSlides";
import { NEXT_RELEASE, compareRelease } from "../../src/graph/release";

const r = (version: ReleaseSlides["version"]): ReleaseSlides => ({ version, slides: [{ title: version, body: "" }] });

describe("What's New deck", () => {
  it("shows the newest x.y with its patches, newest first", () => {
    expect(deckReleases([r("1.6.1"), r("1.6"), r("1.5")]).map((x) => x.version)).toEqual(["1.6.1", "1.6"]);
    expect(deckReleases([r("1.6"), r("1.6.2"), r("1.6.1")]).map((x) => x.version)).toEqual(["1.6.2", "1.6.1", "1.6"]);
  });

  it("starts over at a new x.y", () => {
    expect(deckReleases([r("1.7"), r("1.6.1"), r("1.6")]).map((x) => x.version)).toEqual(["1.7"]);
  });

  it("names the versions oldest first", () => {
    expect(versionsLabel(["1.6"])).toBe("1.6");
    expect(versionsLabel(["1.6.1", "1.6"])).toBe("1.6 and 1.6.1");
    expect(versionsLabel(["1.6.2", "1.6", "1.6.1"])).toBe("1.6, 1.6.1 and 1.6.2");
  });

  it("the shipped deck is coherent", () => {
    expect(SLIDES[0].version).toBe(WHATS_NEW_VERSION);
    expect(WHATS_NEW_TITLE.startsWith("What's new in ")).toBe(true);
    for (const rel of RELEASES) expect(rel.slides.length).toBeGreaterThan(0);
    // A deck for a release not yet cut would show unreleased work: no slides past the next release.
    for (const rel of RELEASES) expect(compareRelease(rel.version, NEXT_RELEASE)).toBeLessThanOrEqual(0);
  });
});
