// [[B3]] sameNodeEverywhere, [[C42]] htmlInCanvasRenderer
import { getView, getEditor } from "./process";

function inlineStylesheetText(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) chunks.push(rule.cssText);
    } catch {
      // cross-origin sheet — can't read its rules; skip it.
    }
  }
  return chunks.join("\n");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** The current viewport only, not the whole world; null when unmounted or the browser refuses the foreignObject. */
export async function captureCanvasImage(): Promise<string | null> {
  const container = getView()?.container;
  if (!container) return null;

  const rect = container.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const clone = container.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  clone.style.transform = "none";
  clone.style.position = "static";

  const css = inlineStylesheetText();
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">` +
    `<style>${css}</style>${xhtml}` +
    `</div></foreignObject></svg>`;

  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const SVG_STYLE_PROPS = [
  "fill", "stroke", "stroke-width", "stroke-dasharray", "opacity",
  "font-family", "font-size", "font-weight", "color",
] as const;

/** Original and clone are walked in lockstep, because getComputedStyle is blank on a detached node. */
export function serializeSvgWithComputedStyles(svgEl: SVGSVGElement): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  const origs: Element[] = [svgEl, ...Array.from(svgEl.querySelectorAll("*"))];
  const clones: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (let i = 0; i < origs.length; i++) {
    const target = clones[i] as Element & Partial<ElementCSSInlineStyle>;
    if (!target?.style) continue;
    const computed = getComputedStyle(origs[i]);
    for (const prop of SVG_STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (!value) continue;
      if (target.getAttribute(prop) === value) continue;
      target.style.setProperty(prop, value);
    }
  }
  return clone.outerHTML;
}

export type ChartSvgProvider = () => string | null;
const chartSvgProviders = new Map<string, ChartSvgProvider>();

export function registerChartSvgProvider(nodeId: string, provider: ChartSvgProvider): () => void {
  chartSvgProviders.set(nodeId, provider);
  return () => { if (chartSvgProviders.get(nodeId) === provider) chartSvgProviders.delete(nodeId); };
}

function nodeChartSvgProvided(nodeId: string): string | null {
  return chartSvgProviders.get(nodeId)?.() ?? null;
}

export interface LegendEntry { color: string; label: string }

const xmlText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const LEGEND_ROW_H = 18;

/** A multi-series legend as one centered SVG row of swatches and names, `width` wide. */
export function legendToSvg(entries: readonly LegendEntry[], width: number, textColor: string, fontSize = 9, fontFamily = "sans-serif"): string {
  const itemW = entries.map((e) => 12 + e.label.length * fontSize * 0.6);
  const total = itemW.reduce((a, w) => a + w, 0) + 10 * Math.max(0, entries.length - 1);
  let x = Math.max(0, (width - total) / 2);
  const mid = LEGEND_ROW_H / 2;
  const parts = entries.map((e, i) => {
    const g = `<rect x="${x.toFixed(1)}" y="${mid - 4}" width="8" height="8" rx="2" fill="${xmlText(e.color)}"/>`
      + `<text x="${(x + 12).toFixed(1)}" y="${mid}" dominant-baseline="central" font-size="${fontSize}" font-family="${xmlText(fontFamily)}" fill="${xmlText(textColor)}">${xmlText(e.label)}</text>`;
    x += itemW[i] + 10;
    return g;
  });
  return `<g class="sol-chart-legend">${parts.join("")}</g>`;
}

/** An element's size in canvas units: its screen box with the React Flow zoom taken out. */
function canvasSizeOf(el: Element): { w: number; h: number } {
  const viewport = el.closest<HTMLElement>(".react-flow__viewport");
  const zoom = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1 : 1;
  const box = el.getBoundingClientRect();
  return { w: Math.round(box.width / zoom), h: Math.round(box.height / zoom) };
}

/** A chart card's SVG for export, its root sized in canvas units, with a multi-series legend drawn under the plot. */
export function nodeChartSvgString(nodeId: string): string | null {
  const provided = nodeChartSvgProvided(nodeId);
  if (provided) return provided;
  const el = nodeChartSvg(nodeId);
  if (!el) return null;
  const svg = serializeSvgWithComputedStyles(el);
  const { w, h } = canvasSizeOf(el);
  // The multi-series legend is DOM beside the plot, so an export of the plot's SVG alone can't tell the series apart.
  const legend = getView()?.nodeElement(nodeId)?.querySelector(".sol-chart-legend");
  const entries: LegendEntry[] = legend ? Array.from(legend.children).map((item) => ({
    color: getComputedStyle(item.firstElementChild as Element).backgroundColor,
    label: (item.textContent ?? "").trim(),
  })).filter((e) => e.label) : [];
  const legendH = entries.length > 0 ? LEGEND_ROW_H : 0;
  const style = legend && legendH ? getComputedStyle(legend) : null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + legendH}" viewBox="0 0 ${w} ${h + legendH}">${svg}`
    + `${style ? `<g transform="translate(0,${h})">${legendToSvg(entries, w, style.color, 9, style.fontFamily)}</g>` : ""}</svg>`;
}

export function nodeChartSvg(nodeId: string): SVGSVGElement | null {
  const el = getView()?.nodeElement(nodeId);
  if (!el) return null;
  let best: SVGSVGElement | null = null;
  let bestArea = 40 * 40;
  for (const svg of Array.from(el.querySelectorAll("svg"))) {
    if (svg.classList.contains("solenoid-node__frame")) continue;
    const { w, h } = canvasSizeOf(svg);
    const area = w * h;
    if (area > bestArea) { bestArea = area; best = svg; }
  }
  return best;
}

export function captureChartSvgs(
  names: Map<string, string>,
  includeNodeIds?: ReadonlySet<string>,
): { name: string; svg: string }[] {
  const editor = getEditor();
  if (!editor) return [];
  const out: { name: string; svg: string }[] = [];
  for (const { id } of editor.getNodes()) {
    if (includeNodeIds && !includeNodeIds.has(id)) continue;
    const svg = nodeChartSvgString(id);
    if (!svg) continue;
    out.push({ name: names.get(id) ?? "Chart", svg });
  }
  return out;
}
