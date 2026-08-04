import { useEffect, useState, useSyncExternalStore } from "react";
import { helpDialogStore, WHATS_NEW_VERSION } from "../helpDialogStore";
import { CloseIcon } from "./CloseIcon";
import pkg from "../../../package.json";
import "./helpDialogs.css";

// ── What's New slides — the [slide]-tagged headliners from
//    docs/release-notes-features.md. Keep in sync with WHATS_NEW_VERSION. ──
type Slide = { title: string; body: string };
const SLIDES: Slide[] = [
  {
    title: "Real units",
    body: "Values carry units now. SUM(5 km, 3) is 8 km, m × m is m², and meters plus seconds fails loud with #UNIT! instead of silently adding nonsense. Units ride through lists, frame columns, lookups and selectors; the Format Controller authors them, Convert changes them, and 10 m ÷ 2 m cancels to a pure 5:1 ratio.",
  },
  {
    title: "Monte Carlo",
    body: "Give a composite's inputs a ± spread and its outputs come back as distributions: mean ± deviation with a histogram, from a seeded, reproducible sampler. Uncertainty as a value, alongside Goal Seek, Scenarios, and Data Table.",
  },
  {
    title: "Draw your data",
    body: "Three controls make data by hand. Point Plotter turns clicks on a plane into X and Y lists, Curve samples a draggable no-overshoot spline into a list, and Grid Painter fills a matrix with a value brush. Sketch a dataset, then run real math on it.",
  },
  {
    title: "Terrain and fields",
    body: "Wire one coordinate-bordered grid through the whole family: Grid Interpolate fills the blanks with a smooth surface, Surface draws it as a shaded 3-D mesh, Contour draws the map view with iso-lines, and Vector Field draws arrow flows. Add Index's new two-way output turns any table into that grid in one hop.",
  },
  {
    title: "Seven new chart types",
    body: "Waterfall for the finance bridge, Candlestick for price history (wire Data Feed straight in), Boxplot, a GitHub-style Calendar heatmap, Waffle shares, Contour, and Vector Field — plus a flat 7-Segment meter readout. All of them embed live in Reports.",
  },
  {
    title: "Obsidian, both directions",
    body: "Import a vault note as a live, typed source — its frontmatter becomes output sockets, and Reload re-reads from disk. Write Notes and Reports back into the vault as portable markdown with real tables, mermaid blocks, math, and rendered chart images.",
  },
  {
    title: "Table cleanup, the daily set",
    body: "Fill Down un-merges report-shaped tables, Replace Values fixes cells in place, Merge Columns is the inverse of Split Column, Promote Headers lifts a first row into names, Drop Blank Rows clears the spacers, and Head slices first / last / skip / range.",
  },
  {
    title: "Scrub any number",
    body: "Drag any number field to set it — hold Shift for coarse steps, Alt for fine. Works on every number input in the app, including the Number node itself.",
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
