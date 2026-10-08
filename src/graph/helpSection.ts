// [[C114]] cardsView
/** One `## heading` section of a help doc, its heading included, up to the next `## `; "" when the doc has none. */
export function helpSection(md: string, heading: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1).findIndex((l) => l.startsWith("## "));
  return lines.slice(start, rest < 0 ? undefined : start + 1 + rest).join("\n").trim();
}
