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
const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

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
