// [[B14]] oneDesignSystem (DESIGN.md § Voice)
// Catalog descriptions are inline markdown, projected to HTML for rich surfaces and to plain text for tooltips.
import { marked } from "marked";
import DOMPurify from "dompurify";

const _html = new Map<string, string>();

/** Memoized: the Inspector re-renders on a poll. */
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

export function descriptionText(md: string): string {
  return md
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
}
