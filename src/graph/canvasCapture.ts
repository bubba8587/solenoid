// [[C43]] oneFlowSurface, [[C42]] htmlInCanvasRenderer
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

export function nodeChartSvgProvided(nodeId: string): string | null {
  return chartSvgProviders.get(nodeId)?.() ?? null;
}

export function nodeChartSvgString(nodeId: string): string | null {
  const provided = nodeChartSvgProvided(nodeId);
  if (provided) return provided;
  const el = nodeChartSvg(nodeId);
  return el ? serializeSvgWithComputedStyles(el) : null;
}

export function nodeChartSvg(nodeId: string): SVGSVGElement | null {
  const el = getView()?.nodeElement(nodeId);
  if (!el) return null;
  let best: SVGSVGElement | null = null;
  let bestArea = 40 * 40;
  for (const svg of Array.from(el.querySelectorAll("svg"))) {
    if (svg.classList.contains("solenoid-node__frame")) continue;
    const box = svg.getBoundingClientRect();
    const area = box.width * box.height;
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
