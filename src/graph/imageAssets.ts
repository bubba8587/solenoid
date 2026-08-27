// A node's session `dataUrl` is written as a PLAIN file into `images/` beside the
// doc and persisted as a doc-relative `assetPath`, so the save JSON never carries
// base64. Desktop only — on web both hooks no-op and attach stays session-only.

import {
  isDesktop,
  dirOfPath,
  joinPath,
  pathExists,
  ensureDir,
  readBinaryFilePath,
  writeBinaryFilePath,
} from "./fileBridge";
import { getEditor, getArea, processGraph } from "./process";
import { documentStore } from "./documentStore";

export const IMAGES_DIR = "images";

// Duck-typed rather than importing the node class: only ImageNode carries BOTH fields.
type ImageAssetNode = {
  id: string;
  label: string;
  url: string;
  dataUrl: string;
  fileName: string;
  assetPath: string;
};

function isImageAssetNode(n: unknown): n is ImageAssetNode {
  const o = n as Record<string, unknown> | null;
  return !!o && typeof o.dataUrl === "string" && typeof o.assetPath === "string";
}

function imageNodes(): ImageAssetNode[] {
  const editor = getEditor();
  if (!editor) return [];
  return (editor.getNodes() as unknown[]).filter(isImageAssetNode);
}

// ── data: URL ↔ bytes ─────────────────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
  ico: "image/x-icon",
};

function mimeToExt(mime: string): string {
  for (const [ext, m] of Object.entries(EXT_TO_MIME)) if (m === mime) return ext;
  return "png";
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: m[1] };
  } catch {
    return null;
  }
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const CHUNK = 0x8000; // String.fromCharCode arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

// ── naming ────────────────────────────────────────────────────────────────────

/** A safe plain filename: strip any path part + characters Windows refuses. */
export function sanitizeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[<>:"|?*\x00-\x1f]/g, "").trim();
  return clean || "image";
}

function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** FNV-1a over the bytes — a short stable suffix for the collision fallback. */
function contentHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── save hook ─────────────────────────────────────────────────────────────────

/** Must be called BEFORE serializeGraph so the JSON carries the fresh assetPaths.
 *  Identical content reuses the existing file; a name owned by DIFFERENT content
 *  falls back to "name (2).ext" then a content-hash suffix. */
export async function bundleLocalImages(docPath: string): Promise<{ bundled: number; failed: number }> {
  let bundled = 0;
  let failed = 0;
  if (!isDesktop()) return { bundled, failed };
  const nodes = imageNodes().filter((n) => n.dataUrl && !n.url);
  if (nodes.length === 0) return { bundled, failed };

  const dir = await dirOfPath(docPath);
  const imagesDir = await joinPath(dir, IMAGES_DIR);
  const area = getArea();

  for (const n of nodes) {
    const parsed = dataUrlToBytes(n.dataUrl);
    if (!parsed) { failed++; continue; }
    try {
      await ensureDir(imagesDir);
      const preferred = sanitizeName(n.fileName || n.label || "image");
      const { stem, ext: nameExt } = splitExt(preferred);
      const ext = nameExt in EXT_TO_MIME ? nameExt : mimeToExt(parsed.mime);

      let finalName: string | null = null;
      const candidates = [
        `${stem}.${ext}`,
        ...Array.from({ length: 8 }, (_, i) => `${stem} (${i + 2}).${ext}`),
        `${stem}-${contentHash(parsed.bytes)}.${ext}`,
      ];
      for (const cand of candidates) {
        const p = await joinPath(imagesDir, cand);
        if (!(await pathExists(p))) {
          await writeBinaryFilePath(p, parsed.bytes);
          finalName = cand;
          break;
        }
        if (bytesEqual(await readBinaryFilePath(p), parsed.bytes)) {
          finalName = cand;
          break;
        }
      }
      if (!finalName) { failed++; continue; } // pathological — every candidate taken by different content
      n.assetPath = `${IMAGES_DIR}/${finalName}`;
      bundled++;
      void area?.rerenderNode(n.id); // the card's "not saved" hint clears
    } catch (e) {
      console.error(`[solenoid] couldn't bundle image "${n.fileName || n.label}"`, e);
      failed++;
    }
  }
  return { bundled, failed };
}

// ── load hook ─────────────────────────────────────────────────────────────────

/** Called from the Image component's MOUNT, which covers doc load, paste and
 *  placeholder restore without a per-load-path hook. A missing file is not an
 *  error — the folder is the user's and files can move. */
export async function hydrateImageAsset(node: unknown): Promise<void> {
  if (!isDesktop() || !isImageAssetNode(node)) return;
  const n = node;
  if (!n.assetPath || n.dataUrl || n.url) return;
  const docPath = documentStore.currentFilePath();
  if (!docPath) return;
  try {
    const dir = await dirOfPath(docPath);
    const p = await joinPath(dir, ...n.assetPath.split("/"));
    if (!(await pathExists(p))) return;
    const bytes = await readBinaryFilePath(p);
    const ext = splitExt(n.assetPath).ext;
    n.dataUrl = bytesToDataUrl(bytes, EXT_TO_MIME[ext] ?? "image/png");
    if (!n.fileName) n.fileName = sanitizeName(n.assetPath);
    void getArea()?.rerenderNode(n.id);
    void processGraph(n.id);
  } catch (e) {
    console.error(`[solenoid] couldn't load bundled image "${n.assetPath}"`, e);
  }
}
