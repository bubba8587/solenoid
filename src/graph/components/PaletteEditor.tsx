import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CardFrame, useHeaderHeightVar } from "./NodeCard";
import { useFocusTrap } from "./useFocusTrap";
import { useEscapeToClose } from "./useEscapeToClose";
import { CloseIcon } from "./CloseIcon";
import {
  paletteStore, paletteEditorPanel, BUILTIN_PALETTES, BUILTIN_CANVAS, DEFAULT_CANVAS,
  hexToRgba, contrastInk, themeAccent, darkenAccent,
  type PaletteSlot, type PaletteName, type CanvasKey,
} from "../palette";
import { appThemeStore } from "../appTheme";
import { getEditor } from "../process";
import { rebuildGroupMembership } from "../groupMembership";
import "../Settings.css";
import "./GroupNode.css";
import "./NoteNode.css";
import "./PaletteEditor.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

// Slot ids are opaque, so each slot's role is spelled out here.
const SLOT_ROLES: { slot: PaletteSlot; label: string }[] = [
  { slot: "gold",      label: "Number" },
  { slot: "lime",      label: "Text" },
  { slot: "pink",      label: "Date" },
  { slot: "sky",       label: "Complex" },
  { slot: "purple",    label: "Logical" },
  { slot: "violet",    label: "Frame / Cube" },
  { slot: "green",     label: "Lambda / Chart" },
  { slot: "amber",     label: "Input" },
  { slot: "blue",      label: "Math" },
  { slot: "teal",      label: "Convert" },
  { slot: "vermilion", label: "Error" },
  { slot: "gray",      label: "Any" },
];

// The canvas ground (App.css's --canvas-bg / --canvas-dot). Only the custom palette
// and Orchard author one; every other built-in leaves the neutral ground alone. Both
// modes are editable here rather than only the live one, so a palette stays complete
// when the author flips theme.
const CANVAS_ROLES: { key: CanvasKey; label: string }[] = [
  { key: "bgDark",   label: "Canvas, dark" },
  { key: "dotDark",  label: "Dots, dark" },
  { key: "bgLight",  label: "Canvas, light" },
  { key: "dotLight", label: "Dots, light" },
];

type Draft = Record<PaletteSlot, string>;
type CanvasDraft = Record<CanvasKey, string>;

/** Edits live in a local DRAFT that previews only in the sample — the app is retinted once
 *  on Save, never on every color-drag tick. The sample uses the REAL node chrome + CSS. */
