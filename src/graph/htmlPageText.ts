// [[C68]] knapIsTheDocumentSyntax, [[reports-and-notes#HTML pages]], [[engineering#Untrusted content]]
// An HTML Page's text, before and after its Knap render: the page split from a whole document, its CSS scoped to the
// page and kept from fetching, a bare tag turned into the slot a value draws in. Pure: no DOM, so the tests run headless.

/** The class every page rule is scoped under, on the element the page draws in. */
export const PAGE_SCOPE = "sol-htmlpage__doc";
/** A bare tag after the render: the slot a value draws in. */
export const SLOT_ATTR = "data-sol-ref";

/** A tag's text in HTML (its name and attributes); the text between tags only reads like markup. */
const TAG_RE = /<[a-z][^>]*>/gi;

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

/** The render with a bare tag that landed inside a tag's attributes (`style="width: {{ pct }}%"`), where no value can
 *  draw, printed as `text` gives it instead: a slot belongs between tags. */
export function attributeSlotsAsText(rendered: string, text: (name: string) => string): string {
  return rendered.replace(TAG_RE, (tag) => tag.replace(/`=([A-Za-z_][A-Za-z0-9_]*)!?`/g, (_m, name: string) => text(name)));
}

/** The names of the bare tags that landed inside a tag's attributes. */
export function attributeSlots(rendered: string): string[] {
  const out = new Set<string>();
  for (const [tag] of rendered.matchAll(TAG_RE)) for (const m of tag.matchAll(/`=([A-Za-z_][A-Za-z0-9_]*)!?`/g)) out.add(m[1]);
  return [...out];
}

/** A selector list under the page's scope: `html`, `body` and `:root` name the page itself. `theme` limits it to the
 *  app's light or dark, at no extra specificity. */
