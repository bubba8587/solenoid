// [[C114]] cardsView, [[C103]] untrustedContentSeams
import { CellImage } from "./cubeCell";
import { splitTags, isHexColor, linkHref, shortLink, type CardColType, type CardPlan } from "../cardLayout";
import { categoryColorIndex } from "../categoryColor";
import { cellImageSrc } from "../recordLayout";
import { decimalFromText } from "../valueKinds";
import { ERROR_EXPLANATIONS } from "../errorValue";
import { stopDragStart } from "../coarse";
import { CategoryChip } from "./CategoryChip";
import { CheckIcon, PencilIcon } from "./Icons";
import { CloseIcon } from "./CloseIcon";
import "./AutoCard.css";

// A folded card shows this many field tiles until it is opened.
export const TILE_LIMIT = 6;

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
  if (text === "NaN") return <span className="sol-card__nan" title="Not a number: an undefined value in the data">NaN</span>;
  const picture = cellImageSrc(text);
  if (picture) return <CellImage className="sol-card__pic" src={picture} />;
  const href = linkHref(text);
  if (href) {
    return (
      <a className="sol-card__link" href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} onPointerDown={stopDragStart}>
        {href.startsWith("mailto:") ? text.trim() : shortLink(text)}
      </a>
    );
  }
  return <>{text}</>;
}

// An SVG circle: a small rounded CSS box snaps to an oval at a fractional position.
const FxDot = () => (
  <svg className="sol-card__fx" width="6" height="6" viewBox="0 0 6 6" role="img" aria-label="Computed column">
    <title>Computed column</title>
    <circle cx="3" cy="3" r="3" fill="currentColor" />
  </svg>
);

const STAR = "M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.49l-5.87 3.09 1.12-6.54L2.5 9.41l6.56-.95z";

/** Five stars, each filled by its share of the rating, so 3.5 shows three and a half. */
function Stars({ value }: { value: number }) {
  return (
    <span className="sol-card__stars" role="img" aria-label={`${value} of 5`}>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <svg key={i} viewBox="0 0 24 24" aria-hidden="true">
            <path d={STAR} className="sol-card__star-empty" />
            {fill > 0 && (
              <path d={STAR} className="sol-card__star-fill" style={fill < 1 ? { clipPath: `inset(0 ${Math.round((1 - fill) * 100)}% 0 0)` } : undefined} />
            )}
          </svg>
        );
      })}
    </span>
  );
}

/**
 * Chip colors by column. A column styled Chip keeps the colors the grid gives it; the columns read as
 * chips or tags continue one run, so two of them never share a color.
 */
export function cardChipColors(
  plan: CardPlan,
  chipCols: ReadonlySet<number>,
  rowCount: number,
  rawAt: (r: number, c: number) => string,
): Map<number, Map<string, number>> {
  const m = new Map<number, Map<string, number>>();
  let next = 0;
  const tokensOf = (c: number) => Array.from({ length: rowCount }, (_, r) => rawAt(r, c)).flatMap((t) =>
    plan.tags.includes(c) ? splitTags(t) : t.trim() === "" ? [] : [t.trim()]);
  for (const c of [...plan.chips, ...plan.tags]) {
    const own = categoryColorIndex(tokensOf(c));
    if (chipCols.has(c)) { m.set(c, own); continue; }
    const offset = next;
    m.set(c, new Map([...own].map(([v, i]) => [v, i + offset])));
    next += own.size;
  }
  return m;
}

type Tile = { c: number; kind: "stat" | "meter" | "rating"; max?: number };

function tilesOf(plan: CardPlan): Tile[] {
  return [
    ...plan.stats.map((c): Tile => ({ c, kind: "stat" })),
    ...plan.meters.map((m): Tile => ({ c: m.col, kind: "meter", max: m.max })),
    ...plan.ratings.map((c): Tile => ({ c, kind: "rating" })),
  ].sort((a, b) => a.c - b.c);
}

/**
 * One row as a card, laid out by `plan`. `texts` is each column's shown text, `raw(c)` its raw text.
 * With `fold`, a card past TILE_LIMIT fields and its prose stay short until `open`; `onToggle` flips that.
 */