export function PaletteEditorModal() {
  const open = useSyncExternalStore(paletteEditorPanel.subscribe, paletteEditorPanel.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [draft, setDraft] = useState<Draft>(() => paletteStore.customMap());
  const [canvasDraft, setCanvasDraft] = useState<CanvasDraft>(() => paletteStore.customCanvas());
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  useEffect(() => {
    if (!open) return;
    setDraft(paletteStore.customMap());
    setCanvasDraft(paletteStore.customCanvas());
  }, [open]);

  useEscapeToClose(() => paletteEditorPanel.close(), open);

  if (!open) return null;

  function save() {
    paletteStore.setCustomMap(draft, canvasDraft);
    paletteStore.setActiveBase("Custom");
    const ed = getEditor();
    if (ed) rebuildGroupMembership(ed);
    paletteEditorPanel.close();
  }

  return (
    <div className="solenoid-settings" onPointerDown={() => paletteEditorPanel.close()}>
      <div
        ref={panelRef}
        className="solenoid-settings__panel sol-pal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Custom palette"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="solenoid-settings__header">
          <span className="solenoid-settings__title">Custom palette</span>
          <button className="solenoid-settings__close" onClick={() => paletteEditorPanel.close()} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="solenoid-settings__body sol-pal-panel__body">
          <div className="sol-pal-editor__slots">
            {SLOT_ROLES.map(({ slot, label }) => (
              <label key={slot} className="sol-pal-editor__slot">
                <input
                  type="color"
                  className="sol-pal-editor__well"
                  value={draft[slot]}
                  onChange={(e) => setDraft((d) => ({ ...d, [slot]: e.target.value }))}
                  onPointerDown={stop}
                  onMouseDown={stop}
                />
                <span className="sol-pal-editor__slot-label">{label}</span>
              </label>
            ))}
          </div>

          <div className="sol-pal-editor__canvas">
            <span className="sol-pal-editor__group-label">Canvas</span>
            <div className="sol-pal-editor__canvas-slots">
              {CANVAS_ROLES.map(({ key, label }) => (
                <label key={key} className="sol-pal-editor__slot">
                  <input
                    type="color"
                    className="sol-pal-editor__well"
                    value={canvasDraft[key]}
                    onChange={(e) => setCanvasDraft((c) => ({ ...c, [key]: e.target.value }))}
                    onPointerDown={stop}
                    onMouseDown={stop}
                  />
                  <span className="sol-pal-editor__slot-label">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="sol-pal-editor__templates">
            <span className="sol-pal-editor__templates-label">Load template</span>
            <div className="sol-pal-editor__template-btns">
              {paletteStore.names().map((name) => (
                <button
                  key={name}
                  type="button"
                  className="sol-pal-editor__template-btn"
                  onClick={() => {
                    setDraft({ ...BUILTIN_PALETTES[name as PaletteName] });
                    // A template with no ground of its own seeds the neutral one, so
                    // loading it clears a ground the author had set (matches loadCustomTemplate).
                    setCanvasDraft({ ...DEFAULT_CANVAS, ...BUILTIN_CANVAS[name as PaletteName] });
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <PaletteSample draft={draft} canvas={canvasDraft} />
        </div>

        <div className="sol-pal-panel__footer">
          <button type="button" className="sol-pal-panel__btn" onClick={() => paletteEditorPanel.close()}>Cancel</button>
          <button type="button" className="sol-pal-panel__btn sol-pal-panel__btn--primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function PaletteSample({ draft, canvas }: { draft: Draft; canvas: CanvasDraft }) {
  // The sample card's frame SVG needs --header-h like a real card.
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightVar(headerRef);
  const mode = appThemeStore.getMode();
  const gc = themeAccent(draft.gold, mode);
  const gcDark = darkenAccent(draft.gold);
  const gInk = contrastInk(gc);
  const nodeAccent = themeAccent(draft.blue, mode);
  const nodeAccentDark = darkenAccent(draft.blue);
  const nc = themeAccent(draft.pink, mode);
  const numberColor = themeAccent(draft.gold, mode);
  // The sample stands ON the drafted ground, dot grid and all, so the chrome is
  // judged against the canvas it will sit on rather than the modal's surface.
  const ground = mode === "dark"
    ? { bg: canvas.bgDark, dot: canvas.dotDark }
    : { bg: canvas.bgLight, dot: canvas.dotLight };
  return (
    <div
      className="sol-pal-sample"
      style={{ "--sample-bg": ground.bg, "--sample-dot": ground.dot } as React.CSSProperties}
    >
      <div
        className="solenoid-group"
        style={{ width: 226, "--group-color": gc, "--group-color-dark": gcDark } as React.CSSProperties}
      >
        <div className="solenoid-group__header" style={{ background: gc, borderColor: gcDark, color: gInk }}>
          <div className="solenoid-group__label solenoid-group__label--display" style={{ color: gInk }}>Group</div>
        </div>
        <div className="solenoid-group__body" style={{ borderColor: gcDark, background: hexToRgba(gc, mode === "light" ? 0.12 : 0.14) }}>
          <div className="sol-pal-sample__nodeslot">
            <div
              className="solenoid-node solenoid-node--grouped"
              style={{ "--node-accent": nodeAccent, "--node-accent-dark": nodeAccentDark, "--group-color": gc, "--group-color-dark": gcDark } as React.CSSProperties}
            >
              <CardFrame />
              <div className="solenoid-node__header" ref={headerRef}>
                <div className="solenoid-node__label-display">Math</div>
                <span className="solenoid-node__type-hint" aria-hidden="true">Arithmetic</span>
              </div>
              <div className="solenoid-node__content">
                <div className="solenoid-node__body">
                  <div className="solenoid-node__display-value">42</div>
                </div>
                {/* One real output socket (Number) at the card edge, colored from the
                    draft — so the socket palette shows in context too. */}
                <span className="sol-pal-sample__socket">
                  <svg viewBox="0 0 12 12" width={12} height={12} style={{ overflow: "visible", display: "block" }} aria-hidden="true">
                    <circle cx="6" cy="6" r="6" fill={numberColor} />
                    <circle cx="6" cy="6" r="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="solenoid-note"
        style={{ width: 196, "--note-color": nc, "--note-bg": hexToRgba(nc, 0.3) } as React.CSSProperties}
      >
        <div className="solenoid-note__bar">
          <div className="solenoid-note__name-display">Note</div>
        </div>
        <div className="solenoid-note__content">
          <div className="solenoid-note__rendered">Lorem ipsum dolor sit amet.</div>
        </div>
      </div>
    </div>
  );
}
