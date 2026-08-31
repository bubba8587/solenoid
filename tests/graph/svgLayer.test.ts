import { describe, it, expect } from "vitest";
import { elementName, resolveLayer, resolveLayerName, type SvgLike } from "../../src/graph/svgLayer";

// A tiny mock element tree — the resolver only needs getAttribute + parentElement,
// so we build nodes by hand (no jsdom in the node vitest env). `mk` links parent
// pointers so a walk-up test is faithful.
function mk(attrs: Record<string, string>, parent: SvgLike | null = null): SvgLike {
  return {
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    parentElement: parent,
  };
}

describe("elementName", () => {
  it("prefers a human label over a machine id", () => {
    expect(elementName(mk({ "inkscape:label": "California", id: "CA" }))).toBe("California");
    expect(elementName(mk({ "data-name": "West", id: "w1" }))).toBe("West");
    expect(elementName(mk({ "aria-label": "Region 3", id: "r3" }))).toBe("Region 3");
  });

  it("falls back to id when no label attribute is present", () => {
    expect(elementName(mk({ id: "CA" }))).toBe("CA");
  });

  it("trims whitespace and ignores blank attributes", () => {
    expect(elementName(mk({ id: "  CA  " }))).toBe("CA");
    expect(elementName(mk({ "data-name": "   ", id: "CA" }))).toBe("CA");
  });

  it("returns null when nothing names the element", () => {
    expect(elementName(mk({ fill: "red" }))).toBeNull();
  });
});

describe("resolveLayer", () => {
  it("returns the clicked element when it is itself named", () => {
    const root = mk({});
    const path = mk({ id: "CA" }, root);
    const hit = resolveLayer(path, root);
    expect(hit?.name).toBe("CA");
    expect(hit?.el).toBe(path);
  });

  it("walks up to the nearest named ancestor (a grouped layer)", () => {
    const root = mk({});
    const layer = mk({ "inkscape:label": "States" }, root);
    const path = mk({ fill: "blue" }, layer); // the leaf shape is unnamed
    const hit = resolveLayer(path, root);
    expect(hit?.name).toBe("States");
    expect(hit?.el).toBe(layer);
  });

  it("stops at (and excludes) the root svg", () => {
    const root = mk({ id: "diagram" }); // even a named root must not be selectable
    const path = mk({ fill: "blue" }, root);
    expect(resolveLayer(path, root)).toBeNull();
    expect(resolveLayerName(path, root)).toBeNull();
  });

  it("returns null when nothing up the chain is named", () => {
    const root = mk({});
    const g = mk({ fill: "none" }, root);
    const path = mk({ stroke: "black" }, g);
    expect(resolveLayer(path, root)).toBeNull();
  });
});