export function AutoCard({
  plan, names, types, computed, chipColors, texts, raw, rowNumber, fold, open = false, onToggle, toggleOnClick = false, onEdit,
}: {
  plan: CardPlan;
  names: readonly string[];
  types: readonly CardColType[];
  computed: ReadonlySet<number>;
  chipColors: ReadonlyMap<number, ReadonlyMap<string, number>>;
  texts: readonly string[];
  raw: (c: number) => string;
  rowNumber: number;
  fold: boolean;
  open?: boolean;
  onToggle?: () => void;
  toggleOnClick?: boolean;
  onEdit?: () => void;
}) {
  const text = (c: number | null): string => (c === null ? "" : (texts[c] ?? "").trim());
  const img = plan.image !== null ? cellImageSrc(raw(plan.image)) : null;
  const title = [plan.title, ...plan.titleRest].map(text).filter((t) => t !== "").join(" ");
  const key = text(plan.key);
  const subtitle = text(plan.subtitle);
  const start = text(plan.meta);
  const end = text(plan.metaEnd);
  const meta = start !== "" && end !== "" ? `${start} – ${end}` : start || end;
  const hero = text(plan.hero);
  const chips = plan.chips.filter((c) => text(c) !== "");
  const tagTokens = plan.tags.flatMap((c) => splitTags(raw(c)).map((t) => ({ c, t })));
  const swatches = plan.swatches.filter((c) => isHexColor(raw(c)));
  const flags = plan.flags.flatMap((c) => { const v = readLogical(raw(c)); return v === null ? [] : [{ c, v }]; });
  const rowTiles = tilesOf(plan).filter((t) => text(t.c) !== "");
  const prose = plan.prose.filter((c) => text(c) !== "");
  const folded = fold && !open;
  const visibleTiles = folded && rowTiles.length > TILE_LIMIT ? rowTiles.slice(0, TILE_LIMIT) : rowTiles;
  const opens = fold && !!onToggle && (prose.length > 0 || rowTiles.length > TILE_LIMIT);
  return (
    <article
      className={`sol-card${folded ? " sol-card--folded" : ""}${opens && toggleOnClick ? " sol-card--opens" : ""}`}
      onClick={opens && toggleOnClick ? onToggle : undefined}
    >
      <header className="sol-card__head">
        {img && <CellImage className="sol-card__thumb" src={img} />}
        <div className="sol-card__titles">
          <div className="sol-card__title-line">
            {key !== "" && <span className="sol-card__key">{key}</span>}
            <span className={`sol-card__title${title === "" ? " sol-card__title--none" : ""}`}>
              {title !== "" ? <CellText text={title} /> : `Row ${rowNumber}`}
            </span>
          </div>
          {(subtitle !== "" || meta !== "") && (
            <div className="sol-card__sub">
              {subtitle !== "" && <CellText text={subtitle} />}
              {subtitle !== "" && meta !== "" && " · "}
              {meta !== "" && <span className="sol-card__meta">{meta}</span>}
            </div>
          )}
        </div>
        {hero !== "" && plan.hero !== null && (
          <div className="sol-card__hero">
            <span className="sol-card__hero-value"><CellText text={hero} /></span>
            <span className="sol-card__label">{computed.has(plan.hero) && <FxDot />}{names[plan.hero]}</span>
          </div>
        )}
        {onEdit && (
          <button
            type="button"
            className="sol-card__edit"
            title="Edit in Form"
            aria-label="Edit in Form"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            <PencilIcon size={14} />
          </button>
        )}
      </header>
      {(chips.length > 0 || tagTokens.length > 0 || swatches.length > 0 || flags.length > 0) && (
        <div className="sol-card__chips">
          {chips.map((c) => (
            <CategoryChip key={c} value={text(c)} index={chipColors.get(c)?.get(raw(c).trim()) ?? 0} />
          ))}
          {tagTokens.map(({ c, t }, i) => (
            <CategoryChip key={`t${c}-${i}`} value={t} index={chipColors.get(c)?.get(t) ?? 0} />
          ))}
          {swatches.map((c) => (
            <span key={c} className="sol-card__swatch">
              <span className="sol-card__swatch-dot" style={{ background: raw(c).trim() }} />
              {text(c)}
            </span>
          ))}
          {flags.map(({ c, v }) => (
            <span key={c} className={`sol-card__flag${v ? " sol-card__flag--on" : ""}`}>
              {v ? <CheckIcon size={10} strokeWidth={2.4} /> : <CloseIcon size={10} />}
              {names[c]}
            </span>
          ))}
        </div>
      )}
      {visibleTiles.length > 0 && (
        <dl className="sol-card__stats">
          {visibleTiles.map(({ c, kind, max }) => {
            const n = decimalFromText(raw(c).trim());
            return (
              <div key={c} className={`sol-card__stat${types[c] === "string" ? " sol-card__stat--text" : ""}`}>
                <dt className="sol-card__label">{computed.has(c) && <FxDot />}{names[c]}</dt>
                <dd>
                  {kind === "rating" && Number.isFinite(n) && <Stars value={n} />}
                  <CellText text={kind === "meter" && Number.isFinite(n) && !text(c).endsWith("%") ? `${Math.round((n / (max ?? 1)) * 100)}%` : text(c)} />
                </dd>
                {kind === "meter" && Number.isFinite(n) && (
                  <span className="sol-card__meter" aria-hidden="true">
                    <span style={{ width: `${Math.round(Math.max(0, Math.min(1, n / (max ?? 1))) * 100)}%` }} />
                  </span>
                )}
              </div>
            );
          })}
        </dl>
      )}
      {prose.map((c) => (
        <div key={c} className="sol-card__prose">
          <div className="sol-card__label">{computed.has(c) && <FxDot />}{names[c]}</div>
          <p><CellText text={texts[c] ?? ""} /></p>
        </div>
      ))}
      {fold && onToggle && rowTiles.length > TILE_LIMIT && (
        <button
          type="button"
          className="sol-card__fields"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {open ? "Show Fewer Fields" : `Show All ${rowTiles.length} Fields`}
        </button>
      )}
    </article>
  );
}
