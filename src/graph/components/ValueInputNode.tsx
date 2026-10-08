// [[B11]] maximalMerge, [[C118]] formatTravelsWithValue, [[C95]] commitOnEnter
import { useEffect, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { FormatControllerNode, VALUE_INPUT_OP_META, type ValueInputNode as ValueInputNodeType, type ValueInputOp } from "../rete-nodes";
import { NEGATIVE_STYLE_LABELS, SCALE_MODE_LABELS, type FormatStyleId, type TextCase, type TextAlign, type LogicalStyle, type DecimalMode, type NegativeStyle, type ScaleMode } from "../formatAnnotationStore";
import { familyOf, controlsFor, groupingApplies, negativeApplies, scaleApplies } from "../formatModel";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { clamp } from "../nodes/mathUtils";
import { stopDragStart } from "../coarse";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { collapseStore } from "../collapseStore";
import { SegToggle, OpToggle } from "./SegToggle";
import { LazySelect } from "./LazySelect";
import { CardSection } from "./CardSection";
import { TypeIcon } from "./TypeIcon";
import { FormatStyleSelect, DateStyleSelect, TextCaseSelect, LogicalStyleSelect, UnitSelect, CustomPatternField } from "./fcControls";
import { useDraftCommit, useNumberScrub, QuotedTextInput, INVALID_DRAFT } from "./inlineInput";
import { DateEntry } from "./DateEntry";
import type { DisplayValue } from "./valueDisplayFormat";
import "./ValueInputNode.css";
// The Format Controller's toggle and checkbox styles, so the same picks look the same on both cards.
import "./FormatControllerNode.css";

const ICON: Record<ValueInputOp, "number" | "string" | "date" | "logical"> = {
  number: "number", string: "string", date: "date", logical: "logical",
};

const OP_OPTIONS = (Object.keys(VALUE_INPUT_OP_META) as ValueInputOp[]).map((value) => ({
  value,
  label: <TypeIcon type={ICON[value]} />,
  title: VALUE_INPUT_OP_META[value].label,
}));

/** An in-place retype drops the cables it can't feed and re-adapts downstream FCs itself, and resets the card's size. */
async function applyValueOp(node: ValueInputNodeType, t: ValueInputOp): Promise<void> {
  if (!node.setOp(t)) return;
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  // A new type starts at the card's natural size: the text field grip's width is a live inline style on the card.
  const card = view?.nodeElement(node.id)?.querySelector<HTMLElement>(".solenoid-node");
  card?.style.removeProperty("width");
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
  const [dt, setDt] = useState<ValueInputOp>(data.op);
  useEffect(() => { setDt(data.op); }, [data.op]);
  const [, bump] = useState(0);
  const pick = (set: () => void) => { set(); bump((v) => v + 1); applyDisplayPick(data); };
  const commitValue = (text: string) => { data.value = text; void processGraph(data.id); };
  // Collapsed, the card is its result alone: the shared rule keeps a value field, so the entry steps out here.
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const entry = !collapsed;

  return (
    <NodeShell node={data} emit={emit}>
      <OpToggle
        value={dt}
        options={OP_OPTIONS}
        onChange={(next) => { setDt(next); void applyValueOp(data, next); }}
      />
      <CardSection label="Format" collapsible defaultOpen={formatIsSet(data)}>
        <FormatRows node={data} dt={dt} pick={pick} />
      </CardSection>
      {entry && dt === "number" && <NumberEntry text={data.value} onCommit={commitValue} />}
      {entry && dt === "string" && <QuotedTextInput variant="value" resizable value={data.value} onChange={commitValue} />}
      {entry && dt === "date" && <DateEntry raw={data.value} onCommit={commitValue} />}
      {entry && dt === "logical" && (
        <LogicalCheck
          checked={/^true$/i.test(data.value.trim())}
          onToggle={() => commitValue(/^true$/i.test(data.value.trim()) ? "FALSE" : "TRUE")}
        />
      )}
      <ValueDisplay value={data.cachedValue as DisplayValue} socketKey="value" />
    </NodeShell>
  );
}

/** Opens the folded Format section on load when a pick is away from the type's default (DESIGN.md § Card sections). */
function formatIsSet(n: ValueInputNodeType): boolean {
  switch (n.op) {
    case "number":  return n.effectiveFormat() !== "auto" || n.unit !== "none" || !n.grouping || n.negativeStyle !== "minus" || n.scaleMode !== "none";
    case "date":    return n.effectiveFormat() !== "date_dmy";
    case "string":  return n.textCase !== "none" || n.chip || n.bold || n.italic || n.textScale !== 14 || n.textAlign !== "right" || n.textMarkdown || n.textMono;
    case "logical": return n.logicalStyle !== "truefalse";
  }
}

/** The Format Controller's own dropdowns for this type, without its inherit pick: nothing arrives upstream of a source. */
function FormatRows({ node, dt, pick }: { node: ValueInputNodeType; dt: ValueInputOp; pick: (set: () => void) => void }) {
  const format = node.effectiveFormat();
  const c = controlsFor(familyOf(ICON[dt]), format);
  const stop = { onPointerDown: stopDragStart, onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };
  const setFormat = (f: FormatStyleId | "") => { if (f) pick(() => { node.format = f; }); };

  if (dt === "string") {
    return (
      <>
        <div className="solenoid-node__field-row" {...stop}>
          <TextCaseSelect
            className="solenoid-node__select"
            value={node.chip ? "chip" : node.textCase}
            onChange={(v) => { if (v) pick(() => { node.chip = v === "chip"; if (v !== "chip") node.textCase = v as TextCase; }); }}
          />
        </div>
        {!node.chip && <TextStyleRows node={node} pick={pick} />}
      </>
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
      {c.advanced && <NumberStyleRows node={node} format={format} pick={pick} />}
      {node.unit === "custom" && <CustomUnitRow node={node} pick={pick} />}
    </>
  );
}

/** The Format Controller's text picks: bold, italic, size, alignment, markdown and monospace. */
function TextStyleRows({ node, pick }: { node: ValueInputNodeType; pick: (set: () => void) => void }) {
  const stop = { onPointerDown: stopDragStart, onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };
  const toggle = (on: boolean) => `solenoid-fc__toggle${on ? " solenoid-fc__toggle--on" : ""}`;
  return (
    <>
      <div className="solenoid-node__field-row" {...stop}>
        <button type="button" className={toggle(node.bold)} style={{ fontWeight: 700 }} onClick={() => pick(() => { node.bold = !node.bold; })} title="Bold">B</button>
        <button type="button" className={toggle(node.italic)} style={{ fontStyle: "italic" }} onClick={() => pick(() => { node.italic = !node.italic; })} title="Italic">I</button>
        <LazySelect
          className="solenoid-node__select solenoid-fc__size"
          value={node.textScale}
          onChange={(e) => { const px = parseFloat(e.target.value); pick(() => { node.textScale = px; }); }}
          title="Text size"
        >
          {[11, 12, 14, 16, 20, 24, 32].map((px) => <option key={px} value={px}>{px}</option>)}
        </LazySelect>
        <SegToggle
          className="solenoid-seg--inline"
          value={node.textAlign}
          onChange={(a: TextAlign) => pick(() => { node.textAlign = a; })}
          options={[
            { value: "left",   label: "L", title: "Align left" },
            { value: "center", label: "C", title: "Align center" },
            { value: "right",  label: "R", title: "Align right, the default" },
          ]}
        />
      </div>
      <div className="solenoid-node__field-row" {...stop}>
        <label className="solenoid-fc__check" title="Render the text as markdown">
          <input type="checkbox" checked={node.textMarkdown} onChange={() => pick(() => { node.textMarkdown = !node.textMarkdown; })} />
          Markdown
        </label>
        <label className="solenoid-fc__check" title="Render in a monospace face">
          <input type="checkbox" checked={node.textMono} onChange={() => pick(() => { node.textMono = !node.textMono; })} />
          Monospace
        </label>
      </div>
    </>
  );
}

/** The Format Controller's number picks for the formats they apply to: grouping, negatives and scale. */
function NumberStyleRows({ node, format, pick }: { node: ValueInputNodeType; format: FormatStyleId; pick: (set: () => void) => void }) {
  const stop = { onPointerDown: stopDragStart, onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };
  return (
    <>
      {groupingApplies(format) && (
        <div className="solenoid-node__field-row" {...stop}>
          <label className="solenoid-fc__check" title="Thousands separator">
            <input type="checkbox" checked={node.grouping} onChange={() => pick(() => { node.grouping = !node.grouping; })} />
            1,000 separator
          </label>
        </div>
      )}
      {negativeApplies(format) && (
        <div className="solenoid-node__field-row" {...stop}>
          <LazySelect
            className="solenoid-node__select"
            value={node.negativeStyle}
            onChange={(e) => { const v = e.target.value as NegativeStyle; pick(() => { node.negativeStyle = v; }); }}
            title="Negative numbers"
          >
            {Object.entries(NEGATIVE_STYLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </LazySelect>
        </div>
      )}
      {scaleApplies(format) && (
        <div className="solenoid-node__field-row" {...stop}>
          <LazySelect
            className="solenoid-node__select"
            value={node.scaleMode}
            onChange={(e) => { const v = e.target.value as ScaleMode; pick(() => { node.scaleMode = v; }); }}
            title="Show scaled down: 1,200,000 in millions reads 1.2M"
          >
            {Object.entries(SCALE_MODE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </LazySelect>
        </div>
      )}
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

/** A number Value Input's field: typed text commits on Enter or blur, and a drag scrubs. A blank stays blank and reads as 0. */
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

/** A logical Value Input's TRUE/FALSE checkbox. */
export function LogicalCheck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "2px 0" }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ width: 14, height: 14 }}
      />
      <span style={{ fontSize: 13, color: checked ? "color-mix(in srgb, var(--sol-ok) 70%, var(--text))" : "var(--text-dim)" }}>
        {checked ? "TRUE" : "FALSE"}
      </span>
    </label>
  );
}
