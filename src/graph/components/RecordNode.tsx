import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RecordNode as RecordNodeType, RecordOp } from "../rete-nodes";
import { RECORD_OP_META } from "../rete-nodes";
import { NodeShell, OpSelect, type NodeProps, type OpOption } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs, useConnectedInputs } from "./inlineInput";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { stopDragStart } from "../coarse";
import { dropInputCables } from "./cablePrune";
import { RecordLayoutField } from "./RecordLayoutField";

// Derived from RECORD_OP_META so the dropdown can't drift from the Add-menu rows (SSOT-1).
const OPTIONS: ReadonlyArray<OpOption<RecordOp>> = (Object.keys(RECORD_OP_META) as RecordOp[])
  .map((value) => ({ value, label: RECORD_OP_META[value].label }));

// The op owns the Row / Group-by sockets, so a switch must drop the departing
// keys' cables BEFORE the sockets go (SSOT-9) — removed silently, a cable would
// live on invisibly.
async function applyRecordOp(node: RecordNodeType, next: RecordOp): Promise<void> {
  const departing: string[] = [];
  if (node.op === "card" && next !== "card") departing.push("row");
  if (node.op === "board" && next !== "board") departing.push("by");
  if (departing.length) await dropInputCables(node.id, departing);
  node.setOp(next);
  const area = getActiveArea();
  if (area) await area.update("node", node.id);
  await processGraph();
}

function Chevron({ back }: { back?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d={back ? "M6.5 1l-4 4 4 4" : "M3.5 1l4 4-4 4"}
        fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

export function RecordComponent({ data, emit }: NodeProps<RecordNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const [op, setOpState] = useState<RecordOp>(data.op);
  const setOp = useCallback((v: RecordOp) => { setOpState(v); void applyRecordOp(data, v); }, [data]);
  const connected = useConnectedInputs(data.id);
  const layoutWired = connected.has("layout");
  const rowWired = connected.has("row");
  const cv = data.cachedChart;
  const payload = cv?.payload?.kind === "record" ? cv.payload : null;
  const total = payload?.total ?? 0;
  const index = payload?.index ?? 0;

  // The pager is a discrete pick: it applies immediately (never per keystroke —
  // there is no keystroke), and only drives the card literal when Row is unwired.
  function step(delta: number) {
    const next = Math.min(total, Math.max(1, (data.literals.row ?? 1) + delta));
    if (next === data.literals.row) return;
    data.literals.row = next;
    void processGraph(data.id);
  }

  function commitLayout(next: string) {
    data.stringLiterals.layout = next;
    void processGraph(data.id);
  }

  // Measured against the card so the layout socket lines up with the textarea.
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutTop, setLayoutTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const t = el.offsetTop + el.offsetHeight / 2 - 6;
    setLayoutTop((prev) => (prev === t ? prev : t));
  });
  const layoutPort = data.inputs.layout;

  const hasBoxes = !!payload && payload.cards.some((c) => c.length > 0);
  // Per-op body rows; collapsed, the hand-rendered layout block is gone, so its
  // socket folds into the row pills (the ChartNode `values` pattern).
  const keys = ["frame", ...(op === "card" ? ["row"] : op === "board" ? ["by"] : []), ...(collapsed ? ["layout"] : []), "options"];

  return (
    <NodeShell
      node={data}
      emit={emit}
      leading={!collapsed && layoutPort && layoutTop !== undefined
        ? <NodeSocket side="input" socketKey="layout" nodeId={data.id} emit={emit} payload={layoutPort.socket} top={layoutTop} />
        : null}
    >
      <OpSelect value={op} onChange={setOp} options={OPTIONS} />
      <InlineInputs node={data} emit={emit} keys={keys} />
      {!collapsed && (
        <div ref={layoutRef} style={{ position: "relative", marginTop: 4 }}>
          <RecordLayoutField value={data.stringLiterals.layout ?? ""} wired={layoutWired} onCommit={commitLayout} />
        </div>
      )}
      <div className="solenoid-node__section-divider" />
      {!collapsed && op === "card" && !rowWired && total > 0 && (
        <div className="solenoid-record__pager">
          <button
            type="button" className="solenoid-record__pager-btn" title="Previous record"
            disabled={index <= 1}
            onClick={(e) => { e.stopPropagation(); step(-1); }}
            onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
          >
            <Chevron back />
          </button>
          <span className="solenoid-record__pager-count">{index > 0 ? index : "–"} / {total}</span>
          <button
            type="button" className="solenoid-record__pager-btn" title="Next record"
            disabled={index >= total}
            onClick={(e) => { e.stopPropagation(); step(1); }}
            onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
          >
            <Chevron />
          </button>
        </div>
      )}
      {/* The card never draws the grid — squished at card width it reads as
          noise. The hero box holds the chip (opens the popup at full size);
          the drawn card lives wherever the chart output lands: a resizable
          Display, a Report embed, the popup. */}
      {hasBoxes && cv
        ? <div className="solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={cv} /></div>
        : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
    </NodeShell>
  );
}
