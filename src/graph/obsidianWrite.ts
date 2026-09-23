// [[B1]] obsidianBet, [[C101]] onePatchPath

import {
  hasFs, joinPath, ensureDir, writeTextFilePath, writeBinaryFilePath, readTextFilePath,
} from "./fileBridge";
import { nodeChartSvg, nodeChartSvgProvided, serializeSvgWithComputedStyles } from "./canvasCapture";
import { dataUrlToBytes, sanitizeName } from "./imageAssets";
import { assembleDocumentMarkdown, valueToObsidianBlock } from "./obsidianMarkdown";
import { isImageValue, type ImageValue } from "./imageValue";
import { refPreview, resolveRefAnnotation } from "./components/inlineRefDisplay";
import { type DocumentValue } from "./documentValue";
import { spliceBlock } from "./managedBlock";

const EXT_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

const MIN_RASTER_W = 640;

/** Case-insensitive, because the vault may sit on a case-insensitive filesystem. */
function claimName(stem: string, ext: string, taken: Set<string>): string {
  let k = stem;
  for (let i = 2; taken.has(`${k}.${ext}`.toLowerCase()); i++) k = `${stem} (${i})`;
  taken.add(`${k}.${ext}`.toLowerCase());
  return k;
}

/** `#`, `^`, `[`, `]` and `|` end or redirect a wikilink target, so an embedded file cannot carry them. */
const linkSafe = (s: string) => s.replace(/[#^[\]|]/g, "");

export function imageMarkdown(alt: string, url: string): string {
  const a = alt.replace(/[\r\n]+/g, " ").replace(/([\\[\]])/g, "\\$1");
  const u = url.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `![${a}](${u})`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

function svgIntrinsic(root: Element, dim: "width" | "height"): number {
  const attr = parseFloat(root.getAttribute(dim) ?? "");
  if (Number.isFinite(attr) && attr > 0) return attr;
  const vb = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const v = dim === "width" ? vb[2] : vb[3];
  return Number.isFinite(v) && v > 0 ? v : 0;
}

async function rasterizeSvgMarkup(markup: string, size?: { w: number; h: number }): Promise<Uint8Array | null> {
  // Size the root through the DOM: a root may already carry width/height, and a duplicate attribute is a fatal XML parse error.
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const root = holder.querySelector("svg");
  if (!root) return null;
  const w = Math.max(1, Math.round(size?.w ?? svgIntrinsic(root, "width")));
  const h = Math.max(1, Math.round(size?.h ?? svgIntrinsic(root, "height")));
  if (w < 8 || h < 8) return null;
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  const sized = new XMLSerializer().serializeToString(root);
  const blob = new Blob([sized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(4, Math.max(2, MIN_RASTER_W / w));
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

/** Sized from the measured box, since a recharts root has no reliable intrinsic size until drawn. */
async function rasterizeSvg(svgEl: SVGSVGElement): Promise<Uint8Array | null> {
  const box = svgEl.getBoundingClientRect();
  return rasterizeSvgMarkup(serializeSvgWithComputedStyles(svgEl), { w: box.width, h: box.height });
}

export type ObsidianWriteMode = "overwrite" | "append" | "block";

export function mergeNoteText(existing: string | null, md: string, mode: ObsidianWriteMode, blockName: string): string {
  if (mode === "overwrite" || existing === null) {
    if (mode === "block") return spliceBlock("", blockName, md).text;
    return md;
  }
  if (mode === "append") {
    const body = existing.replace(/\s+$/, "");
    return (body ? body + "\n\n" : "") + md;
  }
  const r = spliceBlock(existing, blockName, md);
  if (r.refused) throw new Error(`Refused: ${r.refused}`);
  return r.text;
}

export interface WriteVaultOptions {
  vault: string;
  subfolder: string;
  assetSubfolder: string;
  name: string;
  refSources: Map<string, string>;
  mode?: ObsidianWriteMode;
  blockName?: string;
}

export interface WriteVaultResult {
  file: string;
  assets: number;
  pages: number;
}

export async function writeDocumentToVault(doc: DocumentValue, opts: WriteVaultOptions): Promise<WriteVaultResult> {
  if (!hasFs()) throw new Error("Desktop app only");
  const cleanParts = (p: string) =>
    p.split("/").map((s) => s.trim()).filter((s) => s && s !== "." && s !== "..");
  const subParts = cleanParts(opts.subfolder);
  const noteDir = subParts.length ? await joinPath(opts.vault, ...subParts) : opts.vault;
  await ensureDir(noteDir);

  const assetParts = cleanParts(opts.assetSubfolder);
  const assetDir = assetParts.length ? await joinPath(opts.vault, ...assetParts) : noteDir;

  let assetCount = 0;
  const pages = doc.pages ?? [{ name: opts.name, body: doc.body }];
  const sinkName = sanitizeName(opts.name, "note");
  let base = sinkName;
  const takenNotes = new Set<string>();
  const takenAssets = new Set<string>();

  async function writeAsset(refName: string, bytes: Uint8Array, ext: string): Promise<string> {
    if (assetParts.length) await ensureDir(assetDir);
    const fileName = `${claimName(linkSafe(`${base}-${sanitizeName(refName)}`), ext, takenAssets)}.${ext}`;
    await writeBinaryFilePath(await joinPath(assetDir, fileName), bytes);
    assetCount++;
    return `![[${fileName}]]`;
  }

  async function resolveRef(name: string, value: unknown): Promise<string> {
    if (isImageValue(value)) {
      const img = value as ImageValue;
      const alt = img.alt ?? img.title ?? name;
      if (/^https?:/i.test(img.src)) return imageMarkdown(alt, img.src);
      const parsed = dataUrlToBytes(img.src);
      if (!parsed) return "";
      const ext = Object.entries(EXT_MIME).find(([, m]) => m === parsed.mime)?.[0] ?? "png";
      return writeAsset(name, parsed.bytes, ext);
    }
    const block = valueToObsidianBlock(value);
    if (block.kind === "md") {
      if (!block.plain || value == null) return block.md;
      return refPreview(value, doc.sourceId ? resolveRefAnnotation(doc.sourceId, name) : undefined);
    }
    const srcId = opts.refSources.get(name);
    const provided = srcId ? nodeChartSvgProvided(srcId) : null;
    const bytes = provided
      ? await rasterizeSvgMarkup(provided)
      : await (async () => {
          const svg = srcId ? nodeChartSvg(srcId) : null;
          return svg ? rasterizeSvg(svg) : null;
        })();
    if (!bytes) return "";
    return writeAsset(name, bytes, "png");
  }

  const mode = opts.mode ?? "overwrite";
  let first = "";
  for (const [i, page] of pages.entries()) {
    base = claimName(sanitizeName(page.name, doc.pages ? `${sinkName}-${i + 1}` : sinkName), "md", takenNotes);
    const md = await assembleDocumentMarkdown({ ...doc, body: page.body }, resolveRef);
    const notePath = await joinPath(noteDir, `${base}.md`);
    let existing: string | null = null;
    if (mode !== "overwrite") {
      try { existing = await readTextFilePath(notePath); } catch { existing = null; }
    }
    await writeTextFilePath(notePath, mergeNoteText(existing, md, mode, opts.blockName ?? "Solenoid"));
    const rel = subParts.length ? `${subParts.join("/")}/${base}.md` : `${base}.md`;
    if (!first) first = rel;
  }
  return { file: first, assets: assetCount, pages: pages.length };
}
