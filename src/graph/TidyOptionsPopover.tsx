import { useSyncExternalStore, type ReactNode } from "react";
import { settingsStore, type Settings } from "./settingsStore";
import { useEscapeToClose } from "./components/useEscapeToClose";
// Desktop reuses Settings' segment styles so the popover and the Settings rows can't drift; the phone's is a top-bar
// menu like the ⋮ sheet, built from the same parts.
import "./Settings.css";
import "./phonePanel.css";

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

/** `actions` makes it the phone's shared Tidy dropdown, a top-bar menu like the ⋮ sheet: the actions are pill buttons in
 *  its heading, the options switch rows under it; picking an action runs it and closes. */
export function TidyOptionsPopover({ onClose, actions }: { onClose: () => void; actions?: readonly TidyAction[] }) {
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  useEscapeToClose(onClose);
  if (actions?.length) {
    return (
      <div className="sol-mpanel solenoid-tidy-menu" role="dialog" aria-label="Tidy and Cleanup">
        <div className="sol-mpanel__heading">
          Layout
          {actions.map((a) => (
            <button key={a.label} type="button" className="sol-mpanel__pill" title={a.hint} onClick={() => { a.run(); onClose(); }}>
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
        {TIDY_ROWS.map((row) => {
          const value = settingsStore.get(row.key) as string;
          return (
            <div key={row.key} className="sol-mpanel__ctlrow">
              <span>{row.label}</span>
              <span className="sol-mpanel__seg" role="radiogroup" aria-label={row.label}>
                {row.options.map(([v, lbl]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={value === v}
                    className={`sol-mpanel__segbtn${value === v ? " sol-mpanel__segbtn--on" : ""}`}
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
