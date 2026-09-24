// [[C24]], [[C103]] untrustedContentSeams
import { describe, it, expect } from "vitest";
import { exportBodyHtml, exportFileName, buildExportCss, reportReferencedNodeIds } from "../../src/graph/reportExport";
import { renderNoteMarkdown } from "../../src/graph/noteMarkdown";
import { makeDocument } from "../../src/graph/documentValue";
import { solError } from "../../src/graph/errorValue";

const md = (m: string) => renderNoteMarkdown(m);
const body = (src: string, values: Record<string, unknown>) =>
  exportBodyHtml(src, Object.keys(values), (k) => values[k], () => undefined, md);

describe("exportBodyHtml freezes spans after the markdown render", () => {
  it("freezes a highlighted span as a mark and a Frame as an HTML table filling its paragraph", () => {
    expect(body("Total `=t!` today.", { t: 12 })).toContain('Total <mark class="sol-md__hl">12</mark> today.');
    const frame = { __frame: true, columns: [{ name: "a<b", type: "number", values: [1, 2] }] };
    const out = body("`=f`", { f: frame });
    expect(out).toContain("<table><thead><tr><th>a&lt;b</th></tr></thead><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>");
    expect(out).not.toContain("<p>");
  });

  it("leaves a span whose value is unknown (an unwired fixed input) or whose name is not an input", () => {
    expect(body("`=records`", { records: undefined })).toContain("<code>=records</code>");
    expect(exportBodyHtml("Run `=x` here.", [], () => 0, () => undefined, md)).toContain("<code>=x</code>");
  });

  it("writes a value's text literally: markdown, HTML, math and comments in it stay text", () => {
    const out = body("Name: `=name`", { name: "<img src=x onerror=alert(1)> *b* $x$ %%c%% [[w]]" });
    expect(out).toContain("Name: &lt;img src=x onerror=alert(1)&gt; *b* $x$ %%c%% [[w]]");
  });

  it("freezes an error to its code and null to the dash", () => {
    expect(body("`=x` `=y`", { x: solError("#DIV/0!", "divide by zero"), y: null })).toContain("#DIV/0! —");
  });

  it("embeds a web or attached image, and never a script URL", () => {
    const web = { __image: true, src: "https://e.com/a b.png", height: 80, alt: 'q"x' };
    expect(body("`=i`", { i: web })).toContain('<img class="report-export__image" src="https://e.com/a b.png" alt="q&quot;x" height="80" />');
    const file = { __image: true, src: "data:image/png;base64,AAAA", height: 40 };
    expect(body("`=i`", { i: file })).toContain('src="data:image/png;base64,AAAA"');
    const bad = { __image: true, src: "javascript:alert(1)", height: 40, title: "Pic" };
    const out = body("`=i`", { i: bad });
    expect(out).not.toContain("<img");
    expect(out).toContain("Pic");
  });

  it("embeds an SVG value as its figure, sanitized, and an empty one as its text", () => {
    const svg = { __svg: true, height: 120, title: "Plan", source: '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" width="5" height="5"/><a href="https://e.com"><path d="M0 0"/></a></svg>' };
    const out = body("`=s`", { s: svg });
    expect(out).toContain('<div class="report-export__svg" style="height:120px"><svg viewBox="0 0 10 10"><rect width="5" height="5"/>');
    expect(out).not.toMatch(/script|onclick|e\.com/);
    expect(out).not.toContain("<p>");
    expect(body("`=s`", { s: { __svg: true, height: 80, source: "", title: "Plan" } })).toContain("Plan");
  });

  it("formats a Frame's cells by the column's own format, and a pick on the source card beats it", () => {
    const dec = (n: number) => ({ format: "decimal", unit: "none", decimalDigits: n, decimalMode: "places" }) as const;
    const frame = { __frame: true, columns: [
      { name: "a", type: "number", values: [1.23456], format: dec(1) },
      { name: "b", type: "number", values: [2.5] },
      { name: "c", type: "number", values: [0.1 + 0.2] },
    ] };
    const out = exportBodyHtml("`=f`", ["f"], () => frame, () => undefined, md,
      (key, column) => (key === "f" && column === "b" ? dec(2) : undefined));
    expect(out).toContain("<td>1.2</td><td>2.50</td><td>0.3</td>");
  });

  it("renders a wired document as its own block, its spans resolved from its own refs", () => {
    const doc = makeDocument("---\na: 1\n---\nInner `=v` and `=gone`", { v: "<b>" });
    const out = body("Before\n\n`=d`\n\nAfter", { d: doc });
    expect(out).toContain('<div class="report-export__embed-name">d</div>');
    expect(out).toContain("Inner &lt;b&gt; and <code>=gone</code>");
    expect(out).not.toContain("a: 1");
  });

  it("names the file from the label, falling back when nothing survives", () => {
    expect(exportFileName("Q3 / review?")).toBe("Q3  review.html");
    expect(exportFileName("???")).toBe("report.html");
    expect(exportFileName(undefined)).toBe("report.html");
  });
});

// Backlog "static export fidelity nits" — the exported Charts section takes only
// report-referenced charts, not every on-canvas chart. The reference set is the
// sources wired directly into the report's ref inputs (plus embedded Notes'),
// computed by this pure helper; captureChartSvgs filters on it.
describe("reportReferencedNodeIds", () => {
  const report = { id: "rep" };
  const noteIds = new Set(["note1"]);

  it("collects sources wired into the report itself", () => {
    const ids = reportReferencedNodeIds(report, [
      { source: "chartA", target: "rep" },
      { source: "num", target: "rep" },
    ], noteIds);
    expect(ids).toEqual(new Set(["chartA", "num"]));
  });

  it("includes sources wired into a wired-in note's refs", () => {
    const ids = reportReferencedNodeIds(report, [
      { source: "note1", target: "rep" },
      { source: "chartB", target: "note1" },
    ], noteIds);
    expect(ids).toEqual(new Set(["note1", "chartB"]));
  });

  it("excludes connections elsewhere in the graph (no upstream closure)", () => {
    const ids = reportReferencedNodeIds(report, [
      { source: "chartA", target: "rep" },
      { source: "upstream", target: "chartA" },   // feeds the chart, not the report
      { source: "chartC", target: "otherNode" },  // unrelated
    ], noteIds);
    expect(ids).toEqual(new Set(["chartA"]));
  });

  it("is empty for a report with no refs", () => {
    expect(reportReferencedNodeIds({ id: "rep" }, [], new Set())).toEqual(new Set());
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
