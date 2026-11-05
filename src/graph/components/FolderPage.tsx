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

/** What a folder holds, said once, and the drawing of its shape. Folders without one show their cards alone. */
const FOLDER_STORIES: Record<string, { lede: string; shape?: () => ReactNode; icon?: TypeIconKind | SolenoidSocket }> = {
  Numbers: {
    icon: "number",
    lede: "A number can carry a unit, set where the value starts. A calculation works out its result's unit: meters times meters is square meters, and adding meters to seconds is a #UNIT! error.",
    shape: () => box(tagDim(2410, { length: 1 }, "km")),
  },
  Lists: {
    icon: numListSocket,
    lede: "An ordered run of values of one kind. A blank item is missing, not zero: totals skip it and it keeps its place.",
    shape: () => box([3, 6, 4, 8, 7]),
  },
  Tables: {
    icon: tableSocket,
    lede: "Rows of plain values, with no column names or types: the shape a formula's array takes. A table holds one kind of value and one unit throughout.",
    shape: () => <div className="fr-fold__box"><TableDisplay table={[[1, 2, 3], [4, 5, 6], [7, 8, 9]]} elem="number" /></div>,
  },
  Frames: {
    icon: "frame",
    lede: "A table with headers. Each column has a name and one type, so a column of dates stays dates and a column can carry its own unit. Formulas don't take Frames; Get Column and Split Frame take the pieces out. A Cube is a Frame whose cells can hold anything, a whole Frame included, so nested data stays nested.",
    shape: () => <FrameShapes />,
  },
  Logic: {
    icon: "logical",
    lede: "TRUE and FALSE, plus unknown when an answer can't be told: TRUE OR unknown is TRUE, and FALSE OR unknown stays unknown. In arithmetic TRUE counts as 1 and FALSE as 0.",
  },
  Text: {
    icon: "string",
    lede: "Every text card works on one piece of text or, item by item, on a List of them.",
    shape: () => box("Ada Lovelace"),
  },
  "Date & Time": {
    icon: "date",
    lede: "A date is its own kind of value. It shows as a date wherever it goes and does day math; a number becomes a date only through Cast.",
    shape: () => box(solDate(46331)),
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
function leavesOf(entries: CatalogEntry[]): NodeCatalogEntry[] {
  return entries.flatMap((e) => e.type === "category" ? leavesOf((e as CatalogCategory).children)
    : e.type === "pair" ? (e as CatalogPair).children.filter((c) => !c.hidden)
    : (e as NodeCatalogEntry).hidden ? [] : [e as NodeCatalogEntry]);
}

export function FolderPage({ folder, accentStyle, onCard }: {
  folder: CatalogCategory; accentStyle?: CSSProperties; onCard: (leaf: NodeCatalogEntry) => void;
}) {
  const story = FOLDER_STORIES[folder.label];
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
      <header className="fr-card__head">
        <div className="fr-card__head-row">
          {story?.icon && (
            <span className="fr-fold__icon" aria-hidden="true">
              {story.icon instanceof SolenoidSocket ? <SocketComponent data={story.icon} /> : <TypeIcon type={story.icon} size={22} />}
            </span>
          )}
          <h2 className="fr-card__title">{folder.label}</h2>
        </div>
      </header>
      {story && (
        <div className="fr-fold__story">
          <p className="fr-card__desc fr-fold__lede">{story.lede}</p>
          {story.shape && <div className="fr-fold__shape">{story.shape()}</div>}
        </div>
      )}
      <div className="fr-fold__groups">
        {direct.length > 0 && <section className="fr-card__section">{links(leavesOf(direct))}</section>}
        {subs.map((sub) => (
          <section key={sub.label} className="fr-card__section">
            <div className="fr-card__label">{sub.label}</div>
            {links(leavesOf(sub.children))}
          </section>
        ))}
      </div>
    </article>
  );
}
