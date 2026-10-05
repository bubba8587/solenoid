// [[C114]] cardsView
import { useMemo, useState, type ReactNode } from "react";
import { planCards, cardMatches, PROFILE_ROWS, type CardColType, type CardColumnInput } from "../cardLayout";
import { type ColumnSort, type SortDir } from "./columnSort";
import { ArrowIcon, InfoIcon, SearchIcon } from "./Icons";
import { Markdown } from "./Markdown";
import { helpSection } from "../helpSection";
import helpMd from "../help/help.md?raw";
import { AutoCard, cardChipColors } from "./AutoCard";
import "./TableCards.css";

const PAGE = 100;
const CARD_RULES = helpSection(helpMd, "Cards");

/** `dataKey` changes whenever the cells or their shown text do; the plan, the chip colors and the row texts are cached on it. */
export function TableCards({
  names, types, computed, chipCols, nestedCols, listCols, rowCount, order, rawAt, shownRow, itemsAt, cellNodeAt, dataKey, sort, onSort, query, onQuery, onEdit,
}: {
  names: readonly string[];
  types: readonly CardColType[];
  computed: ReadonlySet<number>;
  chipCols: ReadonlySet<number>;
  /** Columns of nested containers, and of lists among them (the Cube popup's). */
  nestedCols?: ReadonlySet<number>;
  listCols?: ReadonlySet<number>;
  rowCount: number;
  /** Source row indices in the visual sort. */
  order: readonly number[];
  rawAt: (r: number, c: number) => string;
  shownRow: (r: number) => string[];
  itemsAt?: (r: number, c: number) => readonly string[] | null;
  cellNodeAt?: (r: number, c: number) => ReactNode;
  dataKey: object;
  sort: ColumnSort;
  onSort: (next: ColumnSort) => void;
  /** The popup's word filter, shared with the Grid view. */
  query: string;
  onQuery: (next: string) => void;
  onEdit?: (r: number) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const [rulesOpen, setRulesOpen] = useState(false);
  const cols = names.length;

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
      nested: nestedCols?.has(c),
      lists: listCols?.has(c),
    }));
    return planCards(input);
  }, [dataKey]);

  const chipColors = useMemo(() => cardChipColors(plan, chipCols, rowCount, rawAt, itemsAt), [dataKey, plan]);

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
      items={itemsAt ? (c) => itemsAt(r, c) : undefined}
      cellNode={cellNodeAt ? (c) => cellNodeAt(r, c) : undefined}
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
            onChange={(e) => { onQuery(e.target.value); setLimit(PAGE); }}
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
        <button
          type="button"
          className="table-cards__dir"
          aria-pressed={rulesOpen}
          title="How cards are laid out"
          aria-label="How cards are laid out"
          onClick={() => setRulesOpen((o) => !o)}
        >
          <InfoIcon size={14} />
        </button>
      </div>
      {rulesOpen && <div className="table-cards__rules"><Markdown md={CARD_RULES} /></div>}
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
