import { useState, useSyncExternalStore } from "react";
import { paletteStore, resolveColor, hexToRgba, type PaletteSlot, type PaletteName } from "../palette";
import { getEditor } from "../process";
import { rebuildGroupMembership } from "../groupMembership";
import { SwatchGrid } from "./SwatchGrid";
import "./PaletteEditor.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

// A palette edit retints via CSS vars, but the group member-dot cache holds resolved
// hexes — rebuild it too (same as the base-switch path in Settings).
function afterEdit() {
  const ed = getEditor();
  if (ed) rebuildGroupMembership(ed);
}

// Each palette slot's semantic role — what recoloring it actually changes. Slot ids
// are opaque (see palette.ts), so a human role reads far better than "lime". Order
// runs the typed sockets first (the system's real palette), then the node-kind-only
// hues, then the reserved error + neutral.
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

/**
 * The app-wide custom palette editor (F-1). Shows only when Custom is the active
 * base. Each slot is a native color well bound to paletteStore's custom map (edits
 * retint the whole app live); "Load template" seeds every slot from a built-in; the
 * live sample shows a node in a group + a note so you see the palette in context.
 */
export function PaletteEditor() {
  useSyncExternalStore(paletteStore.subscribe, paletteStore.version);
  const map = paletteStore.customMap();
  const [groupSlot, setGroupSlot] = useState<string>("gold");
  const [noteSlot, setNoteSlot] = useState<string>("blue");

  return (
    <div className="sol-pal-editor">
      <div className="sol-pal-editor__slots">
        {SLOT_ROLES.map(({ slot, label }) => (
          <label key={slot} className="sol-pal-editor__slot">
            <input
              type="color"
              className="sol-pal-editor__well"
              value={map[slot]}
              onChange={(e) => paletteStore.setCustomSlot(slot, e.target.value)}
              onBlur={afterEdit}
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
              onClick={() => { paletteStore.loadCustomTemplate(name as PaletteName); afterEdit(); }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <PaletteSample
        groupSlot={groupSlot}
        noteSlot={noteSlot}
        onGroupSlot={setGroupSlot}
        onNoteSlot={setNoteSlot}
      />
    </div>
  );
}

// A live preview: a node in a colored Group + a colored Note, retinting as slots
// change. The Group and Note slots are pickable so any color can be previewed in
// context (the "group/note colors editable" ask).
function PaletteSample({ groupSlot, noteSlot, onGroupSlot, onNoteSlot }: {
  groupSlot: string;
  noteSlot: string;
  onGroupSlot: (s: string) => void;
  onNoteSlot: (s: string) => void;
}) {
  const gc = resolveColor(groupSlot);
  const nc = resolveColor(noteSlot);
  const mathC = resolveColor("blue");
  return (
    <div className="sol-pal-sample">
      <div className="sol-pal-sample__stage" style={{ borderColor: gc, background: hexToRgba(gc, 0.1) }}>
        <span className="sol-pal-sample__grouptag" style={{ color: gc }}>Group</span>
        <div className="sol-pal-sample__node">
          <div className="sol-pal-sample__nodehead" style={{ background: hexToRgba(mathC, 0.22) }}>Math</div>
          <div className="sol-pal-sample__nodebody">
            <i className="sol-pal-sample__dot" style={{ background: resolveColor("gold") }} />
            <i className="sol-pal-sample__dot" style={{ background: resolveColor("lime") }} />
            <i className="sol-pal-sample__dot" style={{ background: resolveColor("violet") }} />
          </div>
        </div>
        <div className="sol-pal-sample__note" style={{ borderColor: nc, background: hexToRgba(nc, 0.14) }}>
          <b style={{ color: nc }}>Note</b> Lorem ipsum dolor sit amet.
        </div>
      </div>
      <div className="sol-pal-sample__pickers">
        <div className="sol-pal-sample__picker">
          <span className="sol-pal-sample__picker-label">Group</span>
          <SwatchGrid value={groupSlot} onPick={onGroupSlot} className="sol-pal-sample__swatches" />
        </div>
        <div className="sol-pal-sample__picker">
          <span className="sol-pal-sample__picker-label">Note</span>
          <SwatchGrid value={noteSlot} onPick={onNoteSlot} className="sol-pal-sample__swatches" />
        </div>
      </div>
    </div>
  );
}
