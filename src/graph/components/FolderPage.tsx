// [[B14]] oneDesignSystem (DESIGN.md § Voice: the Reference explains what normal use can't make obvious)
// A top-level folder's page in the Reference: what its kind of value is, drawn small, then its cards by sub-folder.
import type { CSSProperties, ReactNode } from "react";
import type { CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry } from "../AddNodeMenu";
import { SolenoidSocket, numListSocket, tableSocket } from "../sockets";
import { cubeFromColumns, type FrameValue } from "../frame";
import { solDate } from "../dateValue";
import { tagDim } from "../unitValue";
import { ResultDisplay } from "./ResultDisplay";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import { TableDisplay } from "./TableDisplay";
import { SocketComponent } from "./SocketComponent";
import { TypeIcon, type TypeIconKind } from "./TypeIcon";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { frStore } from "../frStore";
import { settingsPanel } from "../settingsStore";
import "../Settings.css";

/** The Frame socket's mark, drawn large in outline: the socket's square-edged "F", its stroke heavier than the box's. */
function FrameMark() {
  return (
    <svg viewBox="0 0 12 12" width="26" height="26" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1.5" strokeWidth="1.1" />
      <path d="M4.15 8.9 V3.9 H8.95 M4.15 6.2 H8.15" strokeWidth="1.5" strokeLinecap="butt" strokeLinejoin="miter" />
    </svg>
  );
}

/** A type icon wears its socket's color, as the Socket Legend draws it; a socket glyph carries its own. */
const ICON_COLOR: Partial<Record<TypeIconKind | "frame-mark", string>> = {
  number: "var(--sock-number)", string: "var(--sock-string)", date: "var(--sock-date)",
  logical: "var(--sock-logical)", "frame-mark": "var(--sock-frame)",
};

/** Each top-level folder's page: how Solenoid approaches that part of the work, a real value of its kind where it has
 *  one, and the cards to start with (catalog types; a starter may live in another folder). */
const FOLDER_STORIES: Record<string, {
  lede: string; shape?: () => ReactNode; icon?: TypeIconKind | SolenoidSocket | "frame-mark"; settings?: boolean; start?: string[];
}> = {
  Input: {
    lede: "Every graph starts from values someone types, picks or fetches. The input cards hold typed data as a single value, a List, a Table or a Frame; the controls change a value by hand with a slider, a dial or a pad; and the connections read files, web pages and live feeds.",
    start: ["value-input", "frame-input"],
  },
  Output: {
    lede: "Every card shows its own result, so an output card is for presenting one: Display shows any value at full size, the charts and gauges draw it, and Record and Cards lay out rows for reading. Convert and Cast change how a value is read on the way.",
    start: ["display", "chart"],
  },
  Numbers: {
    icon: "number",
    lede: "Each card is one calculation, and a formula card holds a whole expression. A number can carry a unit, set where the value starts, and a calculation works out its result's unit: meters times meters is square meters, and adding meters to seconds is a #UNIT! error.",
    shape: () => box(tagDim(2410, { length: 1 }, "km")),
    start: ["expression", "arith-add"],
  },
  Lists: {
    icon: numListSocket,
    lede: "An ordered run of values of one kind, and most cards work through a List item by item. A blank item is missing, not zero: totals skip it and it keeps its place.",
    shape: () => box([3, 6, 4, 8, 7]),
    start: ["list-input", "reduce-sum"],
  },
  Tables: {
    icon: tableSocket,
    lede: "Rows of plain values, with no column names or types: the shape a formula's array takes. A table holds one kind of value and one unit throughout, which is what the matrix math needs.",
    shape: () => <div className="fr-fold__box"><TableDisplay table={[[1, 2, 3], [4, 5, 6], [7, 8, 9]]} elem="number" /></div>,
    start: ["table-input", "table-mult"],
  },
  Frames: {
    icon: "frame-mark",
    lede: "A table with headers. Each column has a name and one type, so a column of dates stays dates and a column can carry its own unit. Formulas don't take Frames; Get Column and Split Frame take the pieces out. A Cube is a Frame whose cells can hold anything, a whole Frame included, so nested data stays nested.",
    shape: () => <FrameShapes />,
    start: ["frame-input", "filter-frame"],
  },
  Text: {
    icon: "string",
    lede: "Every text card works on one piece of text or, item by item, on a List of them, so cleaning a whole column is one card.",
    shape: () => box("Ada Lovelace"),
    start: ["text-concat", "text-split"],
  },
  "Date & Time": {
    icon: "date",
    lede: "A date is its own kind of value. It shows as a date wherever it goes and does day math; a number becomes a date only through Cast.",
    shape: () => box(solDate(46331)),
    start: ["date-today", "date-diff-days"],
  },
  Logic: {
    icon: "logical",
    lede: "TRUE and FALSE, plus unknown when an answer can't be told: TRUE OR unknown is TRUE, and FALSE OR unknown stays unknown. In arithmetic TRUE counts as 1 and FALSE as 0.",
    shape: () => box(true),
    start: ["if"],
  },
  Finance: {
    lede: "Loans, investments, depreciation and bonds, with Excel's own functions. What Excel spreads over a range of cells is one card here: an Amortization Schedule is a whole table from one card.",
    start: ["tvm", "amortization"],
  },
  "Docs & Files": {
    lede: "Notes, Reports and Dashboards turn a graph into something to read and share, with live values and charts placed in the text. The file cards read and write files outside the app.",
    start: ["note", "report"],
  },
  Packs: {
    lede: "A pack adds cards and formulas for one subject, such as geometry, circuits or health. Packs turn on and off in Settings.",
    settings: true,
  },
};

