import { useState, useSyncExternalStore } from "react";
import { cableSelectionStore } from "../cableState";
import { useCableShape } from "../cableShape";
import { CableShapeIcon } from "../CableShapeSelector";
import { cableValueStore } from "../cableValueStore";
import { ribbonForConnection } from "../ribbonCable";
import { flyToNode } from "../flyToNode";
import { connectionVersionStore } from "../graphSignals";
import { getActiveEditor as getEditor } from "../activeGraph";
import { nodeDisplayName } from "../catalogUtils";
import { formatScalar } from "./format";
import { formatAnnotationStore, formatNumberWithAnnotation, applyLogicalStyle } from "../formatAnnotationStore";
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
import { CloseIcon } from "./CloseIcon";
import { SolenoidSocket } from "../sockets";
import { makeFrameShapeResolver } from "../frameShapeResolver";
import { conduitPath, type ConduitPathEnd } from "../conduitTrace";
import "./cableInspector.css";

// Mirrors PinLayer.renderValue.
function renderWireValue(v: unknown, annNodeId: string, outKey: string) {
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
    // Tinted from the origin SOCKET, not the first cell — the cable already knows
    // its type, and a date list's serials look numeric to a cell scan.
    const family = nodeOutputElemFamily(annNodeId, outKey);
    return <ArrayChip value={arr} size="sm" accent={arrayAccentFor(family, twoD)} elem={family} />;
  }
  if (typeof v === "string") return <span className="solenoid-cable-inspector__value">{v || "—"}</span>;
  if (typeof v === "boolean") {
    const ann = formatAnnotationStore.getForNode(annNodeId);
    return <span className="solenoid-cable-inspector__value">{applyLogicalStyle(v, ann?.logicalStyle)}</span>;
  }
  if (typeof v === "number") {
    const ann = formatAnnotationStore.getForNode(annNodeId);
    return <span className="solenoid-cable-inspector__value">{ann ? formatNumberWithAnnotation(v, ann) : formatScalar(v)}</span>;
  }
  // Tagged complex and united numbers have a text form — they fell through to
  // the empty dash before.
  if (isCx(v) || isUnitCell(v)) {
    const ann = formatAnnotationStore.getForNode(annNodeId);
    const one = (n: number) => (ann ? formatNumberWithAnnotation(n, ann) : formatScalar(n));
    return <span className="solenoid-cable-inspector__value">{formatListCell(v, one)}</span>;
  }
  return <span className="solenoid-cable-inspector__value solenoid-cable-inspector__value--empty">—</span>;
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const bs = new Set(b);
  return bs.size === new Set(a).size && a.every((x) => bs.has(x));
};

/** The panel for exactly ONE selected cable, or one whole Conduit run. Conduits
 *  are WIRING, not computation, so it reports the ends of the RUN, not of the
 *  segment, and reads cableValueStore rather than computing anything. */
