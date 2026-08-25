import { useSyncExternalStore, useState, useRef, useEffect } from "react";
import { IS_MOBILE } from "../coarse";
import { pinStore } from "../pinStore";
import { registerChrome } from "../chromeToggle";
import { cableValueStore } from "../cableValueStore";
import { connectionVersionStore, getEditor } from "../process";
import { flyToNode } from "../flyToNode";
import { nodeDisplayName } from "../catalogUtils";
import { GroupNode } from "../rete-nodes";
import { groupReadouts, type RetainedTerminal } from "../groupCollapse";
import { formatScalar } from "./format";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { isSolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { ArrayChip, isArrayValue, arrayAccentFor } from "./ArrayChip";
import { nodeOutputElemFamily, formatListCell } from "./valueDisplayFormat";
import { isCx } from "../cxValue";
import { isUnitCell } from "../unitValue";
import { FrameChip, FrameRefChip } from "./FrameChip";
import { isFrameRef } from "../frameBackend";
import { CubeChip } from "./CubeChip";
import { isFrameValue, isCubeValue } from "../frame";
import "./pinLayer.css";
import { CloseIcon } from "./CloseIcon";

// Must mirror GroupNode's readout: a Display reads cachedValue, a generic member its
// live output, falling back to cachedResult for LAMBDA-style nodes that cache there.
function readoutValue(t: RetainedTerminal): unknown {
  if (t.kind === "display") {
    return (getEditor()?.getNode(t.displayId) as { cachedValue?: unknown } | undefined)?.cachedValue;
  }
  const v = cableValueStore.get(t.effNodeId, t.effSocketKey);
  if (v !== undefined && v !== null) return v;
  return (getEditor()?.getNode(t.effNodeId) as { cachedResult?: unknown } | undefined)?.cachedResult ?? v;
}

// Mirrors ValueDisplay but standalone (no node/FC context); `label` titles the popup
// an array/frame chip opens.
function renderValue(v: unknown, label?: string, annNodeId?: string, outKey?: string) {
  if (isSolError(v)) {
    return <span className="solenoid-pin__value solenoid-pin__value--error" title={errorTip(v)}>{v.code}</span>;
  }
  if (v === null || v === undefined) return <span className="solenoid-pin__value solenoid-pin__value--empty">—</span>;
  if (isCubeValue(v)) return <CubeChip value={v} label={label} size="sm" accent="var(--sock-cube)" />;
  if (isFrameRef(v)) return <FrameRefChip frameRef={v} label={label} size="sm" accent="var(--sock-frame)" />;
  if (isFrameValue(v)) return <FrameChip value={v} label={label} size="sm" accent="var(--sock-frame)" />;
  if (isArrayValue(v)) {
    const arr = v as (number | string)[] | (number | string)[][];
    const twoD = Array.isArray(arr[0]);
    // Family comes from the SOCKET, not the cells: a date list's serials sniff numeric
    // and a leading blank sniffs as neither, so both tinted amber.
    const family = nodeOutputElemFamily(annNodeId ?? null, outKey);
    return <ArrayChip value={arr} label={label} size="sm" accent={arrayAccentFor(family, twoD)} elem={family} />;
  }
  if (typeof v === "string") return <span className="solenoid-pin__value">{v || "—"}</span>;
  if (typeof v === "number") {
    const ann = annNodeId ? formatAnnotationStore.getForNode(annNodeId) : undefined;
    return <span className="solenoid-pin__value">{ann ? formatNumberWithAnnotation(v, ann) : formatScalar(v)}</span>;
  }
  // Logicals, tagged complex and united numbers all have a text form — they fell
  // through to the empty dash before.
  if (typeof v === "boolean" || isCx(v) || isUnitCell(v)) {
    const ann = annNodeId ? formatAnnotationStore.getForNode(annNodeId) : undefined;
    const one = (n: number) => (ann ? formatNumberWithAnnotation(n, ann) : formatScalar(n));
    return <span className="solenoid-pin__value">{formatListCell(v, one)}</span>;
  }
  return <span className="solenoid-pin__value solenoid-pin__value--empty">—</span>;
}

// Lucide "pin" icon — https://lucide.dev/icons/pin
const PinSvg = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 -1.4 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

/** The pinned-values HUD section; <HudStack/> owns its placement, this renders only
 *  the section. */
export function PinLayer() {
  const [collapsed, setCollapsed] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Mobile: a tap outside re-collapses, so the chips never linger over the graph.
  useEffect(() => {
    if (!IS_MOBILE || collapsed) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setCollapsed(true);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [collapsed]);

  useSyncExternalStore(pinStore.subscribe, pinStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  // Labels can change (rename) and nodes can appear/vanish — re-render on topology.
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  // Re-render on FC annotation changes so a pinned value restyles live.
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);

  const pins = pinStore.list();
  // Join the chrome-toggle group (Tab) only while there are pins to show.
  useEffect(() => {
    if (pins.length === 0) return;
    return registerChrome("pins", { isOpen: () => !collapsed, setOpen: (o) => setCollapsed(!o) });
  }, [collapsed, pins.length]);
  if (pins.length === 0) return null;

  const editor = getEditor();
  if (!editor) return null;

  const removeBtn = (label: string, nodeId: string) => (
    <button
      type="button"
      className="solenoid-pin__remove"
      aria-label={`Unpin ${label}`}
      title="Unpin"
      onClick={(e) => { e.stopPropagation(); pinStore.remove(nodeId); }}
    >
      <CloseIcon size={12} />
    </button>
  );

  const chips = pins.map((pin) => {
    const node = editor.getNode(pin.nodeId);
    if (!node) return null; // safety — should be dropped on delete
    const label = nodeDisplayName(node);

    // A pinned GROUP shows the same readouts a collapsed group would.
    if (node instanceof GroupNode) {
      const rows = groupReadouts(editor, node);
      return (
        <div key={pin.nodeId} className="solenoid-pin solenoid-pin--group" onClick={() => flyToNode(pin.nodeId)} title="Go to this group">
          <div className="solenoid-pin__group-head">
            <span className="solenoid-pin__label">{(node.label ?? "").trim() || "Group"}</span>
            {removeBtn(label, pin.nodeId)}
          </div>
          <div className="solenoid-pin__rows">
            {rows.length === 0 ? (
              <span className="solenoid-pin__value solenoid-pin__value--empty">no readouts</span>
            ) : (
              rows.map((t) => (
                <div key={`${t.effNodeId}:${t.effSocketKey}`} className="solenoid-pin__row">
                  <span className="solenoid-pin__row-label" title={t.label}>{t.label}</span>
                  {renderValue(readoutValue(t), undefined, t.effNodeId, t.effSocketKey)}
                </div>
              ))
            )}
          </div>
        </div>
      );
    }

    const value = cableValueStore.get(pin.nodeId, pin.outputKey);
    return (
      <div key={pin.nodeId} className="solenoid-pin" onClick={() => flyToNode(pin.nodeId)} title="Go to this node">
        <span className="solenoid-pin__label">{label}</span>
        {renderValue(value, undefined, pin.nodeId, pin.outputKey)}
        {removeBtn(label, pin.nodeId)}
      </div>
    );
  });

  const trigger = (
    <button
      type="button"
      className="solenoid-pin-layer__trigger"
      title={collapsed ? `Show ${pins.length} pinned value${pins.length !== 1 ? "s" : ""}` : "Collapse pinned values"}
      onClick={() => setCollapsed((c) => !c)}
    >
      <PinSvg size={10} />
      {collapsed && <span className="solenoid-pin-layer__count">{pins.length}</span>}
    </button>
  );

  return (
    <div ref={rootRef} className={`solenoid-pin-layer${collapsed ? " solenoid-pin-layer--collapsed" : ""}`}>
      {trigger}
      {chips}
    </div>
  );
}
