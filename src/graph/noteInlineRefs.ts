// [[C68]] knapIsTheDocumentSyntax

const REF_RE = /`=([A-Za-z_][A-Za-z0-9_]*)!?`/g;

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
