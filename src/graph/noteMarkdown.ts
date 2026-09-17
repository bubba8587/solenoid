// The markdown renderer for NOTE-shaped text (Note, Import Obsidian Note, Report, a
// wired document embed, the webpage export): GFM plus two Obsidian inline forms —
// `[[Target|Alias]]` wikilinks and `#tags` — decorated as spans the stylesheet dresses
// (`.sol-md__wikilink`, `.sol-md__tag`). Its own Marked instance, so help prose and
// catalog descriptions (`Markdown.tsx`, `descriptionMd.ts`) stay untouched: an error
// code like `#NAME?` in a description is not a tag. Pure; callers sanitize.
import { Marked, type TokenizerAndRendererExtension, type Tokens } from "marked";

const WIKILINK = /^(!?)\[\[([^[\]|#]+?)(#[^[\]|]+)?(?:\|([^[\]]+))?\]\]/;
// A tag: `#` then a letter or underscore, then letters, digits, `_`, `-` or `/`.
const TAG = /^#([\p{L}_][\p{L}\p{N}_\-/]*)/u;
// A Solenoid / Excel error code (`#NAME?`, `#DIV/0!`, `#N/A`) is never a tag.
const ERROR_CODE = /^#[A-Z][A-Z0-9/]*[!?]?$/;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface WikilinkToken extends Tokens.Generic { type: "wikilink"; target: string; heading: string; alias: string; embed: boolean }
interface TagToken extends Tokens.Generic { type: "hashtag"; tag: string }

const wikilink: TokenizerAndRendererExtension = {
  name: "wikilink",
  level: "inline",
  start: (src) => src.indexOf("[["),
  tokenizer(src): WikilinkToken | undefined {
    const m = WIKILINK.exec(src);
    if (!m) return undefined;
    return { type: "wikilink", raw: m[0], embed: m[1] === "!", target: m[2].trim(), heading: (m[3] ?? "").trim(), alias: (m[4] ?? "").trim() };
  },
  renderer(token) {
    const t = token as WikilinkToken;
    const text = t.alias || (t.heading ? `${t.target}${t.heading}` : t.target);
    return `<span class="sol-md__wikilink${t.embed ? " sol-md__wikilink--embed" : ""}" title="${esc(t.target + t.heading)}">${esc(text)}</span>`;
  },
};

const hashtag: TokenizerAndRendererExtension = {
  name: "hashtag",
  level: "inline",
  // Only a `#` opening a word: at the start, or after whitespace or an opening bracket.
  start(src) {
    for (let i = src.indexOf("#"); i !== -1; i = src.indexOf("#", i + 1)) {
      if (i === 0 || /[\s([{]/.test(src[i - 1])) return i;
    }
    return -1;
  },
  tokenizer(src): TagToken | undefined {
    const m = TAG.exec(src);
    if (!m) return undefined;
    const after = src[m[0].length] ?? "";
    if (ERROR_CODE.test(m[0] + (after === "!" || after === "?" ? after : ""))) return undefined;
    if (/^\p{N}+$/u.test(m[1])) return undefined; // a bare number is a heading count, not a tag
    return { type: "hashtag", raw: m[0], tag: m[1] };
  },
  renderer(token) {
    const t = token as TagToken;
    return `<span class="sol-md__tag">#${esc(t.tag)}</span>`;
  },
};

const noteMarked = new Marked({ gfm: true, breaks: true, extensions: [wikilink, hashtag] });

/** Note-shaped markdown → HTML (unsanitized: the caller runs DOMPurify, as every render site does). */
export function renderNoteMarkdown(md: string): string {
  return noteMarked.parse(md, { async: false }) as string;
}
