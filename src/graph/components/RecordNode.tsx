import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RecordNode as RecordNodeType, RecordOp } from "../rete-nodes";
import { RECORD_OP_META } from "../rete-nodes";
import { NodeShell, OpSelect, type NodeProps, type OpOption } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs, useConnectedInputs } from "./inlineInput";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getOwningView } from "../activeGraph";
import { stopDragStart } from "../coarse";
import { dropInputCables } from "./cablePrune";
import { RecordLayoutField } from "./RecordLayoutField";

const OPTIONS: ReadonlyArray<OpOption<RecordOp>> = (Object.keys(RECORD_OP_META) as RecordOp[])
  .map((value) => ({ value, label: RECORD_OP_META[value].label }));

// A switch drops the departing keys' cables before the sockets go, or a cable would live on invisibly.
async function applyRecordOp(node: RecordNodeType, next: RecordOp): Promise<void> {
  const departing: string[] = [];
  if (node.op !== "cards" && next === "cards") departing.push("layout");
  if (node.op === "board" && next !== "board") departing.push("by");
  if (departing.length) await dropInputCables(node.id, departing);
  node.setOp(next);
  const view = getOwningView(node.id);
  if (view) await view.rerenderNode(node.id);
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
  const cv = data.cachedChart;
  const payload = cv?.payload?.kind === "record" ? cv.payload : null;
  const total = payload?.total ?? 0;
  const index = payload?.index ?? 0;

  function step(delta: number) {
    const next = Math.min(total, Math.max(1, (data.literals.page ?? 1) + delta));
    if (next === data.literals.page) return;
    data.literals.page = next;
    void processGraph(data.id);
  }

  function commitLayout(next: string) {
    data.stringLiterals.layout = next;
    void processGraph(data.id);
  }

  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutTop, setLayoutTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const t = el.offsetTop + el.offsetHeight / 2 - 6;
    setLayoutTop((prev) => (prev === t ? prev : t));
  });
  const layoutPort = data.inputs.layout;

  const hasBoxes = !!payload && (payload.cards.some((c) => c.length > 0) || (payload.deck?.rows.length ?? 0) > 0);
  const keys = ["frame", "rows", ...(op === "board" ? ["by"] : []), ...(collapsed && op !== "cards" ? ["layout"] : []), "options"];

  return (
    <NodeShell
      node={data}
      emit={emit}
      leading={!collapsed && op !== "cards" && layoutPort && layoutTop !== undefined
        ? <NodeSocket side="input" socketKey="layout" nodeId={data.id} emit={emit} payload={layoutPort.socket} top={layoutTop} />
        : null}
    >
      <OpSelect value={op} onChange={setOp} options={OPTIONS} />
      <InlineInputs node={data} emit={emit} keys={keys} />
      {!collapsed && op !== "cards" && (
        <div ref={layoutRef} style={{ position: "relative", marginTop: 4 }}>
          <RecordLayoutField value={data.stringLiterals.layout ?? ""} wired={layoutWired} onCommit={commitLayout} />
        </div>
      )}
      <div className="solenoid-node__section-divider" />
      {!collapsed && op === "detail" && total > 0 && (
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
      {hasBoxes && cv
        ? <div className="solenoid-node__display-value solenoid-node__display-value--chip"><ChartChip value={cv} /></div>
        : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
    </NodeShell>
  );
}
