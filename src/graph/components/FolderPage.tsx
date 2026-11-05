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

/** Each top-level folder's page: what Solenoid has for that part of the work, a real value of its kind where it has
 *  one, and the card to start with (a catalog type; it may live in another folder). */
const FOLDER_STORIES: Record<string, {
  lede: string; shape?: () => ReactNode; icon?: TypeIconKind | SolenoidSocket | "frame-mark"; settings?: boolean; start?: string;
}> = {
  Input: {
    lede: "Solenoid has a variety of nodes for data entry, control widgets, and connections & queries.",
    start: "value-input",
  },
  Output: {
    lede: "Solenoid has nodes for showing results: displays, charts & gauges, and record & card views for reading rows.",
    start: "display",
  },
  Numbers: {
    icon: "number",
    lede: "Solenoid has nodes for arithmetic, rounding, trigonometry and the rest of Excel's math, plus formula nodes that hold a whole expression. Numbers can carry units, and the math keeps them right.",
    shape: () => box(tagDim(2410, { length: 1 }, "km")),
    start: "expression",
  },
  Lists: {
    icon: numListSocket,
    lede: "Solenoid has nodes for building, aggregating, shaping & searching Lists: ordered runs of values of one type. A blank item stays blank, so totals skip it.",
    shape: () => box([3, 6, 4, 8, 7]),
    start: "list-input",
  },
  Tables: {
    icon: tableSocket,
    lede: "Solenoid has nodes for reshaping tables and for matrix math. A table is rows of plain values with no column names, the same shape a formula's array takes.",
    shape: () => <div className="fr-fold__box"><TableDisplay table={[[1, 2, 3], [4, 5, 6], [7, 8, 9]]} elem="number" /></div>,
    start: "table-input",
  },
  Frames: {
    icon: "frame-mark",
    lede: "Solenoid has nodes for building, filtering, joining & reshaping Frames: tables whose columns each have a name and a type. A Cube is a Frame whose cells can hold anything, even another Frame, so nested data stays nested.",
    shape: () => <FrameShapes />,
    start: "frame-input",
  },
  Text: {
    icon: "string",
    lede: "Solenoid has nodes for building, slicing, searching & cleaning text. Each one works on a single piece of text or on a whole List at once.",
    shape: () => box("Ada Lovelace"),
    start: "text-concat",
  },
  "Date & Time": {
    icon: "date",
    lede: "Solenoid has nodes for building, parsing & shifting dates, pulling out their parts, and counting the days between them. Dates stay dates wherever they go.",
    shape: () => box(solDate(46331)),
    start: "date-today",
  },
  Logic: {
    icon: "logical",
    lede: "Solenoid has nodes for conditions, tests and TRUE/FALSE logic, with a third answer, unknown, for when a value can't be told.",
    shape: () => box(true),
    start: "if",
  },
  Finance: {
    lede: "Solenoid has nodes for loans, investments, depreciation & bonds: Excel's finance functions, plus schedules that take a single node.",
    start: "tvm",
  },
  "Docs & Files": {
    lede: "Solenoid has nodes for notes, reports & dashboards that show live values and charts, and for reading & writing files.",
    start: "note",
  },
  Packs: {
    lede: "Packs add nodes and formulas for one subject, like geometry, circuits or health. Turn them on in Settings.",
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
  const starter = story?.start ? cardOf(story.start) : null;
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
          {starter && (
            <p className="fr-fold__start">
              Get started with {/[a-z]/.test(starter.label) ? "the " : ""}
              <button type="button" className="fr-card__crumb-link fr-fold__start-link" onClick={() => onCard(starter)}>{starter.label}</button>.
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
