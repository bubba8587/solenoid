import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ─── The two touch bars must not drift ───────────────────────────────────────
// A phone gets the bottom action bar; a tablet gets the same actions in the TOP
// bar, because a tablet runs the desktop chrome and has no bottom bar at all
// (IS_MOBILE is false there — iPadOS ships a desktop UA on purpose). The author's
// standing instruction when this was queued: reuse the mobile bar's controls
// exactly — same handlers, same icons, same disabled logic, new location.
//
// That only stays true while both bars source their pieces from touchActions.tsx.
// The failure this guards is silent: someone redraws a glyph or retargets a
// handler in ONE bar, both still compile, both still render, and the two devices
// quietly disagree. Greppy by necessity — the vitest env is `node`, so there is
// no render test available (see CLAUDE.md).
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
        // Add-node is bottom-bar-only (the top bar has its own), so the mobile
        // bar may carry one extra button — but every SHARED symbol must come
        // from the shared module in both.
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
    // The bottom bar keeps exactly ONE inline <svg>: the Add FAB, which the top
    // bar deliberately does not carry. Any second inline glyph means a shared
    // icon was re-drawn locally.
    expect((mobile.match(/<svg/g) ?? []).length, "MobileControls inlines more than the Add FAB").toBe(1);
    expect((tablet.match(/<svg/g) ?? []).length, "TabletActions inlines a glyph").toBe(0);
  });

  it("a device is never both mobile and tablet, and never neither", () => {
    const coarse = read("./coarse.ts");
    // Derived, not sniffed: IS_TABLET is exactly "coarse but not mobile".
    expect(coarse).toContain("export const IS_TABLET = IS_COARSE && !IS_MOBILE;");
  });
});

// ─── The header envelope is MEASURED, not written down ───────────────────────
// Six top-anchored overlays used to hard-code an offset derived from the same
// 66px header height. That is the documented source of the recurring "overlay
// overlaps a bar" bug (layout-chrome.md was started for it: the align pill
// shipped at 56px against an 82px bar and landed inside the toolbar). A TABLET
// wraps the bar to a second row, and where it wraps depends on the viewport —
// so the envelope stopped being a number anyone could write down. Header.tsx
// measures it into `--chrome-top`; these files must derive from that var.
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
    // To :root — the overlays are siblings elsewhere in the tree, so a var set
    // on the header itself would never reach them.
    expect(header).toMatch(/documentElement\.style\.setProperty\(\s*\n?\s*"--chrome-top"/);
  });
});
