// The markdown renderer for NOTE-shaped text (Note, Import Obsidian Note, Report, a
// wired document embed, the webpage export): GFM plus Obsidian's own forms —
// `[[wikilinks]]`, `#tags`, `==highlights==`, `> [!kind]` callouts, `$math$` /
// `$$math$$` (KaTeX, once loaded), `%% comments %%` (hidden) and
// trailing `^block-ids` (hidden) — decorated as elements the stylesheet dresses
// (`.sol-md__*`). Its own Marked instance, so help prose and catalog descriptions
// (`Markdown.tsx`, `descriptionMd.ts`) stay untouched: an error code like `#NAME?` in
// a description is not a tag. Pure apart from the KaTeX lookup; callers sanitize.
import { Marked, type TokenizerAndRendererExtension, type Tokens } from "marked";
import { getKatexRenderer } from "./components/katexLoader";

const WIKILINK = /^(!?)\[\[([^[\]|#]+?)(#[^[\]|]+)?(?:\|([^[\]]+))?\]\]/;
// A tag: `#` then a letter or underscore, then letters, digits, `_`, `-` or `/`.
const TAG = /^#([\p{L}_][\p{L}\p{N}_\-/]*)/u;
// A Solenoid / Excel error code (`#NAME?`, `#DIV/0!`, `#N/A`) is never a tag.
const ERROR_CODE = /^#[A-Z][A-Z0-9/]*[!?]?$/;
const HIGHLIGHT = /^==([^\s=](?:[^\n]*?[^\s=])?)==/;
// Inline math: `$…$` with no space just inside either `$` and no digit right after.
const MATH_INLINE = /^\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/;
const MATH_BLOCK = /^\$\$\n?([\s\S]+?)\n?\$\$(?:\n|$)/;
const CALLOUT_HEAD = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*/;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─── Inline forms ─────────────────────────────────────────────────────────────

interface WikilinkToken extends Tokens.Generic { type: "wikilink"; target: string; heading: string; alias: string; embed: boolean }
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

interface TagToken extends Tokens.Generic { type: "hashtag"; tag: string }
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
    return `<span class="sol-md__tag">#${esc((token as TagToken).tag)}</span>`;
  },
};

interface HighlightToken extends Tokens.Generic { type: "highlight"; tokens: Tokens.Generic[] }
const highlight: TokenizerAndRendererExtension = {
  name: "highlight",
  level: "inline",
  start: (src) => src.indexOf("=="),
  tokenizer(src): HighlightToken | undefined {
    const m = HIGHLIGHT.exec(src);
    if (!m) return undefined;
    return { type: "highlight", raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
  },
  renderer(token) {
    return `<mark class="sol-md__hl">${this.parser.parseInline((token as HighlightToken).tokens as Tokens.Generic[] as never)}</mark>`;
  },
};

interface MathToken extends Tokens.Generic { type: "mathInline" | "mathBlock"; tex: string }
function renderMath(tex: string, display: boolean): string {
  const katex = getKatexRenderer(); // null until the chunk lands; the sites re-render then
  const cls = `sol-md__math${display ? " sol-md__math--block" : ""}`;
  if (!katex) return `<span class="${cls} sol-md__math--pending">${esc(display ? `$$${tex}$$` : `$${tex}$`)}</span>`;
  try {
    return `<span class="${cls}">${katex(tex, { displayMode: display, throwOnError: false })}</span>`;
  } catch {
    return `<span class="${cls} sol-md__math--error">${esc(tex)}</span>`;
  }
}
const mathInline: TokenizerAndRendererExtension = {
  name: "mathInline",
  level: "inline",
  start: (src) => src.indexOf("$"),
  tokenizer(src): MathToken | undefined {
    if (src.startsWith("$$")) return undefined;
    const m = MATH_INLINE.exec(src);
    return m ? { type: "mathInline", raw: m[0], tex: m[1] } : undefined;
  },
  renderer(token) { return renderMath((token as MathToken).tex, false); },
};
const mathBlock: TokenizerAndRendererExtension = {
  name: "mathBlock",
  level: "block",
  start: (src) => src.indexOf("$$"),
  tokenizer(src): MathToken | undefined {
    const m = MATH_BLOCK.exec(src);
    return m ? { type: "mathBlock", raw: m[0], tex: m[1].trim() } : undefined;
  },
  renderer(token) { return `<div class="sol-md__math-row">${renderMath((token as MathToken).tex, true)}</div>\n`; },
};

// ─── Callouts: a blockquote whose first line is `[!kind] Title` ──────────────────

/** Kind → icon group (the Lucide glyph the title carries) and whether it reads as danger. */
const CALLOUT_KIND: Record<string, { icon: string; danger?: boolean }> = {
  note: { icon: "pencil" }, abstract: { icon: "list" }, summary: { icon: "list" }, tldr: { icon: "list" },
  info: { icon: "info" }, todo: { icon: "check" }, tip: { icon: "flame" }, hint: { icon: "flame" }, important: { icon: "flame" },
  success: { icon: "check" }, check: { icon: "check" }, done: { icon: "check" },
  question: { icon: "help" }, help: { icon: "help" }, faq: { icon: "help" },
  warning: { icon: "alert" }, caution: { icon: "alert" }, attention: { icon: "alert" },
  failure: { icon: "x", danger: true }, fail: { icon: "x", danger: true }, missing: { icon: "x", danger: true },
  danger: { icon: "zap", danger: true }, error: { icon: "zap", danger: true }, bug: { icon: "bug", danger: true },
  example: { icon: "list" }, quote: { icon: "quote" }, cite: { icon: "quote" },
};
const ICON_PATH: Record<string, string> = {
  pencil: "M21.17 6.83a2.5 2.5 0 0 0-3.54-3.54L4 17v3h3z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  info: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  check: "M20 6 9 17l-5-5",
  flame: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  help: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  alert: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01",
  x: "M18 6 6 18M6 6l12 12",
  zap: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  bug: "m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4",
  quote: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2zM5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
};
const calloutIcon = (name: string) =>
  `<svg class="sol-md__callout-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATH[name]}"/></svg>`;

/** A blockquote opening with `[!kind] Title` renders as a callout: the kind picks the
 *  icon (and the danger ink), the rest of the first line is the title (the kind's
 *  name when blank), the remaining lines the body. Any other blockquote is untouched. */
function blockquoteRenderer(this: { parser: { parse(tokens: Tokens.Generic[]): string; parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Blockquote): string | false {
  const first = token.tokens[0];
  if (!first || first.type !== "paragraph") return false;
  const para = first as Tokens.Paragraph;
  const lead = para.tokens[0];
  if (!lead || lead.type !== "text" || !CALLOUT_HEAD.test(lead.raw)) return false;
  const m = CALLOUT_HEAD.exec(lead.raw)!;
  const kind = m[1].toLowerCase();
  const spec = CALLOUT_KIND[kind] ?? CALLOUT_KIND.note;
  // Split the paragraph at its first line break: title inline tokens, then the rest.
  const rest = para.raw.slice(m[0].length);
  const nl = rest.indexOf("\n");
  const titleSrc = (nl === -1 ? rest : rest.slice(0, nl)).trim();
  const bodySrc = nl === -1 ? "" : rest.slice(nl + 1);
  const title = titleSrc ? noteMarked.parseInline(titleSrc, { async: false }) as string : esc(kind.charAt(0).toUpperCase() + kind.slice(1));
  const bodyTokens = [...(bodySrc.trim() ? noteMarked.lexer(bodySrc) : []), ...token.tokens.slice(1)];
  const body = bodyTokens.length ? `<div class="sol-md__callout-body">${this.parser.parse(bodyTokens as never)}</div>` : "";
  return `<div class="sol-md__callout sol-md__callout--${esc(kind)}${spec.danger ? " sol-md__callout--danger" : ""}"><div class="sol-md__callout-title">${calloutIcon(spec.icon)}<span>${title}</span></div>${body}</div>\n`;
}

// ─── Pre-parse: comments and block ids ───────────────────────────────────────────

/** Split on fenced code so a transform never touches a fence's contents. */
function outsideFences(md: string, fn: (chunk: string) => string): string {
  const parts = md.split(/(^(?:```|~~~)[\s\S]*?^(?:```|~~~)[ \t]*$)/m);
  return parts.map((p, i) => (i % 2 === 1 ? p : fn(p))).join("");
}

// A comment on a line of its own takes the line with it; an inline one just vanishes.
const COMMENT_LINE = /^[ \t]*%%[\s\S]*?%%[ \t]*(?:\n|$)/gm;
const COMMENT = /%%[\s\S]*?%%/g;
const BLOCK_ID = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm;

function prepare(md: string): string {
  return outsideFences(md, (chunk) => chunk.replace(COMMENT_LINE, "").replace(COMMENT, "").replace(BLOCK_ID, ""));
}

const noteMarked = new Marked({
  gfm: true,
  breaks: true,
  extensions: [wikilink, hashtag, highlight, mathInline, mathBlock],
  renderer: { blockquote: blockquoteRenderer as never },
});

/** Note-shaped markdown → HTML (unsanitized: the caller runs DOMPurify, as every render
 *  site does). Math renders through KaTeX once its chunk has loaded; before that the
 *  source shows verbatim and a subscribed site re-renders when it lands. */
export function renderNoteMarkdown(md: string): string {
  return noteMarked.parse(prepare(md), { async: false }) as string;
}