// The kinds of value, shown by the same displays a card's result box uses, filled with small real values.
const BILLS: FrameValue = {
  __frame: true,
  columns: [
    { name: "Item", type: "string", values: ["Rent", "Power", "Water"] },
    { name: "Due", type: "date", values: [46357, 46364, 46371] },
    { name: "Amount", type: "number", values: [1200, 84, 31] },
  ],
};
const readings = (a: number, b: number): FrameValue => ({
  __frame: true,
  columns: [{ name: "Meter", type: "string", values: ["A", "B"] }, { name: "kWh", type: "number", values: [a, b] }],
});
const METERS = cubeFromColumns([
  { name: "Item", cells: ["Power", "Water"], type: "string" },
  { name: "Readings", cells: [readings(212, 96), readings(14, 9)] },
]);

const box = (value: unknown, full = true) => <div className="fr-fold__box"><ResultDisplay value={value} full={full} /></div>;

function FrameShapes() {
  return (
    <div className="fr-fold__pair">
      <div className="fr-fold__box fr-fold__box--wide"><FrameDisplay frame={BILLS} /></div>
      <div className="fr-fold__box fr-fold__box--wide"><CubeDisplay cube={METERS} /></div>
    </div>
  );
}

/** The cards under a folder, Add-menu order, pairs flattened. */
export function leavesOf(entries: CatalogEntry[]): NodeCatalogEntry[] {
  return entries.flatMap((e) => e.type === "category" ? leavesOf((e as CatalogCategory).children)
    : e.type === "pair" ? (e as CatalogPair).children.filter((c) => !c.hidden)
    : (e as NodeCatalogEntry).hidden ? [] : [e as NodeCatalogEntry]);
}

