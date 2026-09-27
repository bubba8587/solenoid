// [[D88]] cardsView
import { useMemo, useState } from "react";
import { planCards, cardMatches, PROFILE_ROWS, type CardColType, type CardColumnInput } from "../cardLayout";
import { type ColumnSort, type SortDir } from "./columnSort";
import { ArrowIcon, SearchIcon } from "./Icons";
import { AutoCard, cardChipColors } from "./AutoCard";
import "./TableCards.css";

const PAGE = 100;

/** `dataKey` changes whenever the cells or their shown text do; the plan, the chip colors and the row texts are cached on it. */
export function TableCards({
  names, types, computed, chipCols, rowCount, order, rawAt, shownRow, dataKey, sort, onSort, onEdit,
}: {
  names: readonly string[];
  types: readonly CardColType[];
  computed: ReadonlySet<number>;
  chipCols: ReadonlySet<number>;
  rowCount: number;
  /** Source row indices in the visual sort. */
  order: readonly number[];
  rawAt: (r: number, c: number) => string;
  shownRow: (r: number) => string[];
  dataKey: object;
  sort: ColumnSort;
  onSort: (next: ColumnSort) => void;
  onEdit?: (r: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const cols = names.length;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rowCache = useMemo(() => new Map<number, string[]>(), [dataKey]);
  const row = (r: number): string[] => {
    let v = rowCache.get(r);
    if (!v) { v = shownRow(r); rowCache.set(r, v); }
    return v;
  };

  const plan = useMemo(() => {
    const n = Math.min(rowCount, PROFILE_ROWS);
    const input: CardColumnInput[] = Array.from({ length: cols }, (_, c) => ({
      name: names[c],
      type: types[c],
      cells: Array.from({ length: n }, (_r, r) => rawAt(r, c)),
      shown: Array.from({ length: n }, (_r, r) => row(r)[c] ?? ""),
      chip: chipCols.has(c),
    }));
    return planCards(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chipColors = useMemo(() => cardChipColors(plan, chipCols, rowCount, rawAt), [dataKey, plan]);

  const matched = query.trim() === "" ? order : order.filter((r) => cardMatches(row(r), query));
  const shown = matched.length > limit ? matched.slice(0, limit) : matched;

  const primary = sort[0];
  const dir: SortDir = primary?.dir ?? "asc";

  const toggle = (r: number) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(r)) next.delete(r); else next.add(r);
    return next;
  });

  const card = (r: number) => (
    <AutoCard
      key={r}
      plan={plan}
      names={names}
      types={types}
      computed={computed}
      chipColors={chipColors}
      texts={row(r)}
      raw={(c) => rawAt(r, c)}
      rowNumber={r + 1}
      fold
      open={open.has(r)}
      onToggle={() => toggle(r)}
      toggleOnClick
      onEdit={onEdit ? () => onEdit(r) : undefined}
    />
  );

  return (
    <div className="table-cards-wrap sol-popup__scroll">
      <div className="table-cards__bar">
        <label className="table-cards__filter">
          <SearchIcon size={12} />
          <input
            value={query}
            placeholder="Filter"
            aria-label="Filter cards"
            spellCheck={false}
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
          />
        </label>
        <select
          className="table-cards__sort"
          aria-label="Sort cards"
          value={primary ? String(primary.col) : ""}
          onChange={(e) => onSort(e.target.value === "" ? [] : [{ col: Number(e.target.value), dir }])}
        >
          <option value="">Source order</option>
          {names.map((n, c) => <option key={c} value={c}>{n}</option>)}
        </select>
        <button
          type="button"
          className="table-cards__dir"
          disabled={!primary}
          title={dir === "asc" ? "Ascending" : "Descending"}
          aria-label={dir === "asc" ? "Ascending" : "Descending"}
          onClick={() => primary && onSort([{ col: primary.col, dir: dir === "asc" ? "desc" : "asc" }])}
        >
          <ArrowIcon dir={dir === "asc" ? "up" : "down"} size={12} />
        </button>
        {query.trim() !== "" && <span className="table-cards__count">{matched.length} of {rowCount}</span>}
      </div>
      <div className="table-cards">
        {shown.map(card)}
        {matched.length === 0 && <div className="table-cards__empty">{rowCount === 0 ? "No rows" : "No matches"}</div>}
        {matched.length > shown.length && (
          <button type="button" className="table-popup__btn table-cards__more" onClick={() => setLimit((n) => n + PAGE)}>
            Show More
          </button>
        )}
      </div>
    </div>
  );
}
