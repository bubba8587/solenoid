import { marked } from "marked";
import DOMPurify from "dompurify";
import { getEditor } from "./process";
import { NoteNode, ReportNode } from "./rete-nodes";
import { nodeDisplayNames } from "./nodeNames";
import { resolveRefAnnotation, refPreview } from "./components/inlineRefDisplay";
import { captureCanvasImage, captureChartSvgs } from "./canvasCapture";
import { saveHtmlFileDialog } from "./fileBridge";
import { pushNotice } from "./noticeStore";

// ─── Static HTML export (bundle 13 #47) ────────────────────────────────────────
// "Export as webpage": freezes a Report into ONE self-contained .html file — the
// markdown with every `` `=name` `` ref substituted for its CURRENT formatted
// value as plain text (not live — reuses the same resolver stack + formatting as
// the live rendering, one more time, per the plan), embedded Notes frozen the
// same way, key charts as inline SVG (already free — recharts/hand-drawn SVGs
// serialize as-is), and a canvas snapshot via canvasCapture.ts's NEW rasterize
// path (drawElementImage is Chrome-flag-gated, unusable in a portable file the
// recipient opens in any browser). Everything inlines as data URIs / literal
// markup — no external references, so the file is truly standalone.

const REF_RE = /`=([A-Za-z_][A-Za-z0-9_]*)`/g;

/** Escape the handful of markdown-special characters in a frozen VALUE (not the
 *  surrounding prose) so re-parsing the substituted body doesn't reinterpret a
 *  literal string value (e.g. "the *dev* build") as markdown emphasis. */
export function escapeMd(s: string): string {
  return s.replace(/([\\`*_[\]])/g, "\\$1");
}

/** Replace every `` `=name` `` span in `body` with its CURRENT formatted value as
 *  plain escaped text — the freeze step. A name with no live value (removed ref,
 *  or edited away since) is left as its original span, unmangled. Exported for
 *  unit testing — resolveRefAnnotation degrades to undefined with no live editor,
 *  so this runs without a real graph. */
export function freezeInlineRefs(
  nodeId: string,
  body: string,
  refKeys: string[],
  refValue: (key: string) => unknown,
): string {
  return body.replace(REF_RE, (match, name: string) => {
    if (!refKeys.includes(name)) return match;
    const ann = resolveRefAnnotation(nodeId, name);
    return escapeMd(refPreview(refValue(name), ann));
  });
}

function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true, breaks: true }) as string);
}

const EXPORT_CSS = `
:root { color-scheme: dark; }
body { margin: 0; background: #0e0e0e; color: #e8e8e8; font: 14px/1.6 -apple-system, "Segoe UI", sans-serif; }
.report-export { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
.report-export__title { font-size: 26px; font-weight: 700; margin: 0 0 4px; color: #f3f4f5; }
.report-export__meta { font-size: 12px; color: #80868e; margin-bottom: 32px; }
.report-export h1 { font-size: 22px; font-weight: 700; margin: 24px 0 12px; color: #f3f4f5; }
.report-export h2 { font-size: 18px; font-weight: 600; margin: 22px 0 8px; color: #f3f4f5; }
.report-export h3 { font-size: 15px; font-weight: 600; margin: 18px 0 6px; }
.report-export p { margin: 10px 0; }
.report-export code { font-family: ui-monospace, monospace; background: #1e1e1e; border: 1px solid #2d2d2d; border-radius: 4px; padding: 1px 5px; }
.report-export pre { background: #1e1e1e; border: 1px solid #2d2d2d; border-radius: 6px; padding: 10px 12px; overflow: auto; }
.report-export table { border-collapse: collapse; margin: 10px 0; }
.report-export th, .report-export td { border: 1px solid #2d2d2d; padding: 4px 9px; text-align: left; }
.report-export section { margin-top: 40px; }
.report-export section > h2 { border-bottom: 1px solid #2d2d2d; padding-bottom: 6px; }
.report-export__chart { margin: 18px 0; padding: 12px; background: #1e1e1e; border: 1px solid #2d2d2d; border-radius: 8px; }
.report-export__chart-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #9aa0a6; margin-bottom: 8px; }
.report-export__embed { margin: 14px 0; padding: 12px 16px; background: #1e1e1e; border: 1px solid #2d2d2d; border-radius: 8px; }
.report-export__embed-name { font-size: 11.5px; font-weight: 600; color: #9aa0a6; margin-bottom: 6px; }
.report-export__snapshot { max-width: 100%; border: 1px solid #2d2d2d; border-radius: 8px; }
`;

/** Build the self-contained HTML document string. Exported for unit testing —
 *  the async canvas image is captured by the caller and passed in as a data URI
 *  (or null), keeping this half of the logic synchronous and DOM-free. */
export function buildReportExportHtml(
  report: ReportNode,
  opts: { canvasImage: string | null },
): string {
  const editor = getEditor();
  const allNodes = editor?.getNodes() ?? [];
  const names = nodeDisplayNames(allNodes);

  const bodyFrozen = freezeInlineRefs(report.id, report.body, report.refKeys(), (k) => report.refValue(k));
  const bodyHtml = renderMarkdown(bodyFrozen);

  const embedsHtml = report.embeds.map((id) => {
    const note = allNodes.find((n) => n.id === id) as NoteNode | undefined;
    const label = names.get(id) ?? "Note";
    if (!note) return `<div class="report-export__embed"><div class="report-export__embed-name">${label} (removed)</div></div>`;
    const noteFrozen = freezeInlineRefs(note.id, note.renderBody, note.refKeys(), (k) => note.refValue(k));
    return `<div class="report-export__embed"><div class="report-export__embed-name">${label}</div>${renderMarkdown(noteFrozen)}</div>`;
  }).join("\n");

  const charts = captureChartSvgs(names);
  const chartsHtml = charts.map((c) =>
    `<div class="report-export__chart"><div class="report-export__chart-label">${c.name}</div>${c.svg}</div>`,
  ).join("\n");

  const snapshotHtml = opts.canvasImage
    ? `<section><h2>Canvas snapshot</h2><img class="report-export__snapshot" src="${opts.canvasImage}" alt="Canvas snapshot" /></section>`
    : "";

  const title = report.label?.trim() || "Report";
  const exportedAt = new Date().toLocaleString();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<div class="report-export">
  <div class="report-export__title">${title}</div>
  <div class="report-export__meta">Exported from Solenoid — ${exportedAt}</div>
  ${bodyHtml}
  ${embedsHtml ? `<section><h2>Embedded notes</h2>${embedsHtml}</section>` : ""}
  ${chartsHtml ? `<section><h2>Charts</h2>${chartsHtml}</section>` : ""}
  ${snapshotHtml}
</div>
</body>
</html>`;
}

/** The whole export flow: capture the canvas image, build the document, and hand
 *  it to the save dialog (native on desktop, a browser download otherwise). */
export async function exportReportAsWebpage(report: ReportNode): Promise<void> {
  try {
    const canvasImage = await captureCanvasImage();
    const html = buildReportExportHtml(report, { canvasImage });
    const name = `${(report.label?.trim() || "report").replace(/[^\w -]/g, "")}.html`;
    const chosen = await saveHtmlFileDialog(name, html);
    if (chosen) pushNotice(`Exported ${name}`, "info", 2500);
  } catch (e) {
    console.error("[solenoid] report export failed", e);
    pushNotice("Couldn't export the report as a webpage.", "error", 0);
  }
}
