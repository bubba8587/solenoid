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

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const CODE_REF_RE = /(<p>)?<code>=([A-Za-z_][A-Za-z0-9_]*)(!?)<\/code>(<\/p>)?/g;

/** A block result that fills its paragraph replaces the paragraph; null leaves the span. */
export function substituteRefCodes(
  html: string,
  render: (name: string, highlight: boolean) => { html: string; block?: boolean } | null,
): string {
  return html.replace(CODE_REF_RE, (full, open: string | undefined, name: string, hl: string, close: string | undefined) => {
    const r = render(name, hl === "!");
    if (!r) return full;
    if (r.block && open && close) return r.html;
    return `${open ?? ""}${r.html}${close ?? ""}`;
  });
}
