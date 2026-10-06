// [[B11]] maximalMerge, [[C118]] formatTravelsWithValue, [[C95]] commitOnEnter
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { FormatControllerNode, type ValueInputNode as ValueInputNodeType, type ValueInputType } from "../rete-nodes";
import type { FormatStyleId, TextCase, LogicalStyle, DecimalMode } from "../formatAnnotationStore";
import { familyOf, controlsFor } from "../formatModel";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { clamp } from "../nodes/mathUtils";
import { stopDragStart } from "../coarse";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { TypeIcon } from "./TypeIcon";
import { FormatStyleSelect, DateStyleSelect, TextCaseSelect, LogicalStyleSelect, UnitSelect, CustomPatternField } from "./fcControls";
import { useDraftCommit, useNumberScrub, QuotedTextInput, INVALID_DRAFT } from "./inlineInput";
import { DateEntry } from "./DateInputNode";
import { LogicalCheck } from "./BooleanInputNode";
import type { DisplayValue } from "./valueDisplayFormat";
import "./ValueInputNode.css";

const TYPE_OPTIONS: ReadonlyArray<{ value: ValueInputType; label: ReactNode; title: string }> = [
  { value: "number",  label: <TypeIcon type="number" />,  title: "Number" },
  { value: "string",  label: <TypeIcon type="string" />,  title: "Text" },
  { value: "date",    label: <TypeIcon type="date" />,    title: "Date" },
  { value: "logical", label: <TypeIcon type="logical" />, title: "Boolean: TRUE or FALSE" },
];

const SOCKET_OF: Record<ValueInputType, "number" | "string" | "date" | "logical"> = {
  number: "number", string: "string", date: "date", logical: "logical",
};

/** An in-place retype drops the cables it can't feed and re-adapts downstream FCs itself. */
async function applyValueType(node: ValueInputNodeType, t: ValueInputType): Promise<void> {
  if (!node.setDataType(t)) return;
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (editor && view) await retypeOutputCables(editor, view, node.id, "value");
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

/** A display pick changes no value, so it re-resolves every FC (one inheriting from this card) and redraws the whole graph, as the FC's own picks do. */
function applyDisplayPick(node: ValueInputNodeType): void {
  const editor = getOwningEditor(node.id);
  if (editor) for (const n of editor.getNodes()) if (n instanceof FormatControllerNode) n.refreshAnnotation(editor);
  void processGraph();
}

export function ValueInputComponent({ data, emit }: NodeProps<ValueInputNodeType>) {
  const [dt, setDt] = useState<ValueInputType>(data.dataType);
  useEffect(() => { setDt(data.dataType); }, [data.dataType]);
  const [, bump] = useState(0);
  const pick = (set: () => void) => { set(); bump((v) => v + 1); applyDisplayPick(data); };
  const commitValue = (text: string) => { data.value = text; void processGraph(data.id); };

  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <SegToggle
        value={dt}
        options={TYPE_OPTIONS}
        onChange={(next) => { setDt(next); void applyValueType(data, next); }}
      />
      <FormatRows node={data} dt={dt} pick={pick} />
      {dt === "number" && <NumberEntry text={data.value} onCommit={commitValue} />}
      {dt === "string" && <QuotedTextInput variant="value" nodeId={data.id} value={data.value} onChange={commitValue} />}
      {dt === "date" && <DateEntry raw={data.value} onCommit={commitValue} />}
      {dt === "logical" && (
        <LogicalCheck
          checked={/^true$/i.test(data.value.trim())}
          onToggle={() => commitValue(/^true$/i.test(data.value.trim()) ? "FALSE" : "TRUE")}
        />
      )}
      <ValueDisplay value={data.cachedValue as DisplayValue} socketKey="value" />
    </NodeShell>
  );
}

