// The INTERNAL ref span. Nobody types it: a Report's Knap render rewrites a bare
// `{{ name }}` to `` `=name` `` (knapTemplate.ts embedBareVariables) and the span then
// resolves by kind — inlineRefDisplay.tsx on screen, obsidianMarkdown.ts at write,
// reportExport.ts at export. Same identifier grammar as Expression's bare names. The
// trailing `!` (`=name!`, from `{{ name | highlight }}`) is display-only tinting,
// kept OUT of the identifier so `=rate` and `=rate!` share one input.

const REF_RE = /`=([A-Za-z_][A-Za-z0-9_]*)!?`/g;

/** Ordered, de-duplicated ref names found in a RENDERED body (first-seen order). */
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
