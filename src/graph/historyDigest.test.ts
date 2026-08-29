import { describe, it, expect } from "vitest";
import { digestLabeled } from "./historyDigest";

describe("digestLabeled", () => {
  it("prints one line per record under a date header, newest first", () => {
    const t = new Date(2026, 7, 26, 14, 30, 5).getTime();
    const out = digestLabeled([
      { time: t, label: "Added node: rate" },
      { time: t + 60_000, label: "Connected rate → total" },
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^— .*2026 —$/);
    expect(lines[1]).toMatch(/Connected rate → total$/);
    expect(lines[2]).toMatch(/Added node: rate$/);
  });

  it("inserts a new date header when records span days", () => {
    const d1 = new Date(2026, 7, 25, 23, 59).getTime();
    const d2 = new Date(2026, 7, 26, 0, 1).getTime();
    const out = digestLabeled([
      { time: d1, label: "A" },
      { time: d2, label: "B" },
    ]);
    expect(out.split("\n").filter((l) => l.startsWith("—"))).toHaveLength(2);
  });
});
