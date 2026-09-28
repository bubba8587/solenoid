/** [[C115]] closeParensOnCommit: a count of `(` against `)` outside quoted text and `[column]` references, nothing more.
 *  An unterminated string or reference is left as typed for the parser to name. Its own module: the Obsidian plugin's
 *  column head reaches it without the formula engine. */
export function closeParens(text: string): string {
  let open = 0, close = 0, inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[") {
      const end = referenceEnd(text, i);
      if (end < 0) return text;
      i = end;
      continue;
    }
    if (ch === "(") open++;
    else if (ch === ")") close++;
  }
  if (inStr) return text;
  return open > close ? text.trimEnd() + ")".repeat(open - close) : text;
}

/** Where a `[Name]` or `[@[Name]]` reference opened at `i` closes, as the tokenizer reads it; -1 when it doesn't. */
export function referenceEnd(text: string, i: number): number {
  const nested = text[i + 1] === "@" && text[i + 2] === "[";
  const e = text.indexOf("]", nested ? i + 3 : i + 1);
  if (e < 0) return -1;
  if (!nested) return e;
  return text[e + 1] === "]" ? e + 1 : -1;
}
