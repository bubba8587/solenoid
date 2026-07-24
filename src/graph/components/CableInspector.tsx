import { useState, useSyncExternalStore } from "react";
import { cableSelectionStore } from "../cableState";
import { useCableShape } from "../cableShape";
import { CableShapeIcon } from "../CableShapeSelector";
import { cableValueStore } from "../cableValueStore";
import { ribbonForConnection } from "../ribbonCable";
import { flyToNode } from "../flyToNode";
import { connectionVersionStore, getEditor } from "../process";
import { nodeTypeName } from "../nodeNames";
import { formatScalar } from "./format";
import { formatAnnotationStore, formatNumberWithAnnotation, applyLogicalStyle } from "../formatAnnotationStore";
import { isSolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { ArrayChip, isArrayValue } from "./ArrayChip";
import { FrameChip, FrameRefChip } from "./FrameChip";
import { isFrameRef } from "../frameBackend";
import { CubeChip } from "./CubeChip";
import { isFrameValue, isCubeValue } from "../frame";
import { CloseIcon } from "./CloseIcon";
import { SolenoidSocket } from "../sockets";
import { makeFrameShapeResolver } from "../frameShapeResolver";
import { conduitPath, type ConduitPathEnd } from "../conduitTrace";
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
  if (typeof v === "boolean") {
    const ann = formatAnnotationStore.getForNode(annNodeId);
    return <span className="solenoid-cable-inspector__value">{applyLogicalStyle(v, ann?.logicalStyle)}</span>;
  }
  if (typeof v === "number") {
    const ann = formatAnnotationStore.getForNode(annNodeId);
    return <span className="solenoid-cable-inspector__value">{ann ? formatNumberWithAnnotation(v, ann) : formatScalar(v)}</span>;
  }
  return <span className="solenoid-cable-inspector__value solenoid-cable-inspector__value--empty">—</span>;
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const bs = new Set(b);
  return bs.size === new Set(a).size && a.every((x) => bs.has(x));
};

/**
 * Lower-left panel shown when exactly ONE cable — or one whole Conduit run
 * (double-click) — is selected. Displays both ends of the connection: source
 * node + output port + the value on the wire, and target node + input port + the
 * value as received, so a cable is inspectable without opening either node.
 *
 * Conduits are WIRING, not computation, so the panel reports the ends of the
 * RUN, not of the segment: a cable leaving a Conduit names the node that really
 * produced the value, a cable entering one names every input it really reaches,
 * and the Conduits crossed on the way are listed on their own quiet "Via" row
 * (see conduitPath). The value + shape rows follow the resolved origin too.
 *
 * Reads cableValueStore (already holds every output value); no new computation.
 * Roadmap Phase 0 legibility slice. When the Rust engine lands (Phase 2) the
 * wire value just becomes a .collect()ed preview.
 */
export function CableInspector() {
  useSyncExternalStore(cableSelectionStore.subscribe, cableSelectionStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  // Renames + topology changes (a node label edit, a deleted endpoint).
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  // Live restyle when a source node's Format Controller changes.
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  // X folds the panel to a small cable chip (the selection stays — deselect is
  // a canvas click, not the panel's job). Sticky across cable picks until
  // expanded again; the component never unmounts, so plain state suffices.
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

  // A ribbon bundles several Conduit lanes under one representative id, so a
  // single From → To → Value would misrepresent the bundle (one Conduit end,
  // many lanes). Skip the inspector for a lone ribbon cable; a separated single
  // lane (where ribbonForConnection returns null) still inspects normally. A
  // selected RUN is exempt: its ends are resolved, so the bundling in the middle
  // no longer makes them ambiguous.
  if (selectedIds.length === 1 && ribbonForConnection(editor, conn)) return null;

  const titleOf = (nodeId: string) => {
    const n = editor.getNode(nodeId);
    return n ? (n.label ?? "").trim() || nodeTypeName(n) : nodeId;
  };
  const outPortOf = (e: ConduitPathEnd) => editor.getNode(e.nodeId)?.outputs[e.key]?.label || e.key;
  const inPortOf = (e: ConduitPathEnd) => editor.getNode(e.nodeId)?.inputs[e.key]?.label || e.key;

  const origin = path.origin;
  if (!editor.getNode(origin.nodeId)) return null;
  const terminals = path.terminals.filter((t) => editor.getNode(t.nodeId));
  if (terminals.length === 0) return null;

  const srcTitle = titleOf(origin.nodeId);
  const srcPort = outPortOf(origin);

  // The wire carries the origin's output to every input it reaches; each target
  // receives that same value (no per-input transform is stored), so one row
  // speaks for the whole run.
  const value = cableValueStore.get(origin.nodeId, origin.key);

  // Static shape (columns + types), computed ahead of running anything — only for
  // a table cable (a `frame`-typed output). null on a cube/matrix/scalar cable,
  // or when the walk can't resolve it (an unconfigured verb, a runtime-loaded
  // source) — the row just doesn't render then.
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

      {/* The Conduits the run threads through — quiet, because they're wiring:
          the run's real ends are the two rows above and below. */}
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

      {/* One row per input the run actually reaches — a Conduit lane can fan out
          to several, and every one of them receives this same value. */}
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

      {/* The value carried on the wire — what leaves the origin output and, for
          now, exactly what each target input receives (Phase 2 may add a separate
          received row if engine coercion ever diverges it). */}
      <div className="solenoid-cable-inspector__wire">
        <span className="solenoid-cable-inspector__role">Value</span>
        {renderWireValue(value, origin.nodeId)}
      </div>

      {/* The statically-computed column shape — visible before anything runs. */}
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
