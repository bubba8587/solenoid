// [[B20]], [[touch-gestures#Standing rules]], [[touch-gestures#Chrome (bars and pop-ups)]], [[touch-gestures#Device configurations]],
// [[layout-chrome#The two envelopes]]
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL("../../src/graph/" + f, import.meta.url), "utf8");

const SHARED = ["fireUndo", "fireGroup", "useHasSelection",
  "CommandGlyph", "UndoGlyph", "RedoGlyph", "SelectGlyph", "DeleteGlyph", "GroupGlyph"];

describe("the mobile bar and the tablet top-bar actions share one source", () => {
  const mobile = read("./MobileControls.tsx");
  const tablet = read("./TabletActions.tsx");

  it("both import every shared action and glyph from touchActions", () => {
    for (const [name, src] of [["MobileControls", mobile], ["TabletActions", tablet]] as const) {
      expect(src, `${name} does not import from touchActions`).toContain('from "./touchActions"');
      for (const sym of SHARED) {
        expect(src.includes(sym), `${name} is missing the shared ${sym}`).toBe(true);
      }
    }
  });

  it("neither bar re-declares a shared handler locally", () => {
    for (const [name, src] of [["MobileControls", mobile], ["TabletActions", tablet]] as const) {
      for (const fn of ["fireUndo", "fireGroup"]) {
        expect(src, `${name} re-declares ${fn} instead of sharing it`)
          .not.toMatch(new RegExp(`function\\s+${fn}\\b`));
      }
    }
  });

  it("neither bar inlines a glyph the other draws — the icons live in one file", () => {
    expect((mobile.match(/<svg/g) ?? []).length, "MobileControls inlines more than the Add FAB").toBe(1);
    expect((tablet.match(/<svg/g) ?? []).length, "TabletActions inlines a glyph").toBe(0);
  });

  it("a device is never both mobile and tablet, and never neither", () => {
    const coarse = read("./coarse.ts");
    expect(coarse).toContain("return IS_COARSE && !_mobile;");
  });
});

describe("top-anchored overlays derive from the measured header envelope", () => {
  const OVERLAYS = [
    "./NavMenu.css",
    "./OutlinePanel.css",
    "./WebDemoBanner.css",
    "./components/selectionActions.css",
    "./components/hudStack.css",
    "./components/ReportOverlay.css",
  ];

  it("every one references --chrome-top", () => {
    for (const f of OVERLAYS) {
      expect(read(f), `${f} no longer derives from --chrome-top`).toContain("--chrome-top");
    }
  });

  it("each keeps a static fallback, so the first paint is right before the observer fires", () => {
    for (const f of OVERLAYS) {
      expect(read(f), `${f} uses --chrome-top with no fallback`).toMatch(/var\(--chrome-top,\s*\d+px\)/);
    }
  });

  it("Header publishes the measured height to the root", () => {
    const header = read("./Header.tsx");
    expect(header).toContain("ResizeObserver");
    expect(header).toMatch(/documentElement\.style\.setProperty\(\s*\n?\s*"--chrome-top"/);
  });
});
