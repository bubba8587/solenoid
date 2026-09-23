// [[B1]] obsidianBet

export interface SpliceResult {
  text: string;
  refused?: string;
}

export function beginMarker(name: string): string { return `%% solenoid:begin ${name.trim()} %%`; }
export const END_MARKER = "%% solenoid:end %%";

function fenceRanges(lines: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  let open: { at: number; fence: string } | null = null;
  lines.forEach((l, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (!m) return;
    if (!open) open = { at: i, fence: m[1] };
    else if (m[1][0] === open.fence[0] && m[1].length >= open.fence.length) { out.push([open.at, i]); open = null; }
  });
  if (open) out.push([(open as { at: number }).at, lines.length - 1]);
  return out;
}

const inFence = (i: number, ranges: [number, number][]) => ranges.some(([a, b]) => i >= a && i <= b);

const ANY_BEGIN = /^%% solenoid:begin .* %%$/;

/** An end closes the nearest begin of any name before it, so an orphan begin never pairs with a later block's end. */
function findBlock(lines: readonly string[], name: string): [number, number] | null {
  const begin = beginMarker(name);
  const fences = fenceRanges(lines);
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (inFence(i, fences)) continue;
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
  const contentFences = fenceRanges(contentLines);
  const bad = contentLines.findIndex((l, i) => l.includes("%%") && !inFence(i, contentFences));
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
