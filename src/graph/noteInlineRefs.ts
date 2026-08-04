// A `` `=name` `` code span in a Note body mints an INPUT socket; same identifier
// grammar as Expression's bare names, but a ref is a NAME, never an expression.
// The trailing `!` (`=name!`) is display-only highlighting, kept OUT of the
// identifier so `=rate` and `=rate!` share one input.

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
