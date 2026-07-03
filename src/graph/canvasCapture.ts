import { getArea } from "./process";

// ─── Canvas image capture — for static export, NOT the live renderer ──────────
// The live HTML-in-Canvas renderer (htmlCanvasRenderer.ts) draws real node DOM via
// `ctx.drawElementImage`, a WICG API behind a Chrome flag
// (--enable-blink-features=CanvasDrawElement) — unusable for a portable exported
// .html file a recipient opens in ANY browser. This is a SEPARATE, self-contained
// capture path built for that: serialize the live canvas viewport DOM into an SVG
// `<foreignObject>`, rasterize it through an off-screen `<canvas>`. Best-effort —
// complex CSS (backdrop-filter, some gradients) can render slightly differently
// than the live DOM, which is acceptable for a static export snapshot.

/** Inline every same-origin stylesheet rule into one <style> text block — a
 *  foreignObject rasterized via an off-document Image element doesn't inherit the
 *  page's live stylesheets, so the clone needs its CSS travelling with it. A
 *  cross-origin sheet (a CDN font, if any) throws on .cssRules access; skipped
 *  rather than failing the whole capture. */
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

/**
 * Rasterizes the CURRENT canvas viewport (what's on screen, not the whole
 * infinite world) into a PNG data URL. Returns null if the canvas area isn't
 * mounted or the browser taints/refuses the foreignObject rasterization (some
 * older WebKit builds do, for cross-origin-tainted external content — none of
 * ours is, but the guard keeps export failing soft rather than throwing).
 */
export async function captureCanvasImage(): Promise<string | null> {
  const container = getArea()?.container;
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

/** Every currently-rendered `<svg>` belonging to a "visual" node (Chart/Sparkline/
 *  Gauge/Heatmap — the nodeCatalog "Visuals" group), as inline SVG markup with its
 *  node's display name. "Already free" per the plan — recharts/hand-drawn SVGs
 *  serialize as-is, no rasterization needed. */
export function captureChartSvgs(names: Map<string, string>): { name: string; svg: string }[] {
  const area = getArea();
  if (!area) return [];
  const out: { name: string; svg: string }[] = [];
  for (const [id, view] of area.nodeViews) {
    const svgEl = view.element.querySelector("svg");
    if (!svgEl) continue;
    // Skip icon-sized furniture (socket dots, chevrons, buttons) — a chart SVG is
    // always the node's main content, well past a glyph's ~20px footprint.
    const box = svgEl.getBoundingClientRect();
    if (box.width < 40 || box.height < 40) continue;
    out.push({ name: names.get(id) ?? "Chart", svg: svgEl.outerHTML });
  }
  return out;
}
