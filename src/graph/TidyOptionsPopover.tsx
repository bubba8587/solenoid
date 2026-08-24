import { useSyncExternalStore } from "react";
import { settingsStore, type Settings } from "./settingsStore";
import { useEscapeToClose } from "./components/useEscapeToClose";
// Reuse Settings' segment-pill styles (`.solenoid-settings__segment/__segbtn`) so the
// popover and the Settings rows can't drift; the file is fully scoped to those classes.
import "./Settings.css";

// Labels only, no sentences (DESIGN §7): the segment buttons carry the meaning.
const TIDY_ROWS: ReadonlyArray<{
  key: "tidyDirection" | "tidyDensity" | "tidyWidthCap";
  label: string;
  options: ReadonlyArray<readonly [string, string]>;
}> = [
  { key: "tidyDirection", label: "Direction", options: [["right", "Right"], ["down", "Down"]] },
  { key: "tidyDensity", label: "Density", options: [["compact", "Compact"], ["normal", "Normal"], ["airy", "Airy"]] },
  { key: "tidyWidthCap", label: "Width cap", options: [["off", "Off"], ["2", "2"], ["3", "3"], ["4", "4"]] },
];

/** The Tidy-knobs popover off the top-bar Tidy button. Mirrors Settings' segment rows,
 *  writing straight to `settingsStore` (both ELK call sites read them at layout time).
 *  Clickaway close is owned by the opener in TopBar; Escape closes here. */
export function TidyOptionsPopover({ onClose }: { onClose: () => void }) {
  // Re-render on a knob change so the active pill re-highlights.
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  useEscapeToClose(onClose);
  return (
    <div className="solenoid-tidy-options" role="dialog" aria-label="Tidy options">
      {TIDY_ROWS.map((row) => {
        const value = settingsStore.get(row.key) as string;
        return (
          <div key={row.key} className="solenoid-tidy-options__row">
            <span className="solenoid-tidy-options__label">{row.label}</span>
            <span className="solenoid-settings__segment" role="radiogroup" aria-label={row.label}>
              {row.options.map(([v, lbl]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={value === v}
                  className={`solenoid-settings__segbtn${value === v ? " solenoid-settings__segbtn--on" : ""}`}
                  onClick={() => settingsStore.set(row.key, v as Settings[typeof row.key])}
                >
                  {lbl}
                </button>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
