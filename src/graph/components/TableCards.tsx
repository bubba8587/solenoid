// [[D88]] cardsView
import { useMemo, useState } from "react";
import { planCards, cardMatches, PROFILE_ROWS, type CardColType, type CardColumnInput } from "../cardLayout";
import { categoryColorIndex } from "../categoryColor";
import { recordImageSrc } from "../recordLayout";
import { ERROR_EXPLANATIONS } from "../errorValue";
import { CategoryChip } from "./CategoryChip";
import { type ColumnSort, type SortDir } from "./columnSort";
import { ArrowIcon, CheckIcon, PencilIcon, SearchIcon } from "./Icons";
import { CloseIcon } from "./CloseIcon";
import "./TableCards.css";

const PAGE = 100;

function isErrCode(s: string): boolean {
  return Object.prototype.hasOwnProperty.call(ERROR_EXPLANATIONS, s.trim());
}

function readLogical(raw: string): boolean | null {
  const t = raw.trim().toLowerCase();
  return t === "true" || t === "1" ? true : t === "false" || t === "0" ? false : null;
}

function CellText({ text }: { text: string }) {
  if (isErrCode(text)) {
    return <span className="sol-error-chip" title={ERROR_EXPLANATIONS[text.trim() as keyof typeof ERROR_EXPLANATIONS]}>{text.trim()}</span>;
  }
  if (text === "NaN") return <span className="table-cards__nan" title="Not a number: an undefined value in the data">NaN</span>;
  return <>{text}</>;
}

const FxDot = () => (
  <svg className="table-popup__form-box-fx" width="6" height="6" viewBox="0 0 6 6" role="img" aria-label="Computed column">
    <title>Computed column</title>
    <circle cx="3" cy="3" r="3" fill="currentColor" />
  </svg>
);

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

  const plan = useMemo(() => {
    const n = Math.min(rowCount, PROFILE_ROWS);
    const input: CardColumnInput[] = Array.from({ length: cols }, (_, c) => ({
      name: names[c],
      type: types[c],
      cells: Array.from({ length: n }, (_r, r) => rawAt(r, c)),
      chip: chipCols.has(c),
    }));
    return planCards(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // A column styled Chip keeps the colors the grid gives it; the columns read as chips here continue one run, so two of them never share a color.
  const chipColors = useMemo(() => {
    const m = new Map<number, Map<string, number>>();
    let next = 0;
    for (const c of plan.chips) {
      const own = categoryColorIndex(Array.from({ length: rowCount }, (_, r) => rawAt(r, c).trim() || null));
      if (chipCols.has(c)) { m.set(c, own); continue; }
      const offset = next;
      m.set(c, new Map([...own].map(([v, i]) => [v, i + offset])));
      next += own.size;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, plan]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rowCache = useMemo(() => new Map<number, string[]>(), [dataKey]);
  const row = (r: number): string[] => {
    let v = rowCache.get(r);
    if (!v) { v = shownRow(r); rowCache.set(r, v); }
    return v;
  };

  const matched = query.trim() === "" ? order : order.filter((r) => cardMatches(row(r), query));
  const shown = matched.length > limit ? matched.slice(0, limit) : matched;

  const primary = sort[0];
  const dir: SortDir = primary?.dir ?? "asc";

  const toggle = (r: number) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(r)) next.delete(r); else next.add(r);
    return next;
  });

  const card = (r: number) => {
    const texts = row(r);
    const text = (c: number | null): string => (c === null ? "" : (texts[c] ?? "").trim());
    const img = plan.image !== null ? recordImageSrc(rawAt(r, plan.image)) : null;
    const title = text(plan.title);
    const key = text(plan.key);
    const subtitle = text(plan.subtitle);
    const meta = text(plan.meta);
    const hero = text(plan.hero);
    const chips = plan.chips.filter((c) => text(c) !== "");
    const flags = plan.flags.flatMap((c) => { const v = readLogical(rawAt(r, c)); return v === null ? [] : [{ c, v }]; });
    const stats = plan.stats.filter((c) => text(c) !== "");
    const prose = plan.prose.filter((c) => text(c) !== "");
    const isOpen = open.has(r);
    return (
      <article
        key={r}
        className={`table-cards__card${isOpen ? " table-cards__card--open" : ""}`}
        onClick={prose.length > 0 ? () => toggle(r) : undefined}
      >
        <header className="table-cards__head">
          {img && <img className="table-cards__thumb" src={img} alt="" draggable={false} />}
          <div className="table-cards__titles">
            <div className="table-cards__title-line">
              {key !== "" && <span className="table-cards__key">{key}</span>}
              <span className={`table-cards__title${title === "" ? " table-cards__title--none" : ""}`}>
                {title !== "" ? <CellText text={title} /> : `Row ${r + 1}`}
              </span>
            </div>
            {(subtitle !== "" || meta !== "") && (
              <div className="table-cards__sub">
                {subtitle}
                {subtitle !== "" && meta !== "" && " · "}
                {meta !== "" && <span className="table-cards__meta">{meta}</span>}
              </div>
            )}
          </div>
          {hero !== "" && plan.hero !== null && (
            <div className="table-cards__hero">
              <span className="table-cards__hero-value"><CellText text={hero} /></span>
              <span className="table-cards__label">{computed.has(plan.hero) && <FxDot />}{names[plan.hero]}</span>
            </div>
          )}
          {onEdit && (
            <button
              type="button"
              className="table-cards__edit"
              title="Edit in Form"
              aria-label="Edit in Form"
              onClick={(e) => { e.stopPropagation(); onEdit(r); }}
            >
              <PencilIcon size={14} />
            </button>
          )}
        </header>
        {(chips.length > 0 || flags.length > 0) && (
          <div className="table-cards__chips">
            {chips.map((c) => (
              <CategoryChip key={c} value={text(c)} index={chipColors.get(c)?.get(rawAt(r, c).trim()) ?? 0} />
            ))}
            {flags.map(({ c, v }) => (
              <span key={c} className={`table-cards__flag${v ? " table-cards__flag--on" : ""}`}>
                {v ? <CheckIcon size={10} strokeWidth={2.4} /> : <CloseIcon size={10} />}
                {names[c]}
              </span>
            ))}
          </div>
        )}
        {stats.length > 0 && (
          <dl className="table-cards__stats">
            {stats.map((c) => (
              <div key={c} className={`table-cards__stat${types[c] === "string" ? " table-cards__stat--text" : ""}`}>
                <dt className="table-cards__label">{computed.has(c) && <FxDot />}{names[c]}</dt>
                <dd><CellText text={text(c)} /></dd>
              </div>
            ))}
          </dl>
        )}
        {prose.map((c) => (
          <div key={c} className="table-cards__prose">
            <div className="table-cards__label">{computed.has(c) && <FxDot />}{names[c]}</div>
            <p><CellText text={texts[c] ?? ""} /></p>
          </div>
        ))}
      </article>
    );
  };

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
