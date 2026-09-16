// SVG markup a user pastes, uploads or fetches is inlined into the live DOM by the SVG
// Picker (hit-testing needs real elements), and it persists in the document, so a shared
// .solenoid file could carry a handler or a beacon. The scrub runs ONCE at intake, on the
// text, in two layers: a pure pass that works headless (and is what the tests pin), then
// DOMPurify's SVG profile wherever a DOM exists.
import DOMPurify from "dompurify";

const DROP_ELEMENTS = ["script", "foreignObject", "iframe", "object", "embed", "style"];

/** The text-level pass: scripting elements, on* handlers, javascript: URLs and every
 *  external reference (image / use href) go; ids, names, classes, paths and fills stay. */
export function scrubSvgText(text: string): string {
  let out = text;
  for (const tag of DROP_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  // on* handler attributes, quoted or bare.
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // href / xlink:href on any element (a use / image beacon, an anchor); an inline
  // `#fragment` reference (a <use> of a local symbol) is kept.
  out = out.replace(/\s+(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, d, s) => {
    const v = (d ?? s ?? "").trim();
    return v.startsWith("#") ? m : "";
  });
  // javascript: / data:text/html in any remaining attribute value.
  out = out.replace(/\s+([a-z:-]+)\s*=\s*("\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*')/gi, "");
  return out;
}

/** The intake sanitizer: the text pass, then DOMPurify's SVG profile when a DOM exists
 *  (headless, DOMPurify reports unsupported and the text pass stands alone). */
export function sanitizeSvg(text: string): string {
  const scrubbed = scrubSvgText(text);
  if (!DOMPurify.isSupported) return scrubbed;
  return DOMPurify.sanitize(scrubbed, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "style"],
  }); // external href / xlink:href already went in the text pass; a local #fragment stays
}
