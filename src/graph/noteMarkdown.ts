// [[C68]] knapIsTheDocumentSyntax, [[B1]] obsidianBet
import { Marked, type TokenizerAndRendererExtension, type Tokens } from "marked";
import { getKatexRenderer } from "./components/katexLoader";
import { TAG_BODY, isTagBody } from "./vaultCube";

const WIKILINK = /^(!?)\[\[([^[\]|#]+?)(#[^[\]|]+)?(?:\|([^[\]]+))?\]\]/;
const TAG = new RegExp(`^#(${TAG_BODY})`, "u");
const ERROR_CODE = /^#[A-Z][A-Z0-9/]*[!?]?$/;
const HIGHLIGHT = /^==([^\s=](?:[^\n]*?[^\s=])?)==/;
const MATH_INLINE = /^\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/;
const MATH_BLOCK = /^\$\$\n?([\s\S]+?)\n?\$\$(?:\n|$)/;
const CALLOUT_HEAD = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*/;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");


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
    if (!isTagBody(m[1])) return undefined;
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
  const katex = getKatexRenderer();
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

function blockquoteRenderer(this: { parser: { parse(tokens: Tokens.Generic[]): string; parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Blockquote): string | false {
  const first = token.tokens[0];
  if (!first || first.type !== "paragraph") return false;
  const para = first as Tokens.Paragraph;
  const lead = para.tokens[0];
  if (!lead || lead.type !== "text" || !CALLOUT_HEAD.test(lead.raw)) return false;
  const m = CALLOUT_HEAD.exec(lead.raw)!;
  const kind = m[1].toLowerCase();
  const spec = CALLOUT_KIND[kind] ?? CALLOUT_KIND.note;
  const rest = para.raw.slice(m[0].length);
  const nl = rest.indexOf("\n");
  const titleSrc = (nl === -1 ? rest : rest.slice(0, nl)).trim();
  const bodySrc = nl === -1 ? "" : rest.slice(nl + 1);
  const title = titleSrc ? noteMarked.parseInline(titleSrc, { async: false }) as string : esc(kind.charAt(0).toUpperCase() + kind.slice(1));
  const bodyTokens = [...(bodySrc.trim() ? noteMarked.lexer(bodySrc) : []), ...token.tokens.slice(1)];
  const body = bodyTokens.length ? `<div class="sol-md__callout-body">${this.parser.parse(bodyTokens as never)}</div>` : "";
  return `<div class="sol-md__callout sol-md__callout--${esc(kind)}${spec.danger ? " sol-md__callout--danger" : ""}"><div class="sol-md__callout-title">${calloutIcon(spec.icon)}<span>${title}</span></div>${body}</div>\n`;
}


function outsideFences(md: string, fn: (chunk: string) => string): string {
  const parts = md.split(/(^(?:```|~~~)[\s\S]*?^(?:```|~~~)[ \t]*$)/m);
  return parts.map((p, i) => (i % 2 === 1 ? p : fn(p))).join("");
}

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

export function renderNoteMarkdown(md: string): string {
  return noteMarked.parse(prepare(md), { async: false }) as string;
}
