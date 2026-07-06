import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFocusTrap } from "./useFocusTrap";
import { CloseIcon } from "./CloseIcon";
import {
  paletteStore, paletteEditorPanel, BUILTIN_PALETTES,
  hexToRgba, contrastInk, themeAccent, darkenAccent,
  type PaletteSlot, type PaletteName,
} from "../palette";
import { appThemeStore } from "../appTheme";
import { getEditor } from "../process";
import { rebuildGroupMembership } from "../groupMembership";
import "../Settings.css";
import "./GroupNode.css";
import "./NoteNode.css";
import "./PaletteEditor.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

// Each palette slot's semantic role — what recoloring it changes. Slot ids are
// opaque (see palette.ts), so a human role reads better than "lime".
const SLOT_ROLES: { slot: PaletteSlot; label: string }[] = [
  { slot: "gold",      label: "Number" },
  { slot: "lime",      label: "Text" },
  { slot: "pink",      label: "Date" },
  { slot: "sky",       label: "Complex" },
  { slot: "purple",    label: "Logical" },
  { slot: "violet",    label: "Frame / cube" },
  { slot: "green",     label: "Lambda / chart" },
  { slot: "amber",     label: "Input" },
  { slot: "blue",      label: "Math" },
  { slot: "teal",      label: "Convert" },
  { slot: "vermilion", label: "Error" },
  { slot: "gray",      label: "Any / neutral" },
];

type Draft = Record<PaletteSlot, string>;

/**
 * The custom-palette editor (F-1). A modal you open from Settings and Save/Cancel
 * out of. Edits live in a local DRAFT that previews ONLY in the sample — the whole
 * app is retinted once on Save, never live on every color-drag tick. The sample is
 * the REAL node / group / note chrome (their actual classes + CSS), colored from the
 * draft via inline vars, so it looks exactly like the canvas will.
 */
export function PaletteEditorModal() {
  const open = useSyncExternalStore(paletteEditorPanel.subscribe, paletteEditorPanel.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [draft, setDraft] = useState<Draft>(() => paletteStore.customMap());
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  // Re-seed the draft from the saved custom map each time the editor opens.
  useEffect(() => { if (open) setDraft(paletteStore.customMap()); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") paletteEditorPanel.close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  function save() {
    paletteStore.setCustomMap(draft);
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

          <div className="sol-pal-editor__templates">
            <span className="sol-pal-editor__templates-label">Load template</span>
            <div className="sol-pal-editor__template-btns">
              {paletteStore.names().map((name) => (
                <button
                  key={name}
                  type="button"
                  className="sol-pal-editor__template-btn"
                  onClick={() => setDraft({ ...BUILTIN_PALETTES[name as PaletteName] })}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <PaletteSample draft={draft} />
        </div>

        <div className="sol-pal-panel__footer">
          <button type="button" className="sol-pal-panel__btn" onClick={() => paletteEditorPanel.close()}>Cancel</button>
          <button type="button" className="sol-pal-panel__btn sol-pal-panel__btn--primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

// The live sample — the REAL node/group/note chrome (their own classes + CSS),
// colored from the DRAFT (not the applied palette) via the same inline vars the
// real components set. Preview-only; nothing here touches the canvas until Save.
function PaletteSample({ draft }: { draft: Draft }) {
  const mode = appThemeStore.getMode();
  const gc = themeAccent(draft.gold, mode);
  const gcDark = darkenAccent(draft.gold);
  const gInk = contrastInk(gc);
  const nodeAccent = themeAccent(draft.blue, mode);
  const nodeAccentDark = darkenAccent(draft.blue);
  const nc = themeAccent(draft.pink, mode);
  return (
    <div className="sol-pal-sample">
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
              <div className="solenoid-node__header">
                <div className="solenoid-node__label-display">Math</div>
                <span className="solenoid-node__type-hint" aria-hidden="true">Arithmetic</span>
              </div>
              <div className="solenoid-node__content">
                <div className="solenoid-node__body">
                  <div className="solenoid-node__display-value">42</div>
                </div>
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
