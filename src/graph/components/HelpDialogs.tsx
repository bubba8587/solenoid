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
    title: "What-if analysis",
    body: "Wrap part of a model in a composite node and ask what-if without disturbing the rest. Goal Seek drives an input until an output hits a target, Scenarios compare saved cases, a Data Table sweeps a grid of inputs, and Simulation steps a feedback loop. The heavier modes run when you press Solve, and a marker shows when a result no longer matches its inputs.",
  },
  {
    title: "Command palette",
    body: "Press Ctrl+K and type. Every menu action and toggle is one search away, with your recent actions first. A Settings option keeps the palette docked on screen.",
  },
  {
    title: "Live market and economic data",
    body: "Pull FRED economic series onto the canvas with no API key, and stock history with a free Alpha Vantage key. Pick a date range and frequency, chart the series, and compute on the same numbers. Feeds refresh on a timer and are never saved into the file.",
  },
  {
    title: "Rebuilt for your phone",
    body: "The mobile layout is three zones: the document strip on top, the tool row under it, and a thumb-reach action bar with undo, add, select, and delete at the bottom. The command palette, navigator, and example menu all work on a small screen.",
  },
  {
    title: "Reports",
    body: "A Report is a markdown document that embeds live values by name. Type =total and the number, table, chart, equation, or diagram it names renders inline and stays current as the graph recomputes. Dock a report to the right edge and keep working on the canvas beside it.",
  },
  {
    title: "Presenter mode",
    body: "A Presentation node turns the canvas into a slideshow. Press Present and the camera flies from step to step while the app chrome hides; click or press Space to advance. The graph stays live, so a slide reacts when its inputs change.",
  },
  {
    title: "Mermaid diagrams",
    body: "A Mermaid node renders flowcharts, sequence and state diagrams, Gantt charts, and pie charts from plain text. A template dropdown drops in a working starter, and the diagram embeds in a Report like any chart.",
  },
  {
    title: "Set operations",
    body: "Union, intersection, difference, and symmetric difference over two lists, plus a second node for membership tests. The card renders its operation in set notation. Excel has no direct equivalent.",
  },
  {
    title: "More chart types",
    body: "Pie, Scatter, Bubble, Radar, Radial, Funnel, and Composed, plus Treemap, Sankey, Histogram, KPI cards, and Bullet graphs. A Histogram bins a list for you; KPI cards and Bullet graphs turn a number into a dashboard tile.",
  },
  {
    title: "Align and distribute",
    body: "Select two or more nodes and an alignment bar appears above the canvas: align edges or centers, and distribute spacing evenly, in either direction.",
  },
  {
    title: "Palette editor",
    body: "Design your own color palette on live sample nodes, then use it app-wide or pin one to a document. Charts, diagrams, and the desktop window border follow it.",
  },
];

export function HelpDialogs() {
  const mode = useSyncExternalStore(helpDialogStore.subscribe, helpDialogStore.get);
  const [slide, setSlide] = useState(0);

  // Reset to the first slide whenever What's New (re)opens.
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