function scopeSelectors(list: string, theme = ""): string {
  const scope = theme ? `:where(html[data-theme="${theme}"]) .${PAGE_SCOPE}` : `.${PAGE_SCOPE}`;
  return list
    .split(",")
    .map((raw) => {
      const sel = raw.trim();
      if (!sel) return sel;
      const self = /^(?::root|html|body)(?=$|[\s.#:[>+~])/i;
      if (self.test(sel)) {
        const rest = sel.replace(self, "").replace(/^\s*(html|body)(?=$|[\s.#:[>+~])/i, "");
        return `${scope}${rest}`;
      }
      return `${scope} ${sel}`;
    })
    .join(", ");
}

const SCHEME_RE = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/i;

/** The page's CSS with every rule scoped to the page, so it styles nothing else on screen, and nothing that fetches:
 *  `@import` goes, and a `url()` that isn't an inline image or font (a local file the card read is inline by now).
 *  `prefers-color-scheme` follows the app's light or dark, not the system's: the page sits in the app. */
export function scopeCss(css: string): string {
  const src = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\((?!\s*['"]?\s*data:(?:image|font)\/)\s*(['"]?)[^)]*\1\s*\)/gi, "none");
  let out = "";
  let i = 0;
  let theme = "";
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
      const scheme = /^@media\b/i.test(at) ? SCHEME_RE.exec(at) : null;
      if (scheme) {
        const rest = at.replace(/^@media\s*/i, "").replace(SCHEME_RE, "").replace(/^\s*and\s+|\s+and\s*$/gi, "").replace(/\band\s+and\b/gi, "and").trim();
        const outer = theme;
        theme = scheme[1].toLowerCase();
        if (rest) { out += `${head.match(/^\s*/)?.[0] ?? ""}@media ${rest} {`; block(depth + 1); }
        else { block(depth + 1); out = out.replace(/\}$/, ""); }
        theme = outer;
      } else if (/^@(media|supports|container|layer)\b/i.test(at)) {
        out += `${head}{`;
        block(depth + 1);
      } else if (at.startsWith("@")) {
        // @font-face, @keyframes and the rest hold declarations or frames, not selectors.
        const end = matching(open);
        out += `${head}${src.slice(open, end + 1)}`;
        i = end + 1;
      } else {
        const lead = head.match(/^\s*/)?.[0] ?? "";
        out += `${lead}${scopeSelectors(at, theme)} {`;
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
  return inDataFolder(clean, baseDir);
}

/** A relative path (or one from the data folder's root, with a leading `/`) as a data-folder path; none when it climbs
 *  out. */
function inDataFolder(path: string, baseDir: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  const parts = decoded.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of decoded.split(/[/\\]/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join("/");
}

/** Where a link in a page goes: a place on the page (`#id`), another page in the data folder (`team.html`, opened by
 *  the card that shows it, at its `#id` if it names one), or a web address, which opens outside the app. None for
 *  anything else: a page never moves the app's own address. */
export type PageLink = { anchor: string } | { page: string; anchor: string } | { web: string };

export function pageLink(href: string, baseDir: string): PageLink | null {
  const h = href.trim();
  if (h.startsWith("#")) { try { return { anchor: decodeURIComponent(h.slice(1)) }; } catch { return null; } }
  if (/^(https?:|mailto:)/i.test(h)) return { web: h };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//")) return null;
  const [path, hash = ""] = h.split("#");
  const clean = path.split("?")[0];
  if (!/\.html?$/i.test(clean)) return null;
  const page = inDataFolder(clean, baseDir);
  if (!page) return null;
  try { return { page, anchor: decodeURIComponent(hash) }; } catch { return { page, anchor: "" }; }
}

/** The folder a data-folder path sits in (`pages/team.html` → `pages`). */
export function dirOf(path: string): string {
  const i = path.replace(/\\/g, "/").lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

const SRC_RE = /(\b(?:src|poster)\s*=\s*)(["'])([^"']*)\2/gi;
const URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;

/** Every local file a page's text names, in a `src` or a CSS `url()`, as data-folder paths. In `html` only a tag names
 *  one: `&lt;img src="a.png"&gt;` shown as text on the page names nothing. */
export function assetRefs(text: string, baseDir: string, html = false): string[] {
  const out = new Set<string>();
  for (const part of html ? [...text.matchAll(TAG_RE)].map((m) => m[0]) : [text]) {
    for (const m of part.matchAll(SRC_RE)) { const p = localAssetPath(m[3], baseDir); if (p) out.add(p); }
    for (const m of part.matchAll(URL_RE)) { const p = localAssetPath(m[2], baseDir); if (p) out.add(p); }
  }
  return [...out];
}

/** The text with each local file it names replaced by that file inline (`data` holds each path's data: URI); a file
 *  `data` lacks is left as written, so it shows as missing rather than as something else. */
export function withAssets(text: string, baseDir: string, data: ReadonlyMap<string, string>, html = false): string {
  const inline = (ref: string) => { const p = localAssetPath(ref, baseDir); return p ? data.get(p) : undefined; };
  const swap = (part: string) => part
    .replace(SRC_RE, (m, lead: string, q: string, ref: string) => { const d = inline(ref); return d ? `${lead}${q}${d}${q}` : m; })
    .replace(URL_RE, (m, _q: string, ref: string) => { const d = inline(ref); return d ? `url("${d}")` : m; });
  return html ? text.replace(TAG_RE, swap) : swap(text);
}

/** A file's bytes as a data: URI of its type. */
export function assetDataUri(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** The page a new card starts from: one of each kind of tag, so the card shows an input of each at once. */
export const STARTER_HTML = `<!doctype html>
<html><body>
<article>
  <h1>{{ title }}</h1>
  <p>A tag on its own, like the title above, draws a value as the canvas does. A tag with a filter prints text:
  {{ title | upper }}.</p>

  <!-- A chart, table or picture wired in draws as a box. -->
  {{ figure }}

  <!-- A Frame wired in is rows to loop over. A row prints as its fields; row.Name in a tag prints one column. -->
  <ul>
  {% for row in rows %}  <li>{{ row }}</li>
  {% endfor %}</ul>
</article>
</body></html>
`;

export const STARTER_CSS = `/* Scoped to this page. Set the app's variables (--surface, --text, --chart-1, --font-sans) to restyle its boxes. */
:root { --chart-1: #2f6fde; }
body { font-family: var(--font-sans); line-height: 1.55; }
article { max-width: 720px; margin: 0 auto; }
h1 { text-wrap-style: balance; }
@media (prefers-color-scheme: light) { body { color: #1d1d1f; } }
`;

/** The first free name for a new page in \`pages/\`, among the data folder's files. */
export function starterName(existing: readonly string[]): string {
  const taken = new Set(existing.map((f) => f.toLowerCase()));
  for (let n = 1; ; n++) {
    const base = `pages/page${n === 1 ? "" : `-${n}`}`;
    if (!taken.has(`${base}.html`) && !taken.has(`${base}.css`)) return base;
  }
}
