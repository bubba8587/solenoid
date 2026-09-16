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
    title: "Obsidian integration",
    body: "Import individual Obsidian markdown notes, vault-wide frontmatter properties, and sync with Tasknotes data. The newly created Knap language and the Report Node's template socket work together to put your spreadsheet values directly into your note contents.",
  },
  {
    title: "TaskNotes",
    body: "The TaskNotes node reads advanced task, calendar and stats data from the HTTP API. Check out the \"Tasks from TaskNotes\" and \"Kitchen remodel\" example graphs, as well as the Calendar layout of the new Gantt chart node.",
  },
  {
    title: "Reports Templates and Form-filling",
    body: "Note and Report bodies now use Knap, Obsidian's new template language. The Report's Record socket generates documents with one page per input row.",
  },
  {
    title: "Schedules and Gantt charts",
    body: "The Schedule node runs a critical-path pass over a task table for advanced Gantt chart generation. Local File imports Microsoft Project XML, GanttProject or Primavera XER plans.",
  },
  {
    title: "Everyday sources",
    body: "Check out the Weather, Geocode, Holidays, Currency, Time Zone Convert, World Clock and QR Code nodes. See the Garden Dashboard example.",
  },
  {
    title: "Planners",
    body: "Payoff Planner helps you plan an efficient payoff schedule for various debts. Group Cost Settle helps you calculate who owes whom, by totals or by transaction.",
  },
  {
    title: "Categorical columns",
    body: "Pick Chip on a text column in a data frame for per-category color formatting.",
  },
  {
    title: "Peek any socket",
    body: "Hover over an output socket for a preview of its contents.",
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
