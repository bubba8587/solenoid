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
 *  `@import` goes, and a `url()` that isn't an inline image or font (a local file the card read is inline by now). */
export function scopeCss(css: string): string {
  const src = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\((?!\s*['"]?\s*data:(?:image|font)\/)\s*(['"]?)[^)]*\1\s*\)/gi, "none");
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

/** The files a page may draw from the data folder, by extension: pictures and fonts, nothing that runs. */
export const ASSET_TYPES: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  svg: "image/svg+xml", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
};

/** A file the page names, as a path in the data folder: relative to the folder of the file it's written in, or from the
 *  data folder's root with a leading `/`. None for an address with a scheme (`https:`, `data:`), a kind not in
 *  ASSET_TYPES, or a path that climbs out of the data folder. */
export function localAssetPath(ref: string, baseDir: string): string | null {
  const r = ref.trim();
  if (!r || /^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith("//") || r.startsWith("#")) return null;
  const clean = r.split(/[?#]/)[0];
  const ext = (/\.([a-z0-9]+)$/i.exec(clean)?.[1] ?? "").toLowerCase();
  if (!(ext in ASSET_TYPES)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(clean); } catch { return null; }
  const parts = decoded.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of decoded.split(/[/\\]/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join("/");
}

/** The folder a data-folder path sits in (`pages/team.html` → `pages`). */
export function dirOf(path: string): string {
  const i = path.replace(/\\/g, "/").lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

const SRC_RE = /(\b(?:src|poster)\s*=\s*)(["'])([^"']*)\2/gi;
const URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;

/** Every local file a page's text names, in a `src` or a CSS `url()`, as data-folder paths. */
export function assetRefs(text: string, baseDir: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(SRC_RE)) { const p = localAssetPath(m[3], baseDir); if (p) out.add(p); }
  for (const m of text.matchAll(URL_RE)) { const p = localAssetPath(m[2], baseDir); if (p) out.add(p); }
  return [...out];
}

/** The text with each local file it names replaced by that file inline (`data` holds each path's data: URI); a file
 *  `data` lacks is left as written, so it shows as missing rather than as something else. */
export function withAssets(text: string, baseDir: string, data: ReadonlyMap<string, string>): string {
  const inline = (ref: string) => { const p = localAssetPath(ref, baseDir); return p ? data.get(p) : undefined; };
  return text
    .replace(SRC_RE, (m, lead: string, q: string, ref: string) => { const d = inline(ref); return d ? `${lead}${q}${d}${q}` : m; })
    .replace(URL_RE, (m, _q: string, ref: string) => { const d = inline(ref); return d ? `url("${d}")` : m; });
}

/** A file's bytes as a data: URI of its type. */
export function assetDataUri(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}
