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

export function spliceBlock(text: string, name: string, content: string): SpliceResult {
  const contentLines = content.replace(/\r\n/g, "\n").split("\n");
  const contentFences = fenceRanges(contentLines);
  const bad = contentLines.findIndex((l, i) => l.includes("%%") && !inFence(i, contentFences));
  if (bad >= 0) return { text, refused: `the content has "%%" on line ${bad + 1}, which Obsidian would hide` };

  const begin = beginMarker(name);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const fences = fenceRanges(lines);
  const beginAt = lines.findIndex((l, i) => l.trim() === begin && !inFence(i, fences));
  const endAt = beginAt < 0 ? -1 : lines.findIndex((l, i) => i > beginAt && l.trim() === END_MARKER && !inFence(i, fences));
  const block = [begin, ...contentLines, END_MARKER];
  if (beginAt >= 0 && endAt > beginAt) {
    return { text: [...lines.slice(0, beginAt), ...block, ...lines.slice(endAt + 1)].join("\n") };
  }
  const body = lines.join("\n").replace(/\s+$/, "");
  return { text: (body ? body + "\n\n" : "") + block.join("\n") + "\n" };
}

export function readBlock(text: string, name: string): string | null {
  const begin = beginMarker(name);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const fences = fenceRanges(lines);
  const beginAt = lines.findIndex((l, i) => l.trim() === begin && !inFence(i, fences));
  if (beginAt < 0) return null;
  const endAt = lines.findIndex((l, i) => i > beginAt && l.trim() === END_MARKER && !inFence(i, fences));
  if (endAt < 0) return null;
  return lines.slice(beginAt + 1, endAt).join("\n");
}
