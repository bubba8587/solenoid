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
    title: "Linux desktop",
    body: "Solenoid now runs as a desktop app on Linux as well as Windows. Get the AppImage or the .deb from the Download page.",
  },
  {
    title: "Formula columns",
    body: "Pick Fx on a Frame Input column to write a formula over the row, such as @qty * @price. A formula that returns a date stays a date.",
  },
  {
    title: "Obsidian markdown in notes",
    body: "Note, Import Obsidian Note and the Report preview now render wikilinks, tags, callouts, highlights and math the way Obsidian does.",
  },
  {
    title: "Solenoid Properties for Obsidian",
    body: "A companion Obsidian plugin adds List, Matrix, Frame and Cube property types, shown as Solenoid's chips and edited in its table editor. Values stay plain YAML in the note.",
  },
  {
    title: "Table editing",
    body: "The table popup's Form and CSV views now edit in place. A date cell gets a calendar, a Boolean cell a checkbox, and a text cell suggests the values already in its column.",
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
