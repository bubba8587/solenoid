import { useSyncExternalStore } from "react";
import { cableSelectionStore } from "../cableState";
import { cableValueStore } from "../cableValueStore";
import { ribbonForConnection } from "../ribbonCable";
import { flyToNode } from "../flyToNode";
import { connectionVersionStore, getEditor } from "../process";
import { nodeTypeName } from "../nodeNames";
import { formatScalar } from "./format";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { isSolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { ArrayChip, isArrayValue } from "./ArrayChip";
import { FrameChip, FrameRefChip } from "./FrameChip";
import { isFrameRef } from "../frameBackend";
import { CubeChip } from "./CubeChip";
import { isFrameValue, isCubeValue } from "../frame";
import { CloseIcon } from "./CloseIcon";
import "./cableInspector.css";

// Render a value on the wire compactly. Mirrors PinLayer.renderValue: errors as
// the red #CODE! badge, null/undefined as a dash, list/table/frame as the same
// clickable chip the node shows, numbers through their source FC annotation.
function renderWireValue(v: unknown, annNodeId: string) {
  if (isSolError(v)) {
    return <span className="solenoid-cable-inspector__value solenoid-cable-inspector__value--error" title={errorTip(v)}>{v.code}</span>;
  }
  if (v === null || v === undefined) {
    return <span className="solenoid-cable-inspector__value solenoid-cable-inspector__value--empty">—</span>;
  }
  if (isCubeValue(v)) return <CubeChip value={v} size="sm" accent="var(--sock-cube)" />;
  if (isFrameRef(v)) return <FrameRefChip frameRef={v} size="sm" accent="var(--sock-frame)" />;
  if (isFrameValue(v)) return <FrameChip value={v} size="sm" accent="var(--sock-frame)" />;
  if (isArrayValue(v)) {
    const arr = v as (number | string)[] | (number | string)[][];
    const twoD = Array.isArray(arr[0]);
    const firstCell = twoD ? (arr[0] as (number | string)[])[0] : (arr as (number | string)[])[0];
    const str = typeof firstCell === "string";
    const accent = twoD
      ? (str ? "var(--sock-strtable)" : "var(--sock-table)")
      : (str ? "var(--sock-strlist)" : "var(--sock-list)");
    return <ArrayChip value={arr} size="sm" accent={accent} />;
  }
  if (typeof v === "string") return <span className="solenoid-cable-inspector__value">{v || "—"}</span>;
  if (typeof v === "number") {
    const ann = formatAnnotationStore.getForNode(annNodeId);
    return <span className="solenoid-cable-inspector__value">{ann ? formatNumberWithAnnotation(v, ann) : formatScalar(v)}</span>;
  }
  return <span className="solenoid-cable-inspector__value solenoid-cable-inspector__value--empty">—</span>;
}

/**
 * Lower-left panel shown when exactly ONE cable is selected. Displays both ends
 * of the connection — source node + output port + the value on the wire, and
 * target node + input port + the value as received — so a cable is inspectable
 * without opening either node. Reads cableValueStore (already holds every output
 * value); no new computation. Roadmap Phase 0 legibility slice. When the Rust
 * engine lands (Phase 2) the wire value just becomes a .collect()ed preview.
 */
export function CableInspector() {
  useSyncExternalStore(cableSelectionStore.subscribe, cableSelectionStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  // Renames + topology changes (a node label edit, a deleted endpoint).
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  // Live restyle when a source node's Format Controller changes.
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);

  // One cable only — multi-select is ambiguous to inspect, so show nothing.
  if (cableSelectionStore.count() !== 1) return null;
  const id = cableSelectionStore.ids()[0];

  const editor = getEditor();
  if (!editor) return null;
  const conn = editor.getConnections().find((c) => c.id === id);
  if (!conn) return null;

  // A ribbon bundles several Conduit lanes under one representative id, so a
  // single From → To → Value would misrepresent the bundle (one Conduit end,
  // many lanes). Skip the inspector for ribbons; a separated single lane (where
  // ribbonForConnection returns null) still inspects normally.
  if (ribbonForConnection(editor, conn)) return null;

  const srcNode = editor.getNode(conn.source);
  const tgtNode = editor.getNode(conn.target);
  if (!srcNode || !tgtNode) return null;

  const srcTitle = (srcNode.label ?? "").trim() || nodeTypeName(srcNode);
  const tgtTitle = (tgtNode.label ?? "").trim() || nodeTypeName(tgtNode);
  const srcPort = srcNode.outputs[conn.sourceOutput]?.label || conn.sourceOutput;
  const tgtPort = tgtNode.inputs[conn.targetInput]?.label || conn.targetInput;

  // The wire carries the source output to the target input; the target receives
  // that same value (no per-input transform is stored), so both ends read it.
  const value = cableValueStore.get(conn.source, conn.sourceOutput);

  return (
    <div className="solenoid-cable-inspector" role="dialog" aria-label="Cable inspector">
      <div className="solenoid-cable-inspector__head">
        <span className="solenoid-cable-inspector__title">Cable</span>
        <button
          type="button"
          className="solenoid-cable-inspector__close"
          aria-label="Deselect cable"
          title="Deselect"
          onClick={() => cableSelectionStore.clear()}
        >
          <CloseIcon size={12} />
        </button>
      </div>

      <div className="solenoid-cable-inspector__end">
        <span className="solenoid-cable-inspector__role">From</span>
        <button
          type="button"
          className="solenoid-cable-inspector__node"
          title="Go to this node"
          onClick={() => flyToNode(conn.source)}
        >
          {srcTitle}
        </button>
        <span className="solenoid-cable-inspector__port">{srcPort}</span>
      </div>

      <div className="solenoid-cable-inspector__arrow" aria-hidden="true">↓</div>

      <div className="solenoid-cable-inspector__end">
        <span className="solenoid-cable-inspector__role">To</span>
        <button
          type="button"
          className="solenoid-cable-inspector__node"
          title="Go to this node"
          onClick={() => flyToNode(conn.target)}
        >
          {tgtTitle}
        </button>
        <span className="solenoid-cable-inspector__port">{tgtPort}</span>
      </div>

      {/* The value carried on the wire — what leaves the source output and, for
          now, exactly what the target input receives (Phase 2 may add a separate
          received row if engine coercion ever diverges it). */}
      <div className="solenoid-cable-inspector__wire">
        <span className="solenoid-cable-inspector__role">Value</span>
        {renderWireValue(value, conn.source)}
      </div>
    </div>
  );
}
