import { useSyncExternalStore } from "react";
import type { ReportNode as ReportNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps, type Emit } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { refPreview, useRefAnnotation } from "./inlineRefDisplay";
import { valueChipFor } from "./ValueChip";
import { makeDocument, isDocumentValue } from "../documentValue";
import { isSolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";
import { collapseStore } from "../collapseStore";
import { cableValueStore } from "../cableValueStore";
import "./ReportNode.css";

/** One inline-ref INPUT row, laid out as a standard measured socket row so its dot
 *  straddles the card edge at the row's own vertical center. */
function ReportRefRow({ data, emit, refKey, label, value }: {
  data: ReportNodeType;
  emit: Emit;
  refKey: string;
  label: string;
  value: unknown;
}) {
  const input = data.inputs[refKey];
  const ann = useRefAnnotation(data.id, refKey);
  if (!input) return null;
  const preview = refPreview(value, ann);
  return (
    <MeasuredSocketRow side="input" socketKey={refKey} nodeId={data.id} emit={emit} payload={input.socket}>
      <span className="solenoid-node__io-label">{label}</span>
      <span className="solenoid-report__ref-value" title={preview}>{preview}</span>
    </MeasuredSocketRow>
  );
}

/** The Report's canvas card — a standard node. The body wires the template, the
 *  mail-merge records and each template variable; the hero box is the Document chip,
 *  which opens the full-screen editor (ReportOverlay). The real editing surface is
 *  that overlay, so this card is deliberately an anchor, not an editor. */
export function ReportComponent({ data, emit }: NodeProps<ReportNodeType>) {
  const refKeys = data.refKeys();
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  // The live `document` output: a DocumentValue (an openable chip) or a #SYNTAX! error.
  const doc = useSyncExternalStore(cableValueStore.subscribe, () => cableValueStore.get(data.id, "document"));
  const err = isSolError(doc) ? doc : null;

  return (
    <NodeShell node={data} emit={emit}>
      {collapsed ? (
        // Collapsed cleanly: the input rows fold away and every socket converges on one
        // pill, so their cables survive; only the pill + the document chip remain.
        <CollapsedInputPill node={data} emit={emit} keys={Object.keys(data.inputs)} />
      ) : (
        <>
          {/* The two STRUCTURAL inputs, each its own full row so their sockets read as
              distinct wiring points — the mail-merge records sit under the template. */}
          <ReportRefRow data={data} emit={emit} refKey="template" label="Template" value={data.templateDoc} />
          <ReportRefRow data={data} emit={emit} refKey="records" label="Records" value={data.recordsValue} />
          {refKeys.length > 0 && <div className="solenoid-node__section-divider" />}
          {refKeys.map((key) => (
            <ReportRefRow key={key} data={data} emit={emit} refKey={key} label={key} value={data.refValue(key)} />
          ))}
          <div className="solenoid-node__section-divider" />
        </>
      )}
      {/* Hero: the standard Document chip (opens the report) or the render error. The
          `document` output socket centers on this box (NodeCard's --out-socket-top). */}
      <div
        className={`solenoid-node__display-value${err ? " solenoid-node__display-value--error" : ""}`}
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}
        title={err ? errorTip(err) : undefined}
        onClick={err?.origin ? () => flyToNode(err.origin!.nodeId) : undefined}
        onPointerDown={err ? (e) => e.stopPropagation() : undefined}
      >
        {err ? err.code : valueChipFor(isDocumentValue(doc) ? doc : makeDocument("", {}, undefined, data.id), { size: "sm" })}
      </div>
    </NodeShell>
  );
}
