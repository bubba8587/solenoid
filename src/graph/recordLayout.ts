// [[C63]] oneRecordNode

export interface RecordPlacement {
  name: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** Muted text an EMPTY box shows in place of the value dash. */
  hint?: string;
  /** The title field (a `#name` marker): drawn big and label-less in every view. */
  title?: boolean;
}

/** A layout cell: one line per grid row, cells split on "|", "." or an empty
 *  cell is a gap. Repeating a name claims its bounding rectangle (a lenient
 *  grid-template-areas: a non-rectangular repeat degrades to its bounds instead
 *  of invalidating the grid). Names keep first-occurrence spelling. Two cell
 *  suffixes: `Name*3` widens the cell three columns (expanded before the walk,
 *  so it composes with repetition and shifts later cells right), and a first
 *  colon splits off placeholder text — `Qty: e.g. 40` — kept as the box's
 *  `hint` (first authored hint wins on a repeat). */
export function parseRecordLayout(text: string): RecordPlacement[] {
  const rows = text
    .split("\n")
    .map((line) =>
      line.split("|").flatMap((raw) => {
        const cell = raw.trim();
        const ci = cell.indexOf(":");
        const hint = ci >= 0 ? cell.slice(ci + 1).trim() : "";
        const head = (ci >= 0 ? cell.slice(0, ci) : cell).trim();
        const m = /^(.*?)\s*\*\s*(\d+)$/.exec(head);
        const named = m ? m[1].trim() : head;
        // A leading `#` marks the title field (drawn big, label-less); the rest is the name.
        const title = named.startsWith("#");
        const name = title ? named.slice(1).trim() : named;
        const span = m ? Math.min(12, Math.max(1, Number(m[2]))) : 1;
        return Array.from({ length: span }, (_, i) => ({ name, hint: i === 0 ? hint : "", title }));
      }),
    )
    .filter((cells) => cells.some((c) => c.name !== "" && c.name !== "."));
  const rects = new Map<string, { name: string; hint: string; title: boolean; r0: number; c0: number; r1: number; c1: number }>();
  const order: string[] = [];
  rows.forEach((cells, r) =>
    cells.forEach(({ name, hint, title }, c) => {
      if (name === "" || name === ".") return;
      const key = name.toLowerCase();
      const rect = rects.get(key);
      if (!rect) {
        rects.set(key, { name, hint, title, r0: r, c0: c, r1: r, c1: c });
        order.push(key);
      } else {
        rect.r0 = Math.min(rect.r0, r); rect.c0 = Math.min(rect.c0, c);
        rect.r1 = Math.max(rect.r1, r); rect.c1 = Math.max(rect.c1, c);
        if (!rect.hint) rect.hint = hint;
        if (title) rect.title = true;
      }
    }),
  );
  // A crossed repeat ("A | B" over "B | A") bounds two names onto one area; the later one
  // shrinks to the cell it first appeared in, so no box ever hides another.
  const placed: Array<{ r0: number; c0: number; r1: number; c1: number }> = [];
  const firstCell = new Map<string, { r: number; c: number }>();
  rows.forEach((cells, r) => cells.forEach(({ name }, c) => {
    const key = name.toLowerCase();
    if (name !== "" && name !== "." && !firstCell.has(key)) firstCell.set(key, { r, c });
  }));
  for (const key of order) {
    const t = rects.get(key)!;
    const hits = (a: typeof t) => placed.some((p) => a.r0 <= p.r1 && p.r0 <= a.r1 && a.c0 <= p.c1 && p.c0 <= a.c1);
    if (hits(t)) { const f = firstCell.get(key)!; t.r0 = t.r1 = f.r; t.c0 = t.c1 = f.c; }
    placed.push({ r0: t.r0, c0: t.c0, r1: t.r1, c1: t.c1 });
  }
  return order.map((key) => {
    const t = rects.get(key)!;
    return {
      name: t.name, row: t.r0 + 1, col: t.c0 + 1, rowSpan: t.r1 - t.r0 + 1, colSpan: t.c1 - t.c0 + 1,
      ...(t.hint ? { hint: t.hint } : {}),
      ...(t.title ? { title: true } : {}),
    };
  });
}

/** A string cell that points at an image: a data:image URL, or an http(s) URL
 *  with an image extension. Anything else stays text. */
export function recordImageSrc(text: string): string | null {
  const t = text.trim();
  if (/^data:image\//i.test(t)) return t;
  if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?\S*)?$/i.test(t)) return t;
  return null;
}
