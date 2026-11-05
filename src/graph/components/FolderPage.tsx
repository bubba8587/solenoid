// [[B14]] oneDesignSystem (DESIGN.md § Voice: the Reference explains what normal use can't make obvious)
// A top-level folder's page in the Reference: what its kind of value is, drawn small, then its cards by sub-folder.
import type { CSSProperties, ReactNode } from "react";
import type { CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry } from "../AddNodeMenu";
import {
  SolenoidSocket, numberSocket, numListSocket, tableSocket, frameSocket, cubeSocket, stringSocket, dateSocket,
} from "../sockets";
import { SocketComponent } from "./SocketComponent";
import { TypeIcon, type TypeIconKind } from "./TypeIcon";

/** What a folder holds, said once, and the drawing of its shape. Folders without one show their cards alone. */
const FOLDER_STORIES: Record<string, { lede: string; shape?: () => ReactNode; icon?: TypeIconKind | SolenoidSocket }> = {
  Numbers: {
    icon: "number",
    lede: "A number can carry a unit, set where the value starts. A calculation works out its result's unit: meters times meters is square meters, and adding meters to seconds is a #UNIT! error.",
    shape: () => <ValueShape socket={numberSocket} value="2.41" unit="km" />,
  },
  Lists: {
    icon: numListSocket,
    lede: "An ordered run of values of one kind. A blank item is missing, not zero: totals skip it and it keeps its place.",
    shape: () => <ListShape />,
  },
  Tables: {
    icon: tableSocket,
    lede: "Rows of plain values, with no column names or types: the shape a formula's array takes. A table holds one kind of value and one unit throughout.",
    shape: () => <GridShape />,
  },
  Frames: {
    icon: "frame",
    lede: "A table with headers. Each column has a name and one type, so a column of dates stays dates and a column can carry its own unit. Formulas don't take Frames; Get Column and Split Frame take the pieces out.",
    shape: () => <FrameShapes />,
  },
  Logic: {
    icon: "logical",
    lede: "TRUE and FALSE, plus unknown when an answer can't be told: TRUE OR unknown is TRUE, and FALSE OR unknown stays unknown. In arithmetic TRUE counts as 1 and FALSE as 0.",
  },
  Text: {
    icon: "string",
    lede: "Every text card works on one piece of text or, item by item, on a List of them.",
    shape: () => <ValueShape socket={stringSocket} value="“Ada Lovelace”" />,
  },
  "Date & Time": {
    icon: "date",
    lede: "A date is its own kind of value. It shows as a date wherever it goes and does day math; a number becomes a date only through Cast.",
    shape: () => <ValueShape socket={dateSocket} value="05-Nov-2026" />,
  },
};

const sock = (s: SolenoidSocket) => <span className="fr-fold__sock"><SocketComponent data={s} /></span>;

function ValueShape({ socket, value, unit }: { socket: SolenoidSocket; value: string; unit?: string }) {
  return (
    <div className="fr-fold__value">
      <span className="fr-fold__cell">{value}{unit && <span className="fr-fold__unit"> {unit}</span>}</span>
      {sock(socket)}
    </div>
  );
}

function ListShape() {
  return (
    <div className="fr-fold__value">
      <span className="fr-fold__row">
        {["3", "6", "", "8", "7"].map((v, i) => <span key={i} className={`fr-fold__cell${v ? "" : " fr-fold__cell--blank"}`}>{v}</span>)}
      </span>
      {sock(numListSocket)}
    </div>
  );
}

function GridShape() {
  const rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]];
  return (
    <div className="fr-fold__value">
      <span className="fr-fold__grid" style={{ "--cols": 3 } as CSSProperties}>
        {rows.flat().map((v, i) => <span key={i} className="fr-fold__cell">{v}</span>)}
      </span>
      {sock(tableSocket)}
    </div>
  );
}

const FRAME_COLS: { name: string; type: "string" | "date" | "number"; cells: string[] }[] = [
  { name: "Item", type: "string", cells: ["Rent", "Power", "Water"] },
  { name: "Due", type: "date", cells: ["01-Dec", "08-Dec", "15-Dec"] },
  { name: "Amount", type: "number", cells: ["$1,200", "$84", "$31"] },
];

function FrameTable({ cols, nest }: { cols: typeof FRAME_COLS; nest?: number }) {
  return (
    <span className="fr-fold__grid fr-fold__grid--frame" style={{ "--cols": cols.length } as CSSProperties}>
      {cols.map((c) => (
        <span key={c.name} className="fr-fold__head"><TypeIcon type={c.type} size={11} />{c.name}</span>
      ))}
      {cols[0].cells.map((_, r) => cols.map((c, ci) => (
        <span key={`${r}-${ci}`} className="fr-fold__cell">
          {nest === r && ci === cols.length - 1 ? <NestedFrame /> : c.cells[r]}
        </span>
      )))}
    </span>
  );
}

function NestedFrame() {
  return (
    <span className="fr-fold__grid fr-fold__grid--frame fr-fold__grid--nested" style={{ "--cols": 2 } as CSSProperties}>
      <span className="fr-fold__head">Meter</span><span className="fr-fold__head">kWh</span>
      <span className="fr-fold__cell">A</span><span className="fr-fold__cell">212</span>
      <span className="fr-fold__cell">B</span><span className="fr-fold__cell">96</span>
    </span>
  );
}

function FrameShapes() {
  return (
    <div className="fr-fold__pair">
      <div>
        <div className="fr-fold__value"><FrameTable cols={FRAME_COLS} />{sock(frameSocket)}</div>
        <div className="fr-fold__caption">Frame</div>
      </div>
      <div>
        <div className="fr-fold__value">
          <FrameTable cols={[FRAME_COLS[0], { name: "Readings", type: "string", cells: ["", "", ""] }]} nest={1} />
          {sock(cubeSocket)}
        </div>
        <div className="fr-fold__caption">Cube: any cell can hold a whole Frame, so nested data stays nested.</div>
      </div>
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
          {story.shape && <div className="fr-fold__shape">{story.shape()}</div>}
          <p className="fr-card__desc fr-fold__lede">{story.lede}</p>
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
