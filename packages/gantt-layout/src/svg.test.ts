import { describe, it, expect } from "vitest";
import { serialFromCivil } from "./serial";
import { ganttSvg } from "./svg";
import type { GanttPayload } from "./payload";

const S = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

function payload(): GanttPayload {
  return {
    kind: "gantt",
    tasks: [
      { id: "design", name: "Design <phase>", level: 0, summary: false, milestone: false, start: S(2026, 9, 7), finish: S(2026, 9, 11), complete: 50, critical: true, late: false, violated: false, float: 0 },
      { id: "ship", name: "Ship", level: 0, summary: false, milestone: true, start: S(2026, 9, 14), finish: S(2026, 9, 14), complete: 0, critical: true, late: false, violated: false, float: 0 },
    ],
    links: [{ from: "design", to: "ship", type: "FS", lag: 0, critical: true, violated: false }],
    nonWorking: [[S(2026, 9, 12), S(2026, 9, 13)]],
    weekend: [0, 6],
    holidays: [],
    today: S(2026, 9, 10),
    statusDate: null,
    projectStart: S(2026, 9, 7),
    projectFinish: S(2026, 9, 14),
    view: { zoom: "day" },
  };
}

describe("ganttSvg", () => {
  it("returns a standalone, well-formed-ish SVG string", () => {
    const svg = ganttSvg(payload(), { width: 900 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // Balanced enough for a smoke test: every <g opens and closes.
    const opens = (svg.match(/<g[ >]/g) ?? []).length;
    const closes = (svg.match(/<\/g>/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("escapes XML metacharacters in task text", () => {
    const svg = ganttSvg(payload(), { width: 900 });
    expect(svg).toContain("Design &lt;phase&gt;");
    expect(svg).not.toContain("Design <phase>");
  });

  it("draws a today line and a milestone diamond path", () => {
    const svg = ganttSvg(payload(), { width: 900 });
    expect(svg).toMatch(/<line[^>]+stroke="#e06666"/); // default today color
    expect(svg).toContain("<path"); // diamond / bracket / links
  });

  it("honors supplied theme colors for legible export text", () => {
    const svg = ganttSvg(payload(), { width: 900, colors: { text: "#abcdef" } });
    expect(svg).toContain('fill="#abcdef"');
  });
});
