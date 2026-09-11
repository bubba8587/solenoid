// The impure half of obsidianMarkdown.ts: charts rasterize from the source node's
// LIVE svg, so this runs only from the Write node's Run click.

import {
  hasFs, joinPath, ensureDir, writeTextFilePath, writeBinaryFilePath, readTextFilePath,
} from "./fileBridge";
import { nodeChartSvg, serializeSvgWithComputedStyles } from "./canvasCapture";
import { dataUrlToBytes, sanitizeName } from "./imageAssets";
import { assembleDocumentMarkdown, valueToObsidianBlock } from "./obsidianMarkdown";
import { isImageValue, type ImageValue } from "./imageValue";
import { type DocumentValue } from "./documentValue";
import { spliceBlock } from "./managedBlock";

const EXT_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/** The narrowest PNG worth embedding in a note. */
const MIN_RASTER_W = 640;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Rasterize a live `<svg>` to PNG bytes, baking computed styles in first — the vault
 *  has none of our CSS. The inline card chart is small, so the raster scales it up to a
 *  note-sized width (vector all the way). Null if the SVG is too small or the raster fails. */
async function rasterizeSvg(svgEl: SVGSVGElement): Promise<Uint8Array | null> {
  const box = svgEl.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width));
  const h = Math.max(1, Math.round(box.height));
  if (w < 8 || h < 8) return null;
  const markup = serializeSvgWithComputedStyles(svgEl);
  // Size the root through the DOM, not a string prepend: a recharts root already has
  // width/height, and a duplicated attribute is a fatal XML parse error.
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const root = holder.querySelector("svg");
  if (!root) return null;
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

/** overwrite = the note is the document; append = the document is added at the end;
 *  block = the writer owns one `%% solenoid:begin <name> %%` span (managedBlock.ts). */
export type ObsidianWriteMode = "overwrite" | "append" | "block";

/** The note's next text from its current text (null = no note yet) and the assembled
 *  markdown, per mode. Pure; throws on a refused block splice. */
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
  /** How the note takes the document; default overwrite. */
  mode?: ObsidianWriteMode;
  /** The managed block's name (mode block); the writer's node name. */
  blockName?: string;
}

export interface WriteVaultResult {
  /** The written note's vault-relative path (a batch's FIRST page). */
  file: string;
  /** How many image assets were written. */
  assets: number;
  /** How many notes a batch document wrote (1 for a single document). */
  pages: number;
}

/** Desktop only — THROWS off-desktop (the node guards first); overwrites an existing
 *  note of the same name. */
export async function writeDocumentToVault(doc: DocumentValue, opts: WriteVaultOptions): Promise<WriteVaultResult> {
  if (!hasFs()) throw new Error("Desktop app only");
  // Drop empty / "." / ".." segments so a stray ".." can't climb out of the vault.
  const cleanParts = (p: string) =>
    p.split("/").map((s) => s.trim()).filter((s) => s && s !== "." && s !== "..");
  const subParts = cleanParts(opts.subfolder);
  const noteDir = subParts.length ? await joinPath(opts.vault, ...subParts) : opts.vault;
  await ensureDir(noteDir);

  const assetParts = cleanParts(opts.assetSubfolder);
  const assetDir = assetParts.length ? await joinPath(opts.vault, ...assetParts) : noteDir;

  let assetCount = 0;
  // A batch document writes one note per page, each named by its page; a single
  // document writes under the sink's name.
  const pages = doc.pages?.length ? doc.pages : [{ name: opts.name, body: doc.body }];
  let base = sanitizeName(opts.name) || "note";

  // Returns the Obsidian embed token, which resolves by FILENAME across the vault.
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

  const mode = opts.mode ?? "overwrite";
  let first = "";
  for (const page of pages) {
    base = sanitizeName(page.name) || "note";
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
