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
    title: "Edit a composite like its own canvas",
    body: "Drill into a composite node and the whole app comes with you — toolbar, minimap, zoom, right-click, copy/paste, keyboard, Tidy. A real canvas, not a stripped-down popup.",
  },
  {
    title: "Ask “what if” — four ways",
    body: "Composite containers run as Goal Seek, Scenarios, Data Table, and Simulation. Heavy runs are arm-and-run: a Solve button and a stale dot, so nothing recomputes behind your back.",
  },
  {
    title: "Live market & economic data",
    body: "Pull FRED economic series and stock/FX quotes straight onto the canvas with your own API keys — refreshes on a timer, charts in a click, and never bakes the data into the file.",
  },
  {
    title: "Every chart Excel has, and then some",
    body: "Pie, Scatter, Bubble, Radar, Radial, Funnel, Composed — plus Treemap, Sankey, Histogram, KPI cards and Bullet graphs, all themed to your palette.",
  },
  {
    title: "Reports & presentations, built in",
    body: "A Report node writes plain markdown with live =value embeds — numbers, tables, charts, equations, Mermaid diagrams. Presenter mode turns the canvas into a click-through slideshow.",
  },
  {
    title: "Make it yours",
    body: "A custom palette editor, per-document properties, type-coloured chips, and a command palette that's every menu action plus your recent ones in one Enter-press.",
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
        A node-based computation graph — an Excel alternative for data tables.
      </p>
      <p className="solenoid-helpdlg__about-body">
        Each node is one operation; typed cables carry values — scalars, lists, tables, frames —
        between them, and the graph recomputes as inputs change. It makes the logic of a
        computation visible and editable in a way a spreadsheet hides.
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
