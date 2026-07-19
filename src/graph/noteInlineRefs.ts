// ─── Note inline refs → typed INPUT sockets ───────────────────────────────────
// A Note body may reference a graph value inline, Obsidian-style, as a backtick
// code span whose text is exactly `=name` (e.g. "Revenue was `=revenue` last
// quarter."). Each distinct name mints an INPUT socket on the Note — mirroring
// ExpressionNode's bare-name pattern (extractVariables in excelFormula.ts): same
// identifier grammar ([A-Za-z_][A-Za-z0-9_]*), but no expression grammar at all —
// a ref is just a name, not a formula to evaluate. Pure parser, fully unit-tested;
// NoteNode (nodes/annotation.ts) owns the socket lifecycle, NoteNode.tsx renders
// the live value in place of the code span (DOM-portal swap after markdown render).
//
// A trailing `!` flag (`=name!`) HIGHLIGHTS the rendered value (an accent-tinted
// mark, like Obsidian's ==mark==) — display-only: the socket key is the bare name,
// so `=rate` and `=rate!` share one input. Kept out of the identifier so the
// grammar stays in lockstep with obsidianMarkdown.ts / inlineRefDisplay.tsx.

const REF_RE = /`=([A-Za-z_][A-Za-z0-9_]*)!?`/g;

/** Ordered, de-duplicated ref names found in a note body (first-seen order). */
export function extractInlineRefs(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(REF_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}
