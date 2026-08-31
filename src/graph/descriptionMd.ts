// Catalog descriptions are inline MARKDOWN (`code`, **bold**, *italic*) with two
// projections: HTML for the rich surfaces (Inspector, Function Reference) and plain
// text for title-attribute tooltips, which render no markup.
import { marked } from "marked";
import DOMPurify from "dompurify";

const _html = new Map<string, string>();

/** Inline markdown → sanitized HTML. Memoized: the Inspector re-renders on a poll. */
export function descriptionHtml(md: string): string {
  const hit = _html.get(md);
  if (hit !== undefined) return hit;
  const html = DOMPurify.sanitize(marked.parseInline(md, { async: false }) as string, {
    ALLOWED_TAGS: ["code", "strong", "em", "b", "i", "br"],
    ALLOWED_ATTR: [],
  });
  if (_html.size > 512) _html.clear();
  _html.set(md, html);
  return html;
}

/** The same string with the markdown marks removed, for `title=` tooltips. */
export function descriptionText(md: string): string {
  return md
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
}
