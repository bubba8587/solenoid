// ─── Write to Obsidian — the Run-time (DOM + filesystem) half ──────────────────
// The impure counterpart to obsidianMarkdown.ts's pure serializer. Given a
// DocumentValue (from a Note or Report) it assembles the final `.md` and writes it
// into an Obsidian vault, plus any image assets a `` `=name` `` ref needs:
//   • a chart ref  → rasterize the SOURCE node's live <svg> to a PNG asset
//   • an image ref → write the image's bytes (a data: URL) as an asset
//   • a web-URL image → embed the URL directly (no local asset)
//   • everything else → native markdown (frame table, mermaid block, math, text)
// Charts need the live DOM (the source node's rendered SVG), which is exactly why
// this can't live in the pure module and runs only from the Write node's Run click.

import {
  isDesktop, joinPath, ensureDir, writeTextFilePath, writeBinaryFilePath,
} from "./fileBridge";
import { getArea } from "./process";
import { serializeSvgWithComputedStyles } from "./canvasCapture";
import { dataUrlToBytes, sanitizeName } from "./imageAssets";
import { assembleDocumentMarkdown, valueToObsidianBlock } from "./obsidianMarkdown";
import { isImageValue, type ImageValue } from "./imageValue";
import { type DocumentValue } from "./documentValue";

const EXT_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Rasterize a live in-document `<svg>` (a chart node's) to PNG bytes at 2× for
 *  crispness. Bakes computed styles in first (the vault has none of our CSS), then
 *  draws through an off-screen canvas — the same foreignObject-free path the static
 *  export uses. Returns null if the SVG is too small or the raster fails. */
async function rasterizeSvg(svgEl: SVGSVGElement): Promise<Uint8Array | null> {
  const box = svgEl.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width));
  const h = Math.max(1, Math.round(box.height));
  if (w < 8 || h < 8) return null;
  const markup = serializeSvgWithComputedStyles(svgEl);
  // Ensure the serialized root carries explicit pixel dimensions + the SVG namespace
  // so the off-document Image can size it (a class-sized chart has neither).
  const sized = markup
    .replace(/^<svg/, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"`);
  const blob = new Blob([sized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const parsed = dataUrlToBytes(canvas.toDataURL("image/png"));
    return parsed?.bytes ?? null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The live `<svg>` element of a node (its main chart art, not a socket glyph). */
function nodeChartSvg(nodeId: string): SVGSVGElement | null {
  const view = getArea()?.nodeViews.get(nodeId);
  if (!view) return null;
  const svgs = Array.from(view.element.querySelectorAll("svg"));
  // The chart is the node's biggest SVG (glyphs are ~≤20px); pick the largest.
  let best: SVGSVGElement | null = null;
  let bestArea = 40 * 40; // ignore anything glyph-sized
  for (const s of svgs) {
    const b = s.getBoundingClientRect();
    const a = b.width * b.height;
    if (a > bestArea) { bestArea = a; best = s as SVGSVGElement; }
  }
  return best;
}

export interface WriteVaultOptions {
  /** Absolute path to the vault root. */
  vault: string;
  /** Vault-relative subfolder to write the note into ("" = vault root). */
  subfolder: string;
  /** Vault-relative subfolder for image assets ("" = beside the note). */
  assetSubfolder: string;
  /** The note file name (no extension; ".md" is appended). */
  name: string;
  /** ref name → the source node id feeding it (for chart rasterization). */
  refSources: Map<string, string>;
}

export interface WriteVaultResult {
  /** The written note's vault-relative path. */
  file: string;
  /** How many image assets were written. */
  assets: number;
}

/** Assemble `doc` into Obsidian markdown and write it (plus any chart/image assets)
 *  into the vault. Desktop only — throws if called off-desktop (the node guards
 *  first). Overwrites an existing note of the same name (a re-run refreshes it). */
export async function writeDocumentToVault(doc: DocumentValue, opts: WriteVaultOptions): Promise<WriteVaultResult> {
  if (!isDesktop()) throw new Error("Desktop app only");
  const subParts = opts.subfolder.split("/").map((s) => s.trim()).filter(Boolean);
  const noteDir = subParts.length ? await joinPath(opts.vault, ...subParts) : opts.vault;
  await ensureDir(noteDir);

  const assetParts = opts.assetSubfolder.split("/").map((s) => s.trim()).filter(Boolean);
  const assetDir = assetParts.length ? await joinPath(opts.vault, ...assetParts) : noteDir;

  let assetCount = 0;
  const base = sanitizeName(opts.name) || "note";

  // Write image bytes into the asset folder under a per-ref name; return the
  // Obsidian embed token (`![[filename]]`, resolved by filename across the vault).
  async function writeAsset(refName: string, bytes: Uint8Array, ext: string): Promise<string> {
    if (assetParts.length) await ensureDir(assetDir);
    const fileName = `${base}-${sanitizeName(refName)}.${ext}`;
    await writeBinaryFilePath(await joinPath(assetDir, fileName), bytes);
    assetCount++;
    return `![[${fileName}]]`;
  }

  async function resolveRef(name: string, value: unknown): Promise<string> {
    // A web-URL image embeds its URL directly; a data:-URL image writes an asset.
    if (isImageValue(value)) {
      const img = value as ImageValue;
      const alt = img.alt ?? img.title ?? name;
      if (/^https?:/i.test(img.src)) return `![${alt}](${img.src})`;
      const parsed = dataUrlToBytes(img.src);
      if (!parsed) return "";
      const ext = Object.entries(EXT_MIME).find(([, m]) => m === parsed.mime)?.[0] ?? "png";
      return writeAsset(name, parsed.bytes, ext);
    }
    const block = valueToObsidianBlock(value);
    if (block.kind === "md") return block.md;
    // A chart — rasterize the source node's live SVG to a PNG asset.
    const srcId = opts.refSources.get(name);
    const svg = srcId ? nodeChartSvg(srcId) : null;
    if (!svg) return ""; // chart not on the live canvas (nothing to rasterize)
    const bytes = await rasterizeSvg(svg);
    if (!bytes) return "";
    return writeAsset(name, bytes, "png");
  }

  const md = await assembleDocumentMarkdown(doc, resolveRef);
  const notePath = await joinPath(noteDir, `${base}.md`);
  await writeTextFilePath(notePath, md);

  const rel = subParts.length ? `${subParts.join("/")}/${base}.md` : `${base}.md`;
  return { file: rel, assets: assetCount };
}
