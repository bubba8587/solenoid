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
    title: "Computed columns",
    body: "Pick Formula on any table column and define it: @price * @qty computes per row. A bare column name is the whole column and @name is this row's cell, so @revenue / SUM(revenue) is a share of total and SUMIFS(amt, cat, @cat) is a per-group subtotal. Computed columns reference each other and take units and number formats like any typed column. Mid-pipeline, the Computed Column node does the same over any incoming frame.",
  },
  {
    title: "Script node",
    body: "Write a JavaScript function; it runs as a node. The value types itself from what you return: a number, text, [ ] for a list, [[ ]] for a table, rows of {name: value} for a frame. Wired frames arrive the same way. Scripts run sandboxed and time-capped, a volatile one gets a Recalculate button, and the worked-examples canvas in the Examples menu tours Monte Carlo, Collatz, an amortization table, and Friday the 13ths.",
  },
  {
    title: "Query",
    body: "Drop a Query node, drill in, and chain the table verbs inside. Refresh runs it on demand: upstream changes mark the result stale and never silently recompute.",
  },
  {
    title: "The analytics shelf",
    body: "The numpy, pandas, scipy and R toolkit as nodes: Forecast with Holt-Winters intervals, per-group Window columns, K-Means, PCA, FFT, LOWESS smoothing, seasonal decomposition, and Monte Carlo with correlated inputs. The Function Reference gains numpy, pandas, R, SQL and Excel filter chips, so you can search by whichever name you already know.",
  },
  {
    title: "Records and forms",
    body: "The Record node draws one table row as a card you lay out yourself: labeled boxes on a text-defined grid, with Gallery and Board views over the whole frame. A table popup's Form view makes that layout editable; page through rows and enter data in fields that follow each column's type.",
  },
  {
    title: "The Node Inspector",
    body: "Press the (i) and a reference panel docks beside the canvas: what the selected node computes, its Excel equivalent, and each socket described under its own glyph. Frame inputs include an example table showing the columns they expect.",
  },
  {
    title: "Frame hints",
    body: "Hover a frame input's socket and a miniature example table shows the exact columns it expects, with sample data. On touch, tap the row.",
  },
  {
    title: "Type any date",
    body: "Date Input reads a date in about any format and renders it as DD-MMM-YYYY. An ambiguous one answers #AMBIGUOUS! instead of guessing. Opt in to relative dates and today, next friday, or in 3 days resolve on the spot.",
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
