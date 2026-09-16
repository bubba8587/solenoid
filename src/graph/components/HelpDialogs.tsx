import { useEffect, useState, useSyncExternalStore } from "react";
import { helpDialogStore, WHATS_NEW_VERSION } from "../helpDialogStore";
import { CloseIcon } from "./CloseIcon";
import pkg from "../../../package.json";
import "./helpDialogs.css";

// The [slide]-tagged headliners from docs/release-notes-features.md — keep them in
// sync with WHATS_NEW_VERSION.
type Slide = { title: string; body: string };
const SLIDES: Slide[] = [
  {
    title: "Your Obsidian vault is a table",
    body: "Point Solenoid at a vault and the Vault Folder node reads a folder of notes as one cube: every property a column, the note body when you ask. Filter, group, chart and compute over your notes, then write back. Write to Obsidian turns a Document into a note or a cube of rows into each note's properties, with a Preview before Run. Import Obsidian Note reads one note's properties as sockets. A bundled demo vault shows all of it on the web with no vault of your own.",
  },
  {
    title: "TaskNotes, live",
    body: "The TaskNotes node feeds your tasks, calendar or stats straight off the plugin's API, and Write Tasks sends rows back as new or updated tasks. The Tasks from TaskNotes and Kitchen remodel examples plan a week from a real task list.",
  },
  {
    title: "Reports are templates",
    body: "Note and Report bodies speak Knap, Obsidian's template language: {{ name }} embeds a wired value as the canvas shows it, {% if %} and {% for %} build the prose, and a wired template note supplies the text with its variables as sockets. Wire a frame into Records and the Report is a mail merge: one page per row, one note per page in the vault.",
  },
  {
    title: "Schedules and Gantt charts",
    body: "The Schedule node runs a real critical-path pass over a task table: working days or minutes, weekends and holidays, links with lag and lead, phases that roll up, a status date, float and diagnostics. The Gantt figure draws it with phase brackets, milestones, deadline pennants, a baseline ghost and a month calendar layout. Local File imports a Microsoft Project XML, GanttProject or Primavera XER plan.",
  },
  {
    title: "Everyday sources",
    body: "Weather, Geocode, Holidays, Currency, Time Zone Convert, World Clock and QR Code: the nodes that make a document worth leaving open. A document from elsewhere loads with the network quiet until you allow it, once, per document. The Garden Dashboard example wires Geocode into Weather and totals the rain either side of today.",
  },
  {
    title: "Planners",
    body: "Payoff Planner rolls a debt list month by month, avalanche or snowball, with the freed payments cascading. Group Cost Settle turns a shared-expense ledger into who owes whom, by totals or by transaction. Earned Value scores a plan against a status date.",
  },
  {
    title: "Categorical columns",
    body: "Pick Chip on a text column and its distinct values become tinted chips in the table popup and on the Format Controller. Entry on that column offers the existing values instead of a blank field.",
  },
  {
    title: "Peek any socket",
    body: "Hover an output socket and a scaled-down live Display of its value appears: a frame, a cube, a list, a chart or a diagram, without wiring anything.",
  },
  {
    title: "Draw on the canvas",
    body: "Free-drawn cables annotate a graph point by point in the wired cables' three shapes, with arrowheads, width, color and a 45 degree angle dial per point. Press D.",
  },
];

export function HelpDialogs() {
  const mode = useSyncExternalStore(helpDialogStore.subscribe, helpDialogStore.get);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (mode === "whatsnew") setSlide(0);
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { helpDialogStore.close(); return; }
      if (mode !== "whatsnew") return;
      if (e.key === "ArrowRight") setSlide((s) => Math.min(SLIDES.length - 1, s + 1));
      if (e.key === "ArrowLeft") setSlide((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  if (!mode) return null;

  return (
    <div className="solenoid-helpdlg" onPointerDown={() => helpDialogStore.close()}>
      <div className="solenoid-helpdlg__panel" onPointerDown={(e) => e.stopPropagation()}>
        <button className="solenoid-helpdlg__close" onClick={() => helpDialogStore.close()} aria-label="Close">
          <CloseIcon />
        </button>
        {mode === "about" ? <About /> : <WhatsNew slide={slide} setSlide={setSlide} />}
      </div>
    </div>
  );
}

function About() {
  return (
    <div className="solenoid-helpdlg__about">
      <div className="solenoid-helpdlg__wordmark">Solenoid</div>
      <div className="solenoid-helpdlg__version">Version {pkg.version}</div>
      <p className="solenoid-helpdlg__tagline">
        A node-graph alternative to Excel for data tables.
      </p>
      <p className="solenoid-helpdlg__about-body">
        Each node is one operation, and typed cables carry values between them: scalars, lists,
        tables, and frames. The graph recomputes as its inputs change, so the steps of a
        calculation stay visible on the canvas. Cables enforce their types, a number can't wire
        into a date, and a value's unit and format travel with it until a calculation changes it.
      </p>
      <button
        className="solenoid-helpdlg__btn solenoid-helpdlg__btn--accent"
        onClick={() => helpDialogStore.openWhatsNew()}
      >
        What's new in {WHATS_NEW_VERSION}
      </button>
    </div>
  );
}

function WhatsNew({ slide, setSlide }: { slide: number; setSlide: (n: number) => void }) {
  const s = SLIDES[slide];
  const last = slide === SLIDES.length - 1;
  return (
    <div className="solenoid-helpdlg__whatsnew">
      <div className="solenoid-helpdlg__eyebrow">What's new in {WHATS_NEW_VERSION}</div>
      <div className="solenoid-helpdlg__slide">
        <div className="solenoid-helpdlg__slide-num">{slide + 1} / {SLIDES.length}</div>
        <div className="solenoid-helpdlg__slide-title">{s.title}</div>
        <div className="solenoid-helpdlg__slide-body">{s.body}</div>
      </div>
      <div className="solenoid-helpdlg__nav">
        <button
          className="solenoid-helpdlg__btn"
          onClick={() => setSlide(Math.max(0, slide - 1))}
          disabled={slide === 0}
        >
          Back
        </button>
        <div className="solenoid-helpdlg__dots">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`solenoid-helpdlg__dot${i === slide ? " solenoid-helpdlg__dot--on" : ""}`}
              onClick={() => setSlide(i)}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
        {last ? (
          <button
            className="solenoid-helpdlg__btn solenoid-helpdlg__btn--accent"
            onClick={() => helpDialogStore.close()}
          >
            Done
          </button>
        ) : (
          <button
            className="solenoid-helpdlg__btn solenoid-helpdlg__btn--accent"
            onClick={() => setSlide(Math.min(SLIDES.length - 1, slide + 1))}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
