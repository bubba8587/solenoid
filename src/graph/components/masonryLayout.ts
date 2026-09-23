// [[C63]] oneRecordNode

export interface MasonryPlan {
  count: number;
  colWidth: number;
}

export interface MasonryPacked {
  slots: { col: number; y: number }[];
  height: number;
}

export function planColumns(
  width: number,
  gap: number,
  { ideal, min, max, items }: { ideal: number; min: number; max: number; items: number },
): MasonryPlan {
  if (width <= 0 || items <= 0) return { count: Math.max(1, items > 0 ? 1 : 0), colWidth: ideal };
  let count = Math.max(1, Math.round((width + gap) / (ideal + gap)));
  count = Math.min(count, Math.max(1, items));
  while (count > 1 && (width - (count - 1) * gap) / count < min) count--;
  const colWidth = Math.min(max, (width - (count - 1) * gap) / count);
  return { count, colWidth };
}

export function packMasonry(heights: number[], count: number, gap: number): MasonryPacked {
  const cols = Math.max(1, count);
  const running = new Array<number>(cols).fill(0);
  const slots = heights.map((h) => {
    let col = 0;
    for (let c = 1; c < cols; c++) if (running[c] < running[col]) col = c;
    const y = running[col];
    running[col] = y + h + gap;
    return { col, y };
  });
  const height = Math.max(0, ...running.map((r) => (r > 0 ? r - gap : 0)));
  return { slots, height };
}
