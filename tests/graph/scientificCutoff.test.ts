// [[D94]] oneNumberDisplay
import { describe, it, expect, afterEach } from "vitest";
import { formatScalar } from "../../src/graph/components/format";
import { settingsStore } from "../../src/graph/settingsStore";
import { formatAnnotationStore } from "../../src/graph/formatAnnotationStore";

afterEach(() => settingsStore.set("sciAbove", "9"));

describe("the Scientific from setting", () => {
  it("defaults to a billion", () => {
    expect(formatScalar(999_999_999)).toBe("999999999");
    expect(formatScalar(1_234_567_890)).toBe("1.2346e+9");
  });
  it("moves the cutoff, or turns it off", () => {
    settingsStore.set("sciAbove", "6");
    expect(formatScalar(2_500_000)).toBe("2.5e+6");
    settingsStore.set("sciAbove", "12");
    expect(formatScalar(1_234_567_890)).toBe("1234567890");
    settingsStore.set("sciAbove", "off");
    expect(formatScalar(1e20)).toBe("100000000000000000000");
  });
  it("redraws every value box when it changes", () => {
    const before = formatAnnotationStore.version();
    settingsStore.set("sciAbove", "6");
    expect(formatAnnotationStore.version()).not.toBe(before);
  });
});
