// [[C68]] knapIsTheDocumentSyntax, [[reports-and-notes#HTML pages]], [[engineering#Untrusted content]]
// An HTML Page's text, before and after its Knap render: the page split from a whole document, its CSS scoped to the
// page and kept from fetching, a bare tag turned into the slot a value draws in. Pure: no DOM, so the tests run headless.

/** The class every page rule is scoped under, on the element the page draws in. */
export const PAGE_SCOPE = "sol-htmlpage__doc";
/** A bare tag after the render: the slot a value draws in. */
export const SLOT_ATTR = "data-sol-ref";

/** A whole document's body and its `<style>` blocks; a fragment is its own body. Scripts and links never survive the
 *  sanitizer, so they aren't looked for here. */
export function pageParts(html: string): { body: string; styles: string[] } {
  const styles: string[] = [];
  const noStyles = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, css: string) => {
    styles.push(css);
    return "";
  });
  const body = /<body\b[^>]*>([\s\S]*?)(<\/body\s*>|$)/i.exec(noStyles)?.[1]
    ?? noStyles.replace(/<!doctype[^>]*>/i, "").replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, "").replace(/<\/?html\b[^>]*>/gi, "");
  return { body: body.trim(), styles };
}

/** Text as HTML text: a value printed into the page reads as what it says, never as markup. */
export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The render's bare-tag spans (`` `=name` ``, `embedBareVariables`) as slots: an element the page's value draws in. */
export function slotsFor(rendered: string): string {
  return rendered.replace(/`=([A-Za-z_][A-Za-z0-9_]*)(!?)`/g, (_m, name: string, hl: string) =>
    `<span ${SLOT_ATTR}="${name}"${hl ? ` data-sol-hl="1"` : ""}></span>`);
}

/** A selector list under the page's scope: `html`, `body` and `:root` name the page itself. */
function scopeSelectors(list: string): string {
  return list
    .split(",")
    .map((raw) => {
      const sel = raw.trim();
      if (!sel) return sel;
      const self = /^(?::root|html|body)(?=$|[\s.#:[>+~])/i;
      if (self.test(sel)) {
        const rest = sel.replace(self, "").replace(/^\s*(html|body)(?=$|[\s.#:[>+~])/i, "");
        return `.${PAGE_SCOPE}${rest}`;
      }
      return `.${PAGE_SCOPE} ${sel}`;
    })
    .join(", ");
}

/** The page's CSS with every rule scoped to the page, so it styles nothing else on screen, and nothing that fetches:
 *  `@import` goes, and a `url()` that isn't an inline image. */
export function scopeCss(css: string): string {
  const src = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\1\s*\)/gi, "none");
  let out = "";
  let i = 0;
  const block = (depth: number): void => {
    while (i < src.length) {
      const open = src.indexOf("{", i);
      const close = src.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) {
        out += src.slice(i, close + 1);
        i = close + 1;
        if (depth > 0) return;
        continue;
      }
      if (open === -1) { out += src.slice(i); i = src.length; return; }
      const head = src.slice(i, open);
      const at = head.trim();
      i = open + 1;
      if (/^@(media|supports|container|layer)\b/i.test(at)) {
        out += `${head}{`;
        block(depth + 1);
      } else if (at.startsWith("@")) {
        // @font-face, @keyframes and the rest hold declarations or frames, not selectors.
        const end = matching(open);
        out += `${head}${src.slice(open, end + 1)}`;
        i = end + 1;
      } else {
        const lead = head.match(/^\s*/)?.[0] ?? "";
        out += `${lead}${scopeSelectors(at)} {`;
        const end = src.indexOf("}", i);
        out += src.slice(i, end === -1 ? src.length : end + 1);
        i = end === -1 ? src.length : end + 1;
      }
    }
  };
  const matching = (from: number): number => {
    let d = 0;
    for (let k = from; k < src.length; k++) {
      if (src[k] === "{") d++;
      else if (src[k] === "}" && --d === 0) return k;
    }
    return src.length - 1;
  };
  block(0);
  return out.trim();
}
