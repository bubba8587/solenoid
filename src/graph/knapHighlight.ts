// Syntax highlight for a Report's source pane: Markdown structure (headings, list
// markers, quotes, fences, emphasis, inline code, links) and, inside every `{{ … }}`
// and `{% … %}` tag, Knap's own tokens on the formula surface's `.fx-tokens` classes
// (keyword, filter, string, number, constant, variable, operator). Output is HTML for
// the highlighted backdrop a transparent textarea sits over, so EVERY character of the
// source is preserved (spans only), escaped first.

const TAG_RE = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g;
const HOLD = "\u0000";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const span = (cls: string, text: string) => `<span class="${cls}">${text}</span>`;

const KEYWORDS = new Set(["if", "elseif", "else", "endif", "for", "in", "endfor", "set"]);
const CONSTANTS = new Set(["true", "false", "null"]);
// One token at a time, in precedence order; every char lands in exactly one match.
const TAG_TOKEN_RE = /(\{\{|\}\}|\{%|%\}|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\s+|=>|[^\sA-Za-z0-9_"']+?)/g;

/** A tag's inner HTML: delimiters and operators as `fx-op`, keywords `fx-kw`, the name
 *  after a `|` as `fx-fn`, quoted strings `fx-str`, numbers `fx-num`, `true`/`false`/`null`
 *  `fx-const`, any other identifier `fx-var`. */
function highlightTag(tag: string): string {
  let out = "";
  let afterPipe = false;
  for (const m of tag.matchAll(TAG_TOKEN_RE)) {
    const t = m[0];
    const e = esc(t);
    if (/^\s+$/.test(t)) { out += e; continue; }
    if (t === "{{" || t === "}}" || t === "{%" || t === "%}") { out += span("fx-op", e); afterPipe = false; continue; }
    if (t[0] === '"' || t[0] === "'") { out += span("fx-str", e); afterPipe = false; continue; }
    if (/^\d/.test(t)) { out += span("fx-num", e); afterPipe = false; continue; }
    if (/^[A-Za-z_]/.test(t)) {
      const cls = afterPipe ? "fx-fn" : KEYWORDS.has(t) ? "fx-kw" : CONSTANTS.has(t) ? "fx-const" : "fx-var";
      out += span(cls, e);
      afterPipe = false;
      continue;
    }
    out += span("fx-op", e);
    afterPipe = t === "|";
  }
  return span("knap-tag", out);
}

// Inline Markdown on ESCAPED text (none of these markers are HTML-special).
const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|!?\[\[[^\]\n]+\]\]|!?\[[^\]\n]*\]\([^)\n]*\))/g;
function inline(text: string): string {
  return text.replace(INLINE_RE, (m) => {
    if (m[0] === "`") return span("md-code", m);
    if (m.startsWith("**") || m.startsWith("__")) return span("md-strong", m);
    if (m[0] === "*" || m[0] === "_") return span("md-em", m);
    return span("md-link", m);
  });
}

/** Line-aware Markdown: fences hold everything as code; a heading line colors whole;
 *  list markers and quote marks color on their own; the rest gets inline marks. */
function highlightMarkdown(text: string): string {
  let fenced = false;
  return text.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return span("md-fence", line); }
    if (fenced) return span("md-code", line);
    const h = /^(#{1,6}\s)(.*)$/.exec(line);
    if (h) return span("md-heading", line);
    const q = /^(\s*&gt;\s?)(.*)$/.exec(line);
    if (q) return span("md-quote", q[1]) + inline(q[2]);
    const l = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)(.*)$/.exec(line);
    if (l) return span("md-list", l[1]) + inline(l[2]);
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return span("md-fence", line);
    return inline(line);
  }).join("\n");
}

/** The pane's backdrop HTML. Tags are lifted out first so Markdown's line rules see
 *  the prose around them, then dropped back in highlighted. Ends with a newline so the
 *  backdrop's height matches the textarea's when the source ends on an empty line. */
export function highlightKnap(source: string): string {
  const tags: string[] = [];
  const held = source.replace(TAG_RE, (tag) => { tags.push(tag); return `${HOLD}${tags.length - 1}${HOLD}`; });
  const md = highlightMarkdown(esc(held));
  return md.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => highlightTag(tags[Number(i)])) + "\n";
}
