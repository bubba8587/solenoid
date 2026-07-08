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
    title: "Edit composites in the full canvas",
    body: "Drill into a composite node to work on its inner graph with the whole editor. The minimap, zoom, right-click menu, copy/paste, and Tidy all behave the same as they do on the main canvas.",
  },
  {
    title: "What-if analysis",
    body: "A composite container can run as Goal Seek, Scenarios, a Data Table, or an iterative Simulation. The heavier modes recompute when you press Solve, and a marker shows when the result no longer matches its inputs.",
  },
  {
    title: "Live market and economic data",
    body: "Pull FRED economic series onto the canvas with no API key, and stock history with a free Alpha Vantage key. Feeds refresh on a timer and are never saved into the file.",
  },
  {
    title: "More chart types",
    body: "Pie, Scatter, Bubble, Radar, Radial, Funnel, and Composed, plus Treemap, Sankey, Histogram, KPI cards, and Bullet graphs. Every chart follows your palette.",
  },
  {
    title: "Reports and presentations",
    body: "The Report node is plain markdown that embeds live values by name: numbers, tables, charts, equations, and Mermaid diagrams. Presenter mode plays the canvas back as a slideshow.",
  },
  {
    title: "Theming and shortcuts",
    body: "A palette editor, per-document properties, type-coloured chips, and a command palette that covers every menu action alongside the ones you've used recently.",
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
        calculation stay visible on the canvas.
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
