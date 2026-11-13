import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { RecordNode as RecordNodeType, CardsNode as CardsNodeType, RecordOp } from "../nodeClasses";
import { RECORD_OP_META } from "../nodeClasses";
import { NodeShell, OpSelect, type NodeProps, type OpOption } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs, useConnectedInputs } from "./inlineInput";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { cableValueStore } from "../cableValueStore";
import { isFrameValue } from "../frame";
import { suggestFrameLayout, PROFILE_ROWS } from "../cardLayout";
import { collectPreview } from "../frameBackend";
import { dropInputCables } from "./cablePrune";
import { RecordLayoutField } from "./RecordLayoutField";
import { CardSection, useRowsInUse } from "./CardSection";
import { sectionFoldStore } from "../sectionFoldStore";
import { ChartFigure } from "./chartView";
import type { ChartValue } from "../chartValue";
import { ChartExpandButton } from "./ChartExpandButton";
import { nodeDisplayName } from "../catalogUtils";

const LAYOUT = "Layout";
const FIG_H = 220;

// The figure takes the width its scroll box offers, not the card's: a vertical scrollbar narrows it (Display measures the same way).
function RecordFigure({ value, step, fallback, children }: {
  value: ChartValue; step?: (delta: number) => void; fallback: number; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(120, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="solenoid-record__figure nowheel">
      <ChartFigure value={value} width={w} height={FIG_H} recordNav={step} />
      {children}
    </div>
  );
}

const OPTIONS: ReadonlyArray<OpOption<RecordOp>> = (Object.keys(RECORD_OP_META) as RecordOp[])
  .map((value) => ({ value, label: RECORD_OP_META[value].label }));

// A switch drops the departing keys' cables before the sockets go, or a cable would live on invisibly.
async function applyRecordOp(node: RecordNodeType, next: RecordOp): Promise<void> {
  const departing: string[] = [];
  if (node.op === "board" && next !== "board") departing.push("by");
  if (departing.length) await dropInputCables(node.id, departing);
  node.setOp(next);
  const view = getOwningView(node.id);
  if (view) await view.rerenderNode(node.id);
  node.edited(); await processGraph();
}

export function RecordComponent({ data, emit }: NodeProps<RecordNodeType>) {
  const [op, setOpState] = useState<RecordOp>(data.op);
  const setOp = useCallback((v: RecordOp) => { setOpState(v); void applyRecordOp(data, v); }, [data]);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const keys = ["frame", "rows", ...(op === "board" ? ["by"] : []), ...(collapsed ? ["layout"] : []), "options"];
  return (
    <RecordCardComponent data={data} emit={emit} op={op}>
      <OpSelect value={op} onChange={setOp} options={OPTIONS} />
      <InlineInputs node={data} emit={emit} keys={keys} />
    </RecordCardComponent>
  );
}

export function CardsComponent({ data, emit }: NodeProps<CardsNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  return (
    <RecordCardComponent data={data} emit={emit} op="cards">
      <InlineInputs node={data} emit={emit} keys={["frame", "rows", ...(collapsed ? ["layout"] : []), "options"]} />
    </RecordCardComponent>
  );
}

/** The card both Record and Cards wear; `children` are the rows above the layout (the view picker and the inputs). */
function RecordCardComponent({ data, emit, op, children }: NodeProps<RecordNodeType | CardsNodeType> & { op: RecordOp | "cards"; children: ReactNode }) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const connected = useConnectedInputs(data.id);
  const layoutWired = connected.has("layout");
  const cv = data.cachedChart;
  const payload = cv?.payload?.kind === "record" ? cv.payload : null;
  const total = payload?.total ?? 0;

  function step(delta: number) {
    if (!("literals" in data)) return;
    const next = Math.min(total, Math.max(1, (data.literals.page ?? 1) + delta));
    if (next === data.literals.page) return;
    data.literals.page = next;
    void processGraph(data.id);
  }

  // Suggest reads the frame on the Frame cable ([[table-popup#The Cards view]]), which arrives as a lazy handle: only the rows the
  // suggestion profiles are collected. Detail's single card gets four columns, a tile two.
  async function suggestLayout(): Promise<string> {
    const conn = getOwningEditor(data.id)?.getConnections().find((c) => c.target === data.id && c.targetInput === "frame");
    const f = conn ? await collectPreview(cableValueStore.get(conn.source, conn.sourceOutput), PROFILE_ROWS) : null;
    return isFrameValue(f) ? suggestFrameLayout(f, op === "detail" ? 4 : 2) : "";
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
  // Open while a layout is written or wired; a hand fold or open is saved with the document (CardSection).
  const layoutInUse = useRowsInUse(data, ["layout"]);
  const layoutOpen = useSyncExternalStore(sectionFoldStore.subscribe, () => sectionFoldStore.get(data.id, LAYOUT)) ?? layoutInUse;

  const hasBoxes = !!payload && (payload.cards.some((c) => c.length > 0) || (payload.deck?.rows.length ?? 0) > 0);

  return (
    <NodeShell
      node={data}
      emit={emit}
      leading={!collapsed && layoutOpen && layoutPort && layoutTop !== undefined
        ? <NodeSocket side="input" socketKey="layout" nodeId={data.id} emit={emit} payload={layoutPort.socket} top={layoutTop} />
        : null}
    >
      {children}
      {!collapsed && (
        <CardSection label={LAYOUT} collapsible defaultOpen={layoutInUse} sockets={{ node: data, emit, keys: ["layout"] }}>
          <div ref={layoutRef} style={{ position: "relative", marginTop: 4 }}>
            <RecordLayoutField value={data.stringLiterals.layout ?? ""} wired={layoutWired} onCommit={commitLayout} onSuggest={suggestLayout} />
          </div>
        </CardSection>
      )}
      <div className="solenoid-node__section-divider" />
      {/* The figure draws in the card as other charts do, scrolling inside its box; Detail pages with its own pager. */}
      {!collapsed && hasBoxes && cv ? (
        <RecordFigure value={cv} fallback={(data.width ?? 240) - 22} step={op === "detail" && total > 1 ? step : undefined}>
          <ChartExpandButton title={nodeDisplayName(data)} op="column" axes={false} series={[]} value={cv} />
        </RecordFigure>
      ) : !collapsed && <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
      {cv && (
        <div className="solenoid-node__collapsed-only solenoid-node__display-value solenoid-node__display-value--chip">
          <ChartChip value={cv} />
        </div>
      )}
    </NodeShell>
  );
}
