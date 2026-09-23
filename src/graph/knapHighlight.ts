// [[C68]] knapIsTheDocumentSyntax

const TAG_RE = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\})/g;
const HOLD = "\u0000";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const span = (cls: string, text: string) => `<span class="${cls}">${text}</span>`;

const KEYWORDS = new Set(["if", "elseif", "else", "endif", "for", "in", "endfor", "set"]);
const CONSTANTS = new Set(["true", "false", "null"]);
// One token at a time, in precedence order; every character lands in exactly one match.
const TAG_TOKEN_RE = /(\{\{|\}\}|\{%|%\}|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\s+|=>|[^\sA-Za-z0-9_"']+?)/g;

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

const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|!?\[\[[^\]\n]+\]\]|!?\[[^\]\n]*\]\([^)\n]*\))/g;
function inline(text: string): string {
  return text.replace(INLINE_RE, (m) => {
    if (m[0] === "`") return span("md-code", m);
    if (m.startsWith("**") || m.startsWith("__")) return span("md-strong", m);
    if (m[0] === "*" || m[0] === "_") return span("md-em", m);
    return span("md-link", m);
  });
}

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

/** Ends with a newline so the backdrop's height matches the textarea's when the source ends on an empty line. */
export function highlightKnap(source: string): string {
  const tags: string[] = [];
  const held = source.replace(TAG_RE, (tag) => { tags.push(tag); return `${HOLD}${tags.length - 1}${HOLD}`; });
  const md = highlightMarkdown(esc(held));
  return md.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => {
    const tag = tags[Number(i)];
    return tag.startsWith("{#") ? span("fx-comment", esc(tag)) : highlightTag(tag);
  }) + "\n";
}