export function CableInspector() {
  useSyncExternalStore(cableSelectionStore.subscribe, cableSelectionStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  // Renames + topology changes (a node label edit, a deleted endpoint).
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  // Live restyle when a source node's Format Controller changes.
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  // X folds the panel to a chip; the SELECTION stays (deselect is a canvas click).
  const [collapsed, setCollapsed] = useState(false);
  const { shape } = useCableShape();

  const selectedIds = cableSelectionStore.ids();
  if (selectedIds.length === 0) return null;

  const editor = getEditor();
  if (!editor) return null;
  const conn = editor.getConnections().find((c) => c.id === selectedIds[0]);
  if (!conn) return null;

  // The whole run this cable belongs to: its own id alone for a plain cable,
  // the full chain of segments when Conduits sit in between.
  const path = conduitPath(editor, conn);

  // Beyond one cable, only a complete Conduit run is inspectable — that's what
  // double-clicking a cable selects. Any other multi-selection is ambiguous.
  if (selectedIds.length > 1 && !sameSet(selectedIds, path.connIds)) return null;

  // A ribbon bundles several lanes under one id, so a single From → To → Value
  // would misrepresent it; a selected RUN is exempt, its ends being resolved.
  if (selectedIds.length === 1 && ribbonForConnection(editor, conn)) return null;

  const titleOf = (nodeId: string) => {
    const n = editor.getNode(nodeId);
    return n ? nodeDisplayName(n) : nodeId;
  };
  const outPortOf = (e: ConduitPathEnd) => editor.getNode(e.nodeId)?.outputs[e.key]?.label || e.key;
  const inPortOf = (e: ConduitPathEnd) => editor.getNode(e.nodeId)?.inputs[e.key]?.label || e.key;

  const origin = path.origin;
  if (!editor.getNode(origin.nodeId)) return null;
  const terminals = path.terminals.filter((t) => editor.getNode(t.nodeId));
  if (terminals.length === 0) return null;

  const srcTitle = titleOf(origin.nodeId);
  const srcPort = outPortOf(origin);

  // Every target receives the origin's output unchanged, so one row speaks for
  // the whole run.
  const value = cableValueStore.get(origin.nodeId, origin.key);

  // Static shape (columns + types) ahead of running anything, for a `frame` cable
  // only; null when the walk can't resolve it, and the row then doesn't render.
  const srcSocket = editor.getNode(origin.nodeId)?.outputs[origin.key]?.socket;
  const isFrameCable = srcSocket instanceof SolenoidSocket && srcSocket.dataType === "frame";
  const frameShape = isFrameCable ? makeFrameShapeResolver(editor).outShape(origin.nodeId, origin.key) : null;

  const tgtSummary = terminals.length === 1
    ? titleOf(terminals[0].nodeId)
    : `${terminals.length} inputs`;

  if (collapsed) {
    return (
      <button
        type="button"
        className="solenoid-cable-inspector solenoid-cable-inspector--chip"
        title={`${srcTitle} → ${tgtSummary}`}
        aria-label="Expand cable inspector"
        onClick={() => setCollapsed(false)}
      >
        <CableShapeIcon shape={shape} className="solenoid-cable-inspector__chip-icon" />
      </button>
    );
  }

  return (
    <div className="solenoid-cable-inspector" role="dialog" aria-label="Cable inspector">
      <div className="solenoid-cable-inspector__head">
        <span className="solenoid-cable-inspector__title">Cable</span>
        <button
          type="button"
          className="solenoid-cable-inspector__close"
          aria-label="Collapse to icon"
          title="Collapse"
          onClick={() => setCollapsed(true)}
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
          onClick={() => flyToNode(origin.nodeId)}
        >
          {srcTitle}
        </button>
        <span className="solenoid-cable-inspector__port">{srcPort}</span>
      </div>

      <div className="solenoid-cable-inspector__arrow" aria-hidden="true">↓</div>

      {path.conduits.length > 0 && (
        <>
          <div className="solenoid-cable-inspector__end solenoid-cable-inspector__end--via">
            <span className="solenoid-cable-inspector__role">Via</span>
            <div className="solenoid-cable-inspector__via-list">
              {path.conduits.map((cid) => (
                <button
                  key={cid}
                  type="button"
                  className="solenoid-cable-inspector__node solenoid-cable-inspector__via-node"
                  title="Go to this node"
                  onClick={() => flyToNode(cid)}
                >
                  {titleOf(cid)}
                </button>
              ))}
            </div>
          </div>
          <div className="solenoid-cable-inspector__arrow" aria-hidden="true">↓</div>
        </>
      )}

      {/* One row per input the run reaches — a Conduit lane can fan out. */}
      {terminals.map((t, i) => (
        <div className="solenoid-cable-inspector__end" key={`${t.nodeId}::${t.key}`}>
          <span className="solenoid-cable-inspector__role">{i === 0 ? "To" : ""}</span>
          <button
            type="button"
            className="solenoid-cable-inspector__node"
            title="Go to this node"
            onClick={() => flyToNode(t.nodeId)}
          >
            {titleOf(t.nodeId)}
          </button>
          <span className="solenoid-cable-inspector__port">{inPortOf(t)}</span>
        </div>
      ))}

      <div className="solenoid-cable-inspector__wire">
        <span className="solenoid-cable-inspector__role">Value</span>
        {renderWireValue(value, origin.nodeId, origin.key)}
      </div>

      {frameShape && (
        <div className="solenoid-cable-inspector__shape">
          <span className="solenoid-cable-inspector__role">Shape</span>
          <div className="solenoid-cable-inspector__shape-cols">
            {frameShape.columns.map((c) => (
              <span key={c.name} className="solenoid-cable-inspector__shape-col">
                {c.name}
                <span className="solenoid-cable-inspector__shape-type"> · {c.type}</span>
              </span>
            ))}
            {frameShape.dynamic && <span className="solenoid-cable-inspector__shape-dynamic">+ more</span>}
          </div>
        </div>
      )}
    </div>
  );
}
