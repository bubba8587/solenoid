import { measuredSize } from "../nodeSize";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  standoffStore,
  standoffLayoutTick,
  settleStandoffs,
  anchorPoint,
  anchorFromVector,
  ANCHOR_DIR,
  Standoff,
  Box,
} from "../standoffs";
import { AngleDial } from "../AngleDial";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";

// Commits on Enter / blur so clearing digits to retype doesn't recompute the band mid-edit.
function BandField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const field = useDraftCommit<number>(
    value,
    (v) => String(v),
    (t) => { const n = parseFloat(t); return Number.isFinite(n) ? n : INVALID_DRAFT; },
    onCommit,
  );
  return (
    <input
      type="number"
      min={0}
      value={field.draft}
      onChange={(e) => field.setDraft(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
    />
  );
}
import { getEditor, getArea, unselectAllNodes } from "../process";
import { cableSelectionStore } from "../cableState";
import { groupCollapseStore } from "../groupCollapse";
import { scheduleAutosave } from "../persistence";
import "./conduit.css"; // reuse the docked-toolbar chrome
import "./StandoffLayer.css";

// Bars render UNDER the graph at z-index -3 (below expanded groups -2, conduits -1,
// nodes 0). A bar slants to show perpendicular slack — the constrained axis is the line
// between the anchors' boxes, not the drawn angle.

const BAR_WIDTH = 9;
const HIT_WIDTH = 18;
const CAP_R = 4.5;

function liveBox(id: string): Box | null {
  const area = getArea();
  const editor = getEditor();
  const view = area?.nodeViews.get(id);
  const node = editor?.getNode(id);
  if (!view || !node) return null;
  const m = area ? measuredSize(area, id) : null;
  const w = m?.w ?? (view.element.offsetWidth || (node as { width?: number }).width || 100);
  const h = m?.h ?? (view.element.offsetHeight || (node as { height?: number }).height || 50);
  return { x: view.position.x, y: view.position.y, w, h };
}

function StandoffBar({ s, selected }: { s: Standoff; selected: boolean }) {
  // Hidden endpoints (collapsed-group members) make the standoff dormant.
  if (groupCollapseStore.isNodeHidden(s.a.nodeId) || groupCollapseStore.isNodeHidden(s.b.nodeId)) {
    return null;
  }
  const ba = liveBox(s.a.nodeId);
  const bb = liveBox(s.b.nodeId);
  if (!ba || !bb) return null;
  const pa = anchorPoint(ba, s.a.anchor);
  const pb = anchorPoint(bb, s.b.anchor);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selected) {
      standoffStore.select(null);
    } else {
      standoffStore.select(s.id);
      // Standoff + node + cable selections stay mutually exclusive.
      unselectAllNodes();
      cableSelectionStore.set(null);
    }
  };

  const cls = `solenoid-standoff${selected ? " solenoid-standoff--selected" : ""}`;
  return (
    <g className={cls}>
      <line className="solenoid-standoff__bar" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} strokeWidth={BAR_WIDTH} />
      <circle className="solenoid-standoff__cap" cx={pa.x} cy={pa.y} r={CAP_R} />
      <circle className="solenoid-standoff__cap" cx={pb.x} cy={pb.y} r={CAP_R} />
      <line
        className="solenoid-standoff-hit"
        x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
        strokeWidth={HIT_WIDTH}
        onClick={onClick}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </g>
  );
}

function StandoffToolbar({ s }: { s: Standoff }) {
  const onBand = (min: number, max: number) => {
    standoffStore.setBand(s.id, min, max);
    settleStandoffs(); // apply the new band immediately
    scheduleAutosave();
  };
  const onLock = (locked: boolean) => {
    standoffStore.setLocked(s.id, locked);
    settleStandoffs();
    scheduleAutosave();
  };
  const onAngle = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    standoffStore.setAxis(s.id, anchorFromVector(Math.cos(rad), Math.sin(rad)));
    settleStandoffs();
    scheduleAutosave();
  };
  // Screen-space angle (0° = east, 90° = south), so the needle points the constrained way.
  const dir = ANCHOR_DIR[s.a.anchor];
  const angle = ((Math.atan2(dir.y, dir.x) * 180) / Math.PI + 360) % 360;
  return createPortal(
    <div
      className="solenoid-conduit-toolbar solenoid-conduit-toolbar--docked solenoid-standoff-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="solenoid-conduit-toolbar__section">Standoff</div>
      <label className="solenoid-standoff-toolbar__field">
        Min
        <BandField value={Math.round(s.min)} onCommit={(v) => onBand(v, s.max)} />
      </label>
      <label className="solenoid-standoff-toolbar__field">
        Max
        <BandField value={Math.round(s.max)} onCommit={(v) => onBand(s.min, v)} />
      </label>
      <label className="solenoid-standoff-toolbar__field">
        Lock 45°
        <input
          type="checkbox"
          checked={!!s.locked}
          onChange={(e) => onLock(e.target.checked)}
        />
      </label>
      <div className="solenoid-standoff-toolbar__field">
        Angle
        <AngleDial value={angle} step={45} onChange={onAngle} size={30} />
      </div>
      <button
        type="button"
        className="solenoid-standoff-toolbar__delete"
        onClick={() => {
          standoffStore.remove(s.id);
          scheduleAutosave();
        }}
      >
        ✕ Remove
      </button>
    </div>,
    document.body,
  );
}

export function StandoffLayer() {
  useSyncExternalStore(standoffStore.subscribe, standoffStore.version);
  useSyncExternalStore(standoffLayoutTick.subscribe, standoffLayoutTick.version);
  useSyncExternalStore(groupCollapseStore.subscribe, groupCollapseStore.version);

  const all = standoffStore.all();
  if (all.length === 0) return null;
  const selectedId = standoffStore.selected();
  const selected = selectedId ? standoffStore.get(selectedId) : undefined;

  return (
    <>
      <svg className="solenoid-standoff-svg">
        {all.map((s) => (
          <StandoffBar key={s.id} s={s} selected={s.id === selectedId} />
        ))}
      </svg>
      {selected && <StandoffToolbar s={selected} />}
    </>
  );
}
