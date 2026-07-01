import { describe, it, expect } from "vitest";
import { cableScene, type CableStroke } from "./cableScene";

const stroke = (over: Partial<CableStroke> = {}): CableStroke => ({
  d: "M 0,0 L 10,10", color: "#fff", width: 1.8, opacity: 0.72, ...over,
});

describe("cableScene", () => {
  it("set adds an entry and notifies; remove drops it", () => {
    let n = 0;
    const unsub = cableScene.subscribe(() => { n++; });
    cableScene.set("a", stroke());
    expect(n).toBe(1);
    expect([...cableScene.entries()].find(([id]) => id === "a")?.[1].color).toBe("#fff");
    cableScene.remove("a");
    expect(n).toBe(2);
    expect([...cableScene.entries()].some(([id]) => id === "a")).toBe(false);
    unsub();
  });

  it("set with identical content does not notify (dedup)", () => {
    cableScene.set("b", stroke());
    let n = 0;
    const unsub = cableScene.subscribe(() => { n++; });
    cableScene.set("b", stroke()); // same content
    expect(n).toBe(0);
    cableScene.set("b", stroke({ width: 2.6 })); // changed
    expect(n).toBe(1);
    cableScene.remove("b");
    unsub();
  });

  it("dash arrays compare by value, not reference", () => {
    cableScene.set("c", stroke({ dash: [6, 5] }));
    let n = 0;
    const unsub = cableScene.subscribe(() => { n++; });
    cableScene.set("c", stroke({ dash: [6, 5] })); // equal by value → no notify
    expect(n).toBe(0);
    cableScene.set("c", stroke({ dash: [4, 4] }));
    expect(n).toBe(1);
    cableScene.set("c", stroke({ dash: undefined })); // dash removed → change
    expect(n).toBe(2);
    cableScene.remove("c");
    unsub();
  });

  it("the above flag participates in dedup", () => {
    cableScene.set("d", stroke());
    let n = 0;
    const unsub = cableScene.subscribe(() => { n++; });
    cableScene.set("d", stroke({ above: false })); // undefined vs false → equal
    expect(n).toBe(0);
    cableScene.set("d", stroke({ above: true })); // changed
    expect(n).toBe(1);
    cableScene.remove("d");
    unsub();
  });

  it("frozen scene ignores set and remove (LOD-out guard)", () => {
    cableScene.set("f1", stroke());
    cableScene.setFrozen(true);
    let n = 0;
    const unsub = cableScene.subscribe(() => { n++; });
    cableScene.set("f1", stroke({ width: 9 })); // ignored
    cableScene.set("f2", stroke());             // ignored
    cableScene.remove("f1");                    // ignored
    expect(n).toBe(0);
    expect([...cableScene.entries()].find(([id]) => id === "f1")?.[1].width).toBe(1.8);
    expect([...cableScene.entries()].some(([id]) => id === "f2")).toBe(false);
    cableScene.setFrozen(false);
    cableScene.set("f1", stroke({ width: 9 })); // now applies
    expect(n).toBe(1);
    cableScene.remove("f1");
    unsub();
  });

  it("remove of an absent id does not notify", () => {
    let n = 0;
    const unsub = cableScene.subscribe(() => { n++; });
    cableScene.remove("nope");
    expect(n).toBe(0);
    unsub();
  });
});
