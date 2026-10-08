import { useSyncExternalStore, type ReactNode } from "react";
import { settingsStore, type Settings } from "./settingsStore";
import { useEscapeToClose } from "./components/useEscapeToClose";
// Reuses Settings' segment-pill styles so the popover and the Settings rows can't drift.
import "./Settings.css";

const TIDY_ROWS: ReadonlyArray<{
  key: "tidyDirection" | "tidyDensity" | "tidyWidthCap";
  label: string;
  options: ReadonlyArray<readonly [string, string]>;
}> = [
  { key: "tidyDirection", label: "Direction", options: [["right", "Right"], ["down", "Down"]] },
  { key: "tidyDensity", label: "Density", options: [["compact", "Compact"], ["normal", "Normal"], ["airy", "Airy"]] },
  { key: "tidyWidthCap", label: "Width cap", options: [["off", "Off"], ["2", "2"], ["3", "3"], ["4", "4"]] },
];

/** Writes straight to settingsStore, which both ELK call sites read at layout time. Clickaway close is owned by the
 *  opener in TopBar; Escape closes here. */
export type TidyAction = { label: string; hint: string; icon: ReactNode; run: () => void };

/** `actions` puts command rows above the options (the phone's shared Tidy dropdown); picking one runs it and closes. */
export function TidyOptionsPopover({ onClose, actions }: { onClose: () => void; actions?: readonly TidyAction[] }) {
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  useEscapeToClose(onClose);
  return (
    <div className="solenoid-tidy-options" role="dialog" aria-label="Tidy options">
      {actions?.length ? (
        <div className="solenoid-tidy-options__actions">
          {actions.map((a) => (
            <button key={a.label} type="button" className="solenoid-tidy-options__action" onClick={() => { a.run(); onClose(); }}>
              <span className="solenoid-tidy-options__action-icon" aria-hidden="true">{a.icon}</span>
              <span className="solenoid-tidy-options__action-label">{a.label}</span>
              <span className="solenoid-tidy-options__action-hint">{a.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
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
