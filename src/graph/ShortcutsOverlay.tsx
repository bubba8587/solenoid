import { useEffect, useSyncExternalStore } from "react";
import { shortcutsStore } from "./shortcutsStore";
import "./ShortcutsOverlay.css";

/**
 * Keyboard-shortcuts reference overlay. Opened from Help → Keyboard shortcuts.
 * A static, hand-maintained list grouped by area; mirrors the actual bindings
 * wired in Canvas's keydown handler and the canvas interactions.
 */

type Row = { keys: string[]; label: string };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: "Graph",
    rows: [
      { keys: ["A"], label: "Add node (at the cursor)" },
      { keys: ["G"], label: "Group selection" },
      { keys: ["I"], label: "Isolate selection (toggle)" },
      { keys: ["T"], label: "Tidy (auto-arrange selection / all)" },
      { keys: ["E"], label: "Expand / collapse groups (selected / all)" },
      { keys: ["F"], label: "Autofit group box to members (selected / all)" },
      { keys: ["C"], label: "Cleanup (tidy groups + collapse + fit)" },
      { keys: ["[", "]"], label: "Rotate selected Conduit / Angle Dial / Standoff" },
      { keys: ["←", "↑", "→", "↓"], label: "Nudge selection (Shift = larger step)" },
      { keys: ["Tab"], label: "Expand / collapse all chrome (navigator, legend, pins, alerts)" },
    ],
  },
  {
    title: "Edit",
    rows: [
      { keys: ["Ctrl", "Z"], label: "Undo" },
      { keys: ["Ctrl", "Shift", "Z"], label: "Redo" },
      { keys: ["Ctrl", "Y"], label: "Redo (alternate)" },
      { keys: ["Ctrl", "C"], label: "Copy selection" },
      { keys: ["Ctrl", "V"], label: "Paste" },
      { keys: ["Del"], label: "Delete selection" },
      { keys: ["Ctrl", "A"], label: "Select all nodes" },
      { keys: ["Ctrl", "F"], label: "Find node (outline search)" },
      { keys: ["Ctrl", "Shift", "L"], label: "Reload document (replays the load reveal)" },
    ],
  },
  {
    title: "Canvas",
    rows: [
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") shortcutsStore.close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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
