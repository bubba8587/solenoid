// [[C68]] knapIsTheDocumentSyntax
import DOMPurify from "dompurify";
import { getEditor } from "./process";
import { NoteNode, ReportNode } from "./rete-nodes";
import { nodeDisplayNames } from "./nodeNames";
import { resolveRefAnnotation, refPreview } from "./components/inlineRefDisplay";
import { isDocumentValue } from "./documentValue";
import { parseNoteFrontmatter } from "./noteFrontmatter";
import { captureCanvasImage, captureChartSvgs } from "./canvasCapture";
import { saveHtmlFileDialog, isDesktop } from "./fileBridge";
import { pushNotice } from "./noticeStore";
import { reportPaletteStore } from "./palette";
import { APP_LOCALE } from "./locale";
import { renderNoteMarkdown } from "./noteMarkdown";
import { isFrameValue, formatFrameCell, type FrameValue } from "./frame";
import { isImageValue } from "./imageValue";
import { substituteRefCodes, escapeHtml } from "./noteInlineRefs";
import type { FormatAnnotation } from "./formatAnnotationStore";


const REF_RE = /`=([A-Za-z_][A-Za-z0-9_]*)(!?)`/g;

const IMAGE_SRC_RE = /^(https?:\/\/|data:image\/(png|jpeg|gif|webp|svg\+xml);base64,)/i;

export function frameToHtmlTable(frame: FrameValue): string {
  const cols = frame.columns;
  if (cols.length === 0) return "";
  const rows = cols.reduce((m, c) => Math.max(m, c.values.length), 0);
  const cell = (c: FrameValue["columns"][number], i: number) => {
    const f = formatFrameCell(c.type, (c.values[i] ?? null) as never);
    return escapeHtml(f === null || f === undefined ? "" : String(f));
  };
  const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("")}</tr>`;
  const body = Array.from({ length: rows }, (_, i) => `<tr>${cols.map((c) => `<td>${cell(c, i)}</td>`).join("")}</tr>`);
  return `<table><thead>${head}</thead><tbody>${body.join("")}</tbody></table>`;
}

/** The export's markup for one span's value; null leaves the span (an unwired fixed input). Values are escaped here, after the markdown render, so their text never reads as markdown or HTML. */
export function frozenRefHtml(value: unknown, highlight: boolean, ann: FormatAnnotation | undefined): { html: string; block?: boolean } | null {
  if (value === undefined) return null;
  if (isFrameValue(value)) return { html: frameToHtmlTable(value), block: true };
  if (isImageValue(value) && IMAGE_SRC_RE.test(value.src)) {
    const h = Number.isFinite(value.height) && value.height > 0 ? ` height="${Math.round(value.height)}"` : "";
    return { html: `<img class="report-export__image" src="${escapeHtml(value.src)}" alt="${escapeHtml(value.alt ?? value.title ?? "")}"${h} />` };
  }
  const text = escapeHtml(refPreview(value, ann));
  return { html: highlight && text !== "" ? `<mark class="sol-md__hl">${text}</mark>` : text };
}

export function exportFileName(label: string | undefined): string {
  return `${(label ?? "").trim().replace(/[^\w -]/g, "").trim() || "report"}.html`;
}

function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(renderNoteMarkdown(md));
}

/** A document value splits the body and renders as its own block, its spans resolved from its own refs as on screen. */
export function exportBodyHtml(
  body: string,
  refKeys: readonly string[],
  refValue: (key: string) => unknown,
  annotation: (key: string) => FormatAnnotation | undefined,
  render: (md: string) => string = renderMarkdown,
): string {
  const renderSegment = (md: string) => substituteRefCodes(render(md), (name, hl) =>
    refKeys.includes(name) ? frozenRefHtml(refValue(name), hl, annotation(name)) : null);
  const parts: string[] = [];
  const re = new RegExp(REF_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1];
    if (!refKeys.includes(name)) continue;
    const value = refValue(name);
    if (!isDocumentValue(value)) continue;
    parts.push(renderSegment(body.slice(last, m.index)));
    const embedded = substituteRefCodes(render(parseNoteFrontmatter(value.body).body), (n) =>
      n in value.refs ? { html: escapeHtml(refPreview(value.refs[n], undefined)) } : null);
    parts.push(`<div class="report-export__embed"><div class="report-export__embed-name">${escapeHtml(name)}</div>${embedded}</div>`);
    last = m.index + m[0].length;
  }
  parts.push(renderSegment(body.slice(last)));
  return parts.join("\n");
}

export function buildExportCss(branded: boolean, accent: string): string {
  const titleColor = branded ? accent : "#f3f4f5";
  const ruleColor = branded ? accent : "#2d2d2d";
  return `
