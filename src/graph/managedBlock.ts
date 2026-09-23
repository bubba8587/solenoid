// [[B1]] obsidianBet

export interface SpliceResult {
  text: string;
  refused?: string;
}

export function beginMarker(name: string): string { return `%% solenoid:begin ${name.trim()} %%`; }
export const END_MARKER = "%% solenoid:end %%";

/** Which lines sit in a code fence, its own fence lines included. A fence closes on a bare run of its
 *  character at least as long as the one that opened it (CommonMark), and an unclosed one runs to the end.
 *  The task toggle shares it. */
export function fencedLines(lines: readonly string[]): boolean[] {
  const out = lines.map(() => false);
  let open: string | null = null;
  lines.forEach((l, i) => {
    if (open === null) {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(l);
      if (m && !(m[1][0] === "`" && l.slice(m.index + m[0].length).includes("`"))) open = m[1];
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l);
      out[i] = true;
      if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null;
      return;
    }
    out[i] = open !== null;
  });
  return out;
}

const ANY_BEGIN = /^%% solenoid:begin .* %%$/;

/** An end closes the nearest begin of any name before it, so an orphan begin never pairs with a later block's end. */
function findBlock(lines: readonly string[], name: string): [number, number] | null {
  const begin = beginMarker(name);
  const fenced = fencedLines(lines);
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const t = lines[i].trim();
    if (ANY_BEGIN.test(t)) open = i;
    else if (t === END_MARKER && open >= 0) {
      if (lines[open].trim() === begin) return [open, i];
      open = -1;
    }
  }
  return null;
}

export function spliceBlock(text: string, name: string, content: string): SpliceResult {
  const contentLines = content.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(contentLines);
  const bad = contentLines.findIndex((l, i) => l.includes("%%") && !fenced[i]);
  if (bad >= 0) return { text, refused: `the content has "%%" on line ${bad + 1}, which Obsidian would hide` };

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const found = findBlock(lines, name);
  const block = [beginMarker(name), ...contentLines, END_MARKER];
  if (found) {
    return { text: [...lines.slice(0, found[0]), ...block, ...lines.slice(found[1] + 1)].join("\n") };
  }
  const body = lines.join("\n").replace(/\s+$/, "");
  return { text: (body ? body + "\n\n" : "") + block.join("\n") + "\n" };
}

export function readBlock(text: string, name: string): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const found = findBlock(lines, name);
  return found ? lines.slice(found[0] + 1, found[1]).join("\n") : null;
}
