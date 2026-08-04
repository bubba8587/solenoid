// A Report embeds a Note wherever the author writes `![[Note Name]]`; the token
// names it by DISPLAY name. Pure string helpers, shared by the live overlay and the
// static export.

// One line only (a note name never spans lines); `!` separates an embed from a
// future `[[link]]`.
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

/** Replace each token with a marker the rendered-HTML scanner portals into. MUST run
 *  BEFORE markdown parsing so marked wraps the marker in its own block structure; the
 *  marker carries only a data-embed attribute, never raw note content. */
export function preprocessEmbeds(body: string): string {
  return body.replace(EMBED_RE, (_m, name: string) =>
    `<span class="sol-embed-slot" data-embed="${escapeAttr(name.trim())}"></span>`);
}
