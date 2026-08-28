// JS highlighting for the Script node's source. The tokenizer is lezer's real
// JavaScript grammar (@lezer/javascript, the one CodeMirror ships); this module only
// maps its tags onto the formula surface's `.fx-tokens` classes and re-emits every
// character, so the highlighted <pre> mirrors the <textarea> exactly.
import { parser } from "@lezer/javascript";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";

const CLASSES = tagHighlighter([
  { tag: t.keyword, class: "fx-kw" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "fx-str" },
  { tag: t.number, class: "fx-num" },
  { tag: [t.bool, t.null, t.atom], class: "fx-const" },
  { tag: t.comment, class: "fx-comment" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "fx-fn" },
  { tag: [t.variableName, t.propertyName], class: "fx-var" },
  { tag: [t.operator, t.punctuation, t.bracket], class: "fx-op" },
]);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Highlight JavaScript → HTML (classed spans). Every input char is preserved. */
export function highlightJs(src: string): string {
  let out = "";
  let pos = 0;
  highlightTree(parser.parse(src), CLASSES, (from, to, cls) => {
    if (from > pos) out += esc(src.slice(pos, from));
    out += `<span class="${cls}">${esc(src.slice(from, to))}</span>`;
    pos = to;
  });
  if (pos < src.length) out += esc(src.slice(pos));
  return out;
}
