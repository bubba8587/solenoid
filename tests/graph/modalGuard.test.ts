import { describe, it, expect, afterEach } from "vitest";
import { modalOwnsKeyboard, markIfUnderModal, keyUnderModal, MODAL_SELECTOR } from "../../src/graph/modalGuard";
import { paletteStore } from "../../src/graph/paletteStore";
import { frStore } from "../../src/graph/frStore";
import { settingsPanel } from "../../src/graph/settingsStore";
import { shortcutsStore } from "../../src/graph/shortcutsStore";

// The canvas key handlers stand down while an overlay owns the keyboard (the Tidy
// confirm's Enter must not also open the palette; A under a Frame Input pop-up must
// not open the Add menu). Overlays declare themselves in the DOM; the dialog-less
// surfaces are read from their stores.
const docWith = (hit: boolean): Pick<Document, "querySelector"> =>
  ({ querySelector: (sel: string) => (hit && sel === MODAL_SELECTOR ? ({} as Element) : null) }) as Pick<Document, "querySelector">;

afterEach(() => {
  for (const s of [paletteStore, frStore, settingsPanel, shortcutsStore]) if (s.get()) s.toggle();
});

describe("modalOwnsKeyboard", () => {
  it("is false with no overlay in the DOM and every surface closed", () => {
    expect(modalOwnsKeyboard(docWith(false))).toBe(false);
    expect(modalOwnsKeyboard(null)).toBe(false);
  });

  it("is true when an aria-modal dialog or a pop-up overlay is in the DOM", () => {
    expect(modalOwnsKeyboard(docWith(true))).toBe(true);
    for (const root of ['[aria-modal="true"]', ".sol-popup-overlay", ".solenoid-confirm__overlay", ".conn-dialog__overlay"]) {
      expect(MODAL_SELECTOR).toContain(root);
    }
  });

  it("pins the capture-time answer on the event: a key that closed its modal still reads as under it", () => {
    const enter = {};
    markIfUnderModal(enter, docWith(true));   // capture: the confirm is open
    expect(keyUnderModal(enter, docWith(false))).toBe(true); // bubble: the confirm is gone
    const later = {};
    markIfUnderModal(later, docWith(false));
    expect(keyUnderModal(later, docWith(false))).toBe(false);
  });

  it("is true while a dialog-less surface (palette, reference, settings, shortcuts) is open", () => {
    for (const s of [paletteStore, frStore, settingsPanel, shortcutsStore]) {
      s.toggle();
      expect(modalOwnsKeyboard(docWith(false))).toBe(true);
      s.toggle();
      expect(modalOwnsKeyboard(docWith(false))).toBe(false);
    }
  });
});