/** The Format Controller's own dropdowns for this type, without its inherit pick: nothing arrives upstream of a source. */
function FormatRows({ node, dt, pick }: { node: ValueInputNodeType; dt: ValueInputType; pick: (set: () => void) => void }) {
  const format = node.effectiveFormat();
  const c = controlsFor(familyOf(SOCKET_OF[dt]), format);
  const stop = { onPointerDown: stopDragStart, onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };
  const setFormat = (f: FormatStyleId | "") => { if (f) pick(() => { node.format = f; }); };

  if (dt === "string") {
    return (
      <div className="solenoid-node__field-row" {...stop}>
        <TextCaseSelect
          className="solenoid-node__select"
          value={node.chip ? "chip" : node.textCase}
          onChange={(v) => { if (v) pick(() => { node.chip = v === "chip"; if (v !== "chip") node.textCase = v as TextCase; }); }}
        />
      </div>
    );
  }
  if (dt === "logical") {
    return (
      <div className="solenoid-node__field-row" {...stop}>
        <LogicalStyleSelect
          className="solenoid-node__select"
          value={node.logicalStyle}
          onChange={(v) => { if (v) pick(() => { node.logicalStyle = v as LogicalStyle; }); }}
        />
      </div>
    );
  }
  if (dt === "date") {
    return (
      <>
        <div className="solenoid-node__field-row" {...stop}>
          <DateStyleSelect className="solenoid-node__select" value={format} onChange={setFormat} />
        </div>
        {c.customPattern && (
          <div className="solenoid-node__field-row">
            <CustomPatternField className="solenoid-node__inline-input" value={node.customPattern} date onCommit={(p) => pick(() => { node.customPattern = p; })} />
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <div className="solenoid-node__field-row" {...stop}>
        <FormatStyleSelect className="solenoid-node__select" value={format} onChange={setFormat} />
      </div>
      {c.precision && <PrecisionRow node={node} pick={pick} />}
      {c.customPattern && (
        <div className="solenoid-node__field-row">
          <CustomPatternField className="solenoid-node__inline-input" value={node.customPattern} date={false} onCommit={(p) => pick(() => { node.customPattern = p; })} />
        </div>
      )}
      <div className="solenoid-node__field-row" {...stop}>
        <UnitSelect className="solenoid-node__select" value={node.unit} onChange={(u) => pick(() => { node.unit = u; })} title="This value's unit" />
      </div>
      {node.unit === "custom" && <CustomUnitRow node={node} pick={pick} />}
    </>
  );
}

function PrecisionRow({ node, pick }: { node: ValueInputNodeType; pick: (set: () => void) => void }) {
  const lo = node.decimalMode === "sigfigs" ? 1 : 0;
  const digits = useDraftCommit(node.decimalDigits, String, (t) => {
    const d = parseInt(t, 10);
    return clamp(t === "" || !Number.isFinite(d) ? 1 : d, lo, 20);
  }, (d) => pick(() => { node.decimalDigits = d; }));
  return (
    <div className="solenoid-node__field-row">
      <input
        type="number"
        className="solenoid-node__inline-input solenoid-valin__digits"
        value={digits.draft}
        min={lo}
        max={20}
        step={1}
        onChange={(e) => digits.setDraft(e.target.value)}
        onBlur={digits.onBlur}
        onKeyDown={digits.onKeyDown}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
        title={node.decimalMode === "places" ? "Digits after the decimal point" : "Number of significant figures"}
      />
      <SegToggle
        className="solenoid-seg--inline"
        value={node.decimalMode}
        onChange={(m: DecimalMode) => pick(() => {
          node.decimalMode = m;
          if (m === "sigfigs" && node.decimalDigits < 1) node.decimalDigits = 1;
        })}
        options={[
          { value: "places",  label: "places",   title: "Decimal places" },
          { value: "sigfigs", label: "sig figs", title: "Significant figures" },
        ]}
      />
    </div>
  );
}

function CustomUnitRow({ node, pick }: { node: ValueInputNodeType; pick: (set: () => void) => void }) {
  const field = useDraftCommit(node.customUnit, (v) => v, (t) => t, (u) => pick(() => { node.customUnit = u; }));
  return (
    <div className="solenoid-node__field-row">
      <input
        type="text"
        className="solenoid-node__inline-input"
        value={field.draft}
        placeholder="unit, for example psi"
        onChange={(e) => field.setDraft(e.target.value)}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** Number Input's field: typed text commits on Enter or blur, and a drag scrubs. A blank stays blank and reads as 0. */
function NumberEntry({ text, onCommit }: { text: string; onCommit: (text: string) => void }) {
  const field = useDraftCommit<string>(
    text,
    (v) => v,
    (t) => {
      const s = t.trim();
      return s === "" || Number.isFinite(Number(s)) ? s : INVALID_DRAFT;
    },
    onCommit,
  );
  const n = Number(text.trim());
  const scrub = useNumberScrub(
    Number.isFinite(n) ? n : 0,
    (v) => field.setDraft(v == null ? "" : String(v)),
    (next) => onCommit(String(next)),
  );
  return (
    <input
      className="solenoid-node__value-input"
      type="number"
      value={field.draft}
      onChange={(e: ChangeEvent<HTMLInputElement>) => field.setDraft(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      {...scrub}
      onMouseDown={(e) => e.stopPropagation()}
      step="any"
    />
  );
}
