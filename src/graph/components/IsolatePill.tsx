import { useSyncExternalStore } from "react";
import { isolateStore } from "../isolateStore";
import "./isolatePill.css";

/**
 * A small floating "Isolated — Esc to exit" pill, shown only while isolation is
 * active so the user can't get lost in a local view. Click it (or press Esc, or
 * "I") to exit. Viewport-fixed, rendered in the main React root.
 */
export function IsolatePill() {
  useSyncExternalStore(isolateStore.subscribe, isolateStore.version);
  if (!isolateStore.isActive()) return null;
  const count = isolateStore.get()?.size ?? 0;
  return (
    <button
      type="button"
      className="solenoid-isolate-pill"
      title="Exit isolation (Esc or I)"
      onClick={() => isolateStore.exit()}
    >
      <span className="solenoid-isolate-pill__dot" />
      <span>Isolated · {count} node{count === 1 ? "" : "s"}</span>
      <span className="solenoid-isolate-pill__exit">Esc to exit</span>
    </button>
  );
}
