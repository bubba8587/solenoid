import { describe, it, expect, afterEach } from "vitest";
import { SaveTimesNode } from "../../../src/graph/nodes/input";
import { serialToJsDate } from "../../../src/graph/nodes/dateSerial";
import { saveTimeStore, type SaveClock } from "../../../src/graph/saveTimeStore";

// The class reads through the seam, so the tests stub the provider directly; the real
// provider (documentStore's, over the current SolDoc) is pinned in
// documentStorePersist.test.ts.
const NULLS: SaveClock = { autosavedAt: null, fileSavedAt: null };
const provide = (clock: SaveClock) => saveTimeStore.setProvider(() => clock);

describe("SaveTimesNode", () => {
  afterEach(() => provide(NULLS));

  it("emits each clock reading as a date serial carrying its time of day", () => {
    const at = Date.UTC(2026, 7, 16, 14, 32, 0);
    provide({ autosavedAt: at, fileSavedAt: null });
    const n = new SaveTimesNode();
    const { autosave, filesave } = n.data();
    expect(filesave).toBeNull();
    // Serials are days-as-float, so a ms round-trip drifts sub-millisecond; the card
    // shows HH:mm, well inside that.
    expect(serialToJsDate(autosave!).getTime()).toBeCloseTo(at, -1);
    // A time of day means a fractional serial, which is what makes the box show HH:mm.
    expect(Number.isInteger(autosave!)).toBe(false);
  });

  it("tracks the two clocks apart", () => {
    const auto = Date.UTC(2026, 7, 16, 9, 0, 0);
    const file = Date.UTC(2026, 7, 16, 9, 5, 0);
    provide({ autosavedAt: auto, fileSavedAt: file });
    const n = new SaveTimesNode();
    const out = n.data();
    expect(serialToJsDate(out.autosave!).getTime()).toBeCloseTo(auto, -1);
    expect(serialToJsDate(out.filesave!).getTime()).toBeCloseTo(file, -1);
  });

  it("caches both readings for the card, and re-reads on the next data()", () => {
    provide(NULLS);
    const n = new SaveTimesNode();
    n.data();
    expect(n.cachedAutosave).toBeNull();
    provide({ autosavedAt: Date.UTC(2026, 7, 16, 12, 0, 0), fileSavedAt: null });
    n.data();
    expect(n.cachedAutosave).not.toBeNull();
    expect(n.cachedFileSave).toBeNull();
  });
});
