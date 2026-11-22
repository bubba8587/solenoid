import { useState } from "react";
import { TableCards } from "./TableCards";
import type { ColumnSort } from "./columnSort";
import { formatFrameCell, type FrameValue, type FrameColumn } from "../frame";
import { formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatScalar } from "./format";
import { fullList } from "../listPreview";

/** A Frame as the Table popup's Cards view, read-only: a Dashboard box's or a Report embed's alternative to the grid. */
export function FrameCards({ frame: given, query = "" }: { frame: FrameValue; query?: string }) {
  // TableCards filters its own cards; a preview gives it the whole table to filter.
  const frame = query.trim() ? fullList(given) : given;
  const [sort, setSort] = useState<ColumnSort>([]);
  const cols = frame.columns;
  const rows = cols.reduce((m, c) => Math.max(m, c.values.length), 0);
  const shown = (c: FrameColumn, r: number): string => frameCardText(c, r);
  return (
    <TableCards
      names={cols.map((c) => c.name)}
      types={cols.map((c) => c.type)}
      computed={NO_COLS}
      chipCols={NO_COLS}
      rowCount={rows}
      order={Array.from({ length: rows }, (_, r) => r)}
      rawAt={(r, c) => cols[c].raw?.[r] ?? shown(cols[c], r)}
      shownRow={(r) => cols.map((c) => shown(c, r))}
      dataKey={frame}
      sort={sort}
      onSort={setSort}
      query={query}
    />
  );
}
const NO_COLS: ReadonlySet<number> = new Set();

/** A cell as a card shows it, under the column's format. The webpage export's cards read the same. */
export function frameCardText(c: FrameColumn, r: number): string {
  const v = formatFrameCell(c.type, c.values[r] ?? null, c.format);
  return typeof v === "number" ? (c.format ? formatNumberWithAnnotation(v, c.format) : formatScalar(v)) : v ?? "";
}