/** A description's first sentence, its code spans as plain text. */
function firstSentence(text: string): string {
  const plain = text.replace(/`/g, "");
  const m = /^.*?[.!?](?=\s|$)/.exec(plain);
  return m ? m[0] : plain;
}

/** A folder's page. A top-level folder (no `ancestors`) tells what its kind of value is; a sub-folder names the folders
 *  above it, each opening its own page. */
export function FolderPage({ folder, ancestors, accentStyle, onCard, onUp, cardOf }: {
  folder: CatalogCategory; ancestors: string[]; accentStyle?: CSSProperties;
  onCard: (leaf: NodeCatalogEntry) => void; onUp: (depth: number) => void;
  cardOf: (type: string) => NodeCatalogEntry | null;
}) {
  const story = ancestors.length === 0 ? FOLDER_STORIES[folder.label] : undefined;
  const starters = (story?.start ?? []).map(cardOf).filter((c): c is NodeCatalogEntry => !!c);
  // Cards directly in the folder first, then each sub-folder as a caption over its cards.
  const direct = folder.children.filter((e) => e.type !== "category");
  const subs = folder.children.filter((e): e is CatalogCategory => e.type === "category");
  const links = (cards: NodeCatalogEntry[]) => (
    <div className="fr-fold__cards">
      {cards.map((c) => <button key={c.type} type="button" className="fr-land__card" onClick={() => onCard(c)}>{c.label}</button>)}
    </div>
  );
  return (
    <article className="fr-card fr-fold" style={accentStyle}>
      <div className="solenoid-add-menu__item solenoid-add-menu__item--back fr-card__back" onClick={() => onUp(ancestors.length - 1)}>
        <ChevronLeftIcon size={14} /><span>{ancestors[ancestors.length - 1] ?? "Cards"}</span>
      </div>
      <header className="fr-card__head">
        <div className="fr-card__head-row">
          {story?.icon && (
            <span className={`fr-fold__icon${story.icon instanceof SolenoidSocket ? " fr-fold__icon--socket" : ""}`} aria-hidden="true"
              style={story.icon instanceof SolenoidSocket ? undefined : { color: ICON_COLOR[story.icon] }}>
              {story.icon instanceof SolenoidSocket ? <SocketComponent data={story.icon} />
                : story.icon === "frame-mark" ? <FrameMark /> : <TypeIcon type={story.icon} size={22} />}
            </span>
          )}
          <h2 className="fr-card__title">{folder.label}</h2>
        </div>
        {ancestors.length > 0 && (
          <div className="fr-card__crumb">
            {ancestors.map((a, i) => (
              <span key={i} className="fr-card__crumb-part">
                {i > 0 && <span className="fr-card__crumb-sep" aria-hidden="true">▸</span>}
                <button type="button" className="fr-card__crumb-link" onClick={() => onUp(i)}>{a}</button>
              </span>
            ))}
          </div>
        )}
      </header>
      {story && (
        <div className="fr-fold__story">
          <p className="fr-card__desc fr-fold__lede">{story.lede}</p>
          {story.settings && (
            <button type="button" className="fr-card__crumb-link fr-fold__settings" onClick={() => { frStore.close(); settingsPanel.open(); }}>
              Settings<ChevronRightIcon size={10} />
            </button>
          )}
          {story.shape && <div className="fr-fold__shape">{story.shape()}</div>}
          {starters.length > 0 && (
            <p className="fr-fold__start">
              Get started with{" "}
              {starters.map((c, i) => (
                <span key={c.type}>
                  {i > 0 && (i === starters.length - 1 ? " or " : ", ")}
                  <button type="button" className="fr-card__crumb-link fr-fold__start-link" onClick={() => onCard(c)}>{c.label}</button>
                </span>
              ))}
              .
            </p>
          )}
        </div>
      )}
      {ancestors.length > 0 ? (
        // A sub-folder lists its cards as Settings lists its rows: the name, and the first sentence of what it does.
        <div className="fr-fold__rows">
          {leavesOf(folder.children).map((c) => (
            <button key={c.type} type="button" className="solenoid-settings__row fr-fold__row" onClick={() => onCard(c)}>
              <span className="solenoid-settings__row-text">
                <span className="solenoid-settings__row-label">{c.label}</span>
                {c.description && <span className="solenoid-settings__row-help">{firstSentence(c.description)}</span>}
              </span>
            </button>
          ))}
        </div>
      ) : (
      <div className="fr-fold__groups">
        {direct.length > 0 && (
          <section className="fr-card__section"><div className="fr-card__label">{folder.label}</div>{links(leavesOf(direct))}</section>
        )}
        {subs.map((sub) => (
          <section key={sub.label} className="fr-card__section">
            <div className="fr-card__label">{sub.label}</div>
            {links(leavesOf(sub.children))}
          </section>
        ))}
      </div>
      )}
    </article>
  );
}
