import { useSyncExternalStore } from "react";
import { isolateStore } from "../isolateStore";
import "./isolatePill.css";

/** So a local view can't be mistaken for the whole graph. */
export function IsolatePill() {
  useSyncExternalStore(isolateStore.subscribe, isolateStore.version);
  if (!isolateStore.isActive()) return null;
  const count = isolateStore.get()?.size ?? 0;
  // The dim visual is shared, so the pill is what tells the gestures apart.
  const mode = isolateStore.mode();
  return (
    <button
      type="button"
      className="solenoid-isolate-pill"
      title="Exit isolation (Esc or I)"
      onClick={() => isolateStore.exit()}
    >
      <span className="solenoid-isolate-pill__dot" />
      <span>{mode ? `${mode} · ${count} downstream` : `Isolated · ${count} node${count === 1 ? "" : "s"}`}</span>
      <span className="solenoid-isolate-pill__exit">Esc to exit</span>
    </button>
  );
}
