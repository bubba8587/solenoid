// ─── Report embeds via inline markdown tokens ─────────────────────────────────
// A Report places an embedded Note where the author writes `![[Note Name]]`
// (Obsidian-style), NOT in a fixed bottom strip — the author controls position
// in the markdown, like every other block. The token names a Note by its
// display name (nodeDisplayNames). Pure string helpers so they're testable in
// the node vitest env and reusable by both the live overlay and the static
// export.

// Name = anything up to the closing `]]`, on one line (a note name never spans
// lines). Trimmed at use. `!` distinguishes an embed from a future `[[link]]`.
export const EMBED_RE = /!\[\[([^\]\n]+)\]\]/g;

/** Ordered, de-duplicated embed names referenced in a body (first-seen order). */
export function extractEmbedNames(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(EMBED_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1].trim();
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Replace every `![[Name]]` token with a marker element the rendered-HTML
 * scanner (InlineRefBody) finds and portals the embed block into. Run BEFORE
 * markdown parsing so marked wraps the marker in its paragraph/list structure
 * (keeping placement intact); the marker is a bare element with a data-embed
 * attribute (DOMPurify keeps data-* + class), never raw note content.
 */
export function preprocessEmbeds(body: string): string {
  return body.replace(EMBED_RE, (_m, name: string) =>
    `<span class="sol-embed-slot" data-embed="${escapeAttr(name.trim())}"></span>`);
}
