import { describe, it, expect, vi, afterEach } from "vitest";
import { setPushHistory, pushHistory, setHistoryPlugin, getHistoryPlugin } from "./process";
import { setActiveGraph, getActiveHistory } from "./activeGraph";

// Guards the contract that lets a Composite drill-in feel first-class: an undoable
// change pushed from a node component (an extensible-row add, a cable-switch flip,
// a group resize) must land on the ACTIVE graph's history, so an edit made INSIDE a
// drill-in is reversed by the drill-in's own undo — not stranded on the main stack.
// Mirrors Canvas's real registration (`setPushHistory(a => getActiveHistory()?.add(a))`).
describe("pushHistory routes to the ACTIVE graph's history", () => {
  afterEach(() => {
    setActiveGraph(null);
    setHistoryPlugin(null as never);
    setPushHistory(() => {});
  });

  it("goes to main when not drilled in, to the drill-in history when a subgraph is active", () => {
    setPushHistory((action) => { void getActiveHistory()?.add(action); });
    const main = { add: vi.fn() };
    const drill = { add: vi.fn() };
    setHistoryPlugin(main as never);
    expect(getHistoryPlugin()).toBe(main);

    // Not drilled in → the action lands on the main history.
    pushHistory(() => {}, () => {});
    expect(main.add).toHaveBeenCalledTimes(1);
    expect(drill.add).not.toHaveBeenCalled();

    // A subgraph is active → the same call now lands on the drill-in's history.
    setActiveGraph({ editor: {} as never, area: {} as never, history: drill as never });
    pushHistory(() => {}, () => {});
    expect(drill.add).toHaveBeenCalledTimes(1);
    expect(main.add).toHaveBeenCalledTimes(1); // main untouched by the drill-in edit
  });
});
