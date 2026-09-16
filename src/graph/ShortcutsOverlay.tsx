import { useSyncExternalStore } from "react";
import { shortcutsStore } from "./shortcutsStore";
import { useEscapeToClose } from "./components/useEscapeToClose";
import "./ShortcutsOverlay.css";

/** A static, HAND-MAINTAINED mirror of the bindings wired in Canvas's keydown handler. */

type Row = { keys: string[]; label: string };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: "Graph",
    rows: [
      { keys: ["A"], label: "Add a node at the cursor" },
      { keys: ["G"], label: "Group the selection" },
      { keys: ["Ctrl", "Shift", "G"], label: "Make a composite from the selection" },
      { keys: ["I"], label: "Toggle isolate on the selection" },
      { keys: ["T"], label: "Tidy: auto-arrange the selection, or all" },
      { keys: ["E"], label: "Expand or collapse groups, selected or all" },
      { keys: ["F"], label: "Autofit the group box to members, selected or all" },
      { keys: ["C"], label: "Cleanup: tidy groups, collapse, fit" },
      { keys: ["N"], label: "Toggle the Navigator (outline) panel" },
      { keys: ["D"], label: "Draw a cable. Enter finishes it, Esc leaves the tool" },
      { keys: ["[", "]"], label: "Rotate the selected Conduit, Angle Dial, or Standoff" },
      { keys: ["←", "↑", "→", "↓"], label: "Nudge the selection. Shift takes a larger step" },
      { keys: ["Tab"], label: "Expand or collapse all chrome: Navigator, legend, pins, alerts" },
    ],
  },
  {
    title: "Edit",
    rows: [
      { keys: ["Ctrl", "Z"], label: "Undo" },
      { keys: ["Ctrl", "Shift", "Z"], label: "Redo" },
      { keys: ["Ctrl", "Y"], label: "Alternate redo" },
      { keys: ["Ctrl", "C"], label: "Copy selection" },
      { keys: ["Ctrl", "V"], label: "Paste" },
      { keys: ["Del"], label: "Delete selection" },
      { keys: ["Ctrl", "A"], label: "Select all nodes" },
      { keys: ["Ctrl", "F"], label: "Find node in the outline" },
      { keys: ["Ctrl", "Shift", "L"], label: "Reload document and replay the load reveal" },
    ],
  },
  {
    title: "Canvas",
    rows: [
      { keys: ["Enter"], label: "Command palette" },
      { keys: ["Right-click"], label: "Add node menu" },
      { keys: ["Shift", "drag"], label: "Box / lasso select" },
      { keys: ["Drag"], label: "Pan the canvas" },
      { keys: ["Scroll"], label: "Zoom in / out" },
      { keys: ["Ctrl", "click"], label: "Toggle a node in the selection" },
      { keys: ["Esc"], label: "Exit isolate" },
    ],
  },
  {
    title: "Help",
    rows: [
      { keys: ["Ctrl", "/"], label: "Function reference" },
      { keys: ["Ctrl", ","], label: "Settings" },
      { keys: ["F9"], label: "Calculate now" },
    ],
  },
];

export function ShortcutsOverlay() {
  const open = useSyncExternalStore(shortcutsStore.subscribe, shortcutsStore.get);

  useEscapeToClose(() => shortcutsStore.close(), open);

  if (!open) return null;

  return (
    <div className="solenoid-shortcuts" onPointerDown={() => shortcutsStore.close()}>
      <div className="solenoid-shortcuts__panel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="solenoid-shortcuts__header">
          <span className="solenoid-shortcuts__title">Keyboard shortcuts</span>
          <button className="solenoid-shortcuts__close" onClick={() => shortcutsStore.close()} aria-label="Close">×</button>
        </div>
        <div className="solenoid-shortcuts__grid">
          {GROUPS.map((g) => (
            <div key={g.title} className="solenoid-shortcuts__group">
              <div className="solenoid-shortcuts__group-title">{g.title}</div>
              {g.rows.map((r) => (
                <div key={r.label} className="solenoid-shortcuts__row">
                  <span className="solenoid-shortcuts__label">{r.label}</span>
                  <span className="solenoid-shortcuts__keys">
                    {r.keys.map((k, i) => (
                      <kbd key={i} className="solenoid-shortcuts__kbd">{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
