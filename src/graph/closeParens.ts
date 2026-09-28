/** [[C115]] closeParensOnCommit: a count of `(` against `)` outside quoted text, nothing more. Its own module: the
 *  Obsidian plugin's column head reaches it without the formula engine. */
export function closeParens(text: string): string {
  let open = 0, close = 0, inStr = false;
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === "(") open++;
    else if (!inStr && ch === ")") close++;
  }
  return open > close ? text.trimEnd() + ")".repeat(open - close) : text;
}
