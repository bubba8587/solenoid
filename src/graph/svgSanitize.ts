// [[C103]] untrustedContentSeams
import DOMPurify from "dompurify";

const DROP_ELEMENTS = ["script", "foreignObject", "iframe", "object", "embed", "style"];

export function scrubSvgText(text: string): string {
  let out = text;
  for (const tag of DROP_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/\s+(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, d, s) => {
    const v = (d ?? s ?? "").trim();
    return v.startsWith("#") ? m : "";
  });
  out = out.replace(/\s+([a-z:-]+)\s*=\s*("\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*')/gi, "");
  return out;
}

export function sanitizeSvg(text: string): string {
  const scrubbed = scrubSvgText(text);
  if (!DOMPurify.isSupported) return scrubbed;
  return DOMPurify.sanitize(scrubbed, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "style"],
  });
}