:root { color-scheme: dark; }
body { margin: 0; background: #0e0e0e; color: #e8e8e8; font: 14px/1.6 -apple-system, "Segoe UI", sans-serif; }
.report-export { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
.report-export__title { font-size: 26px; font-weight: 700; margin: 0 0 4px; color: ${titleColor}; }
.report-export__meta { font-size: 12px; color: #80868e; margin-bottom: 32px; }
.report-export h1 { font-size: 22px; font-weight: 700; margin: 24px 0 12px; color: #f3f4f5; }
.report-export h2 { font-size: 18px; font-weight: 600; margin: 22px 0 8px; color: #f3f4f5; }
.report-export h3 { font-size: 15px; font-weight: 600; margin: 18px 0 6px; }
.report-export p { margin: 10px 0; }
.report-export code { font-family: ui-monospace, monospace; background: #1e1e1e; border: 1px solid #2d2d2d; border-radius: 4px; padding: 1px 5px; }
.report-export .sol-md__wikilink { color: ${accent}; text-decoration: underline dotted; text-underline-offset: 3px; }
.report-export .sol-md__hl { background: color-mix(in srgb, ${accent} 24%, transparent); color: inherit; border-radius: 3px; padding: 0 3px; }
.report-export .sol-md__callout { margin: 12px 0; padding: 8px 12px; border: 1px solid color-mix(in srgb, ${accent} 30%, #2d2d2d); border-radius: 8px; background: color-mix(in srgb, ${accent} 12%, transparent); }
.report-export .sol-md__callout--danger { border-color: color-mix(in srgb, #e0473a 30%, #2d2d2d); background: color-mix(in srgb, #e0473a 8%, transparent); }
.report-export .sol-md__callout-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: ${accent}; }
.report-export .sol-md__callout--danger .sol-md__callout-title { color: #e0473a; }
.report-export .sol-md__callout-body > :first-child { margin-top: 6px; }
.report-export .sol-md__callout-body > :last-child { margin-bottom: 0; }
.report-export .sol-md__math-row { text-align: center; margin: 10px 0; overflow-x: auto; }
.report-export .sol-md__tag { display: inline-block; padding: 0 6px; border-radius: 5px; font-size: 0.85em; line-height: 1.5; color: ${accent}; background: #1e1e1e; border: 1px solid color-mix(in srgb, ${accent} 40%, transparent); }
.report-export pre { background: #1e1e1e; border: 1px solid #2d2d2d; border-radius: 6px; padding: 10px 12px; overflow: auto; }
.report-export table { border-collapse: collapse; margin: 10px 0; }
.report-export th, .report-export td { border: 1px solid #2d2d2d; padding: 4px 9px; text-align: left; }
.report-export section { margin-top: 40px; }
.report-export section > h2 { border-bottom: 1px solid ${ruleColor}; padding-bottom: 6px; }
.report-export__chart { margin: 18px 0; padding: 12px; background: #1e1e1e; border: 1px solid #2d2d2d; border-radius: 8px; }
.report-export__chart-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #9aa0a6; margin-bottom: 8px; }
.report-export__embed { margin: 14px 0; padding: 12px 16px; background: #1e1e1e; border: 1px solid #2d2d2d; border-radius: 8px; }
.report-export__embed-name { font-size: 11.5px; font-weight: 600; color: #9aa0a6; margin-bottom: 6px; }
.report-export__image { max-width: 100%; vertical-align: middle; }
.report-export__snapshot { max-width: 100%; border: 1px solid #2d2d2d; border-radius: 8px; }
`;
}

export function reportReferencedNodeIds(
  report: { id: string },
  connections: readonly { source: string; target: string }[],
  noteIds: ReadonlySet<string>,
): Set<string> {
  const direct = connections.filter((c) => c.target === report.id).map((c) => c.source);
  const targets = new Set([report.id, ...direct.filter((id) => noteIds.has(id))]);
  const out = new Set<string>();
  for (const c of connections) if (targets.has(c.target)) out.add(c.source);
  return out;
}

export function buildReportExportHtml(
  report: ReportNode,
  opts: { canvasImage: string | null; body: string },
): string {
  const editor = getEditor();
  const allNodes = editor?.getNodes() ?? [];
  const names = nodeDisplayNames(allNodes);

  const bodyHtml = exportBodyHtml(
    opts.body,
    [...report.refKeys(), "template", "records"],
    (k) => report.refValue(k),
    (k) => resolveRefAnnotation(report.id, k),
  );

  const noteIds = new Set(allNodes.filter((n): n is NoteNode => n instanceof NoteNode).map((n) => n.id));
  const refIds = reportReferencedNodeIds(report, editor?.getConnections() ?? [], noteIds);
  const charts = captureChartSvgs(names, refIds);
  const chartsHtml = charts.map((c) =>
    `<div class="report-export__chart"><div class="report-export__chart-label">${escapeHtml(c.name)}</div>${c.svg}</div>`,
  ).join("\n");

  const snapshotHtml = opts.canvasImage
    ? `<section><h2>Canvas snapshot</h2><img class="report-export__snapshot" src="${opts.canvasImage}" alt="Canvas snapshot" /></section>`
    : "";

  const title = escapeHtml(report.label?.trim() || "Report");
  const exportedAt = new Date().toLocaleString(APP_LOCALE);
  const branded = reportPaletteStore.reportPalette() !== undefined;
  const accent = reportPaletteStore.resolve("sky");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${buildExportCss(branded, accent)}</style>
</head>
<body>
<div class="report-export">
  <div class="report-export__title">${title}</div>
  <div class="report-export__meta">Exported from Solenoid — ${exportedAt}</div>
  ${bodyHtml}
  ${chartsHtml ? `<section><h2>Charts</h2>${chartsHtml}</section>` : ""}
  ${snapshotHtml}
</div>
</body>
</html>`;
}

export async function exportReportAsWebpage(report: ReportNode): Promise<void> {
  if (/\$/.test(report.body)) await import("./components/katexRender");
  try {
    const canvasImage = await captureCanvasImage();
    const html = buildReportExportHtml(report, { canvasImage, body: await report.renderedBody() });
    const name = exportFileName(report.label);
    const chosen = await saveHtmlFileDialog(name, html);
    // The web download fires and returns null too, so the toast must not key off the path.
    if (chosen || !isDesktop()) pushNotice(`Exported ${name}`, "info", 2500);
  } catch (e) {
    console.error("[solenoid] report export failed", e);
    pushNotice("Couldn't export the report as a webpage.", "error", 0);
  }
}
