import { describe, it, expect } from "vitest";
import { escapeMd, freezeInlineRefs, buildExportCss, reportReferencedNodeIds } from "./reportExport";
import { solError } from "./errorValue";

describe("escapeMd", () => {
  it("escapes markdown-special characters", () => {
    expect(escapeMd("the *dev* build")).toBe("the \\*dev\\* build");
    expect(escapeMd("a_b_c")).toBe("a\\_b\\_c");
    expect(escapeMd("[link]")).toBe("\\[link\\]");
    expect(escapeMd("plain text")).toBe("plain text");
  });
});

describe("freezeInlineRefs", () => {
  it("substitutes a `=name` span with its current value, no live editor needed", () => {
    const out = freezeInlineRefs("n1", "Revenue was `=revenue` last quarter.", ["revenue"], () => 4200);
    expect(out).toBe("Revenue was 4200 last quarter.");
  });

  it("substitutes multiple distinct refs", () => {
    const values: Record<string, unknown> = { a: 1, b: "two" };
    const out = freezeInlineRefs("n1", "`=a` and `=b`.", ["a", "b"], (k) => values[k]);
    expect(out).toBe("1 and two.");
  });

  it("leaves a span untouched when its name isn't a known ref key", () => {
    const out = freezeInlineRefs("n1", "Run `=notAKey` here.", [], () => 0);
    expect(out).toBe("Run `=notAKey` here.");
  });

  it("escapes markdown-special characters IN the substituted value", () => {
    const out = freezeInlineRefs("n1", "Name: `=name`", ["name"], () => "under_score");
    expect(out).toBe("Name: under\\_score");
  });

  it("freezes an error value to its #CODE!", () => {
    const err = solError("#DIV/0!", "divide by zero");
    const out = freezeInlineRefs("n1", "`=x`", ["x"], () => err);
    expect(out).toBe("#DIV/0!");
  });

  it("freezes null to the em-dash placeholder", () => {
    const out = freezeInlineRefs("n1", "`=x`", ["x"], () => null);
    expect(out).toBe("—");
  });
});

// Backlog "static export fidelity nits" — the exported Charts section takes only
// report-referenced charts, not every on-canvas chart. The reference set is the
// sources wired directly into the report's ref inputs (plus embedded Notes'),
// computed by this pure helper; captureChartSvgs filters on it.
describe("reportReferencedNodeIds", () => {
  const report = { id: "rep", embeds: ["note1"] };

  it("collects sources wired into the report itself", () => {
    const ids = reportReferencedNodeIds(report, [
      { source: "chartA", target: "rep" },
      { source: "num", target: "rep" },
    ]);
    expect(ids).toEqual(new Set(["chartA", "num"]));
  });

  it("includes sources wired into an embedded note's refs", () => {
    const ids = reportReferencedNodeIds(report, [
      { source: "chartB", target: "note1" },
    ]);
    expect(ids).toEqual(new Set(["chartB"]));
  });

  it("excludes connections elsewhere in the graph (no upstream closure)", () => {
    const ids = reportReferencedNodeIds(report, [
      { source: "chartA", target: "rep" },
      { source: "upstream", target: "chartA" },   // feeds the chart, not the report
      { source: "chartC", target: "otherNode" },  // unrelated
    ]);
    expect(ids).toEqual(new Set(["chartA"]));
  });

  it("is empty for a report with no refs or embeds", () => {
    expect(reportReferencedNodeIds({ id: "rep", embeds: [] }, [])).toEqual(new Set());
  });
});

// Bundle 13 #52 — the export must stay visually IDENTICAL for a document that
// declares no report palette (colors-only branding is opt-in, never a default
// behavior change), and pick up the brand accent once one is declared.
// (buildReportExportHtml itself isn't unit-testable here — it calls DOMPurify,
// which needs a real DOM and this project's vitest env is plain `node`; the
// branding decision lives entirely in buildExportCss, tested directly.)
describe("buildExportCss — colors-only branding", () => {
  it("uses the neutral title/rule color when not branded", () => {
    const css = buildExportCss(false, "#ff6a00");
    expect(css).toContain(".report-export__title { font-size: 26px; font-weight: 700; margin: 0 0 4px; color: #f3f4f5; }");
    expect(css).toContain(".report-export section > h2 { border-bottom: 1px solid #2d2d2d; padding-bottom: 6px; }");
  });

  it("uses the accent for the title + section rule when branded", () => {
    const css = buildExportCss(true, "#ff6a00");
    expect(css).toContain(".report-export__title { font-size: 26px; font-weight: 700; margin: 0 0 4px; color: #ff6a00; }");
    expect(css).toContain(".report-export section > h2 { border-bottom: 1px solid #ff6a00; padding-bottom: 6px; }");
  });

  it("never touches unrelated rules (structure stays fixed either way)", () => {
    const neutral = buildExportCss(false, "#ff6a00");
    const branded = buildExportCss(true, "#ff6a00");
    expect(neutral).toContain(".report-export__chart-label { font-size: 11px;");
    expect(branded).toContain(".report-export__chart-label { font-size: 11px;");
  });
});
