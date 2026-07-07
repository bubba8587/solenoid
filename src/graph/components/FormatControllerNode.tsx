import { useState, useEffect, useMemo, useSyncExternalStore } from "react";
import { FormatControllerNode } from "../rete-nodes";
import type { FormatControllerNode as FormatControllerNodeType } from "../rete-nodes";
import {
  FORMAT_STYLE_LABELS, FORMAT_STYLE_GROUPS, DATE_FORMAT_STYLES, UNIT_ANNOTATIONS,
  LOGICAL_STYLE_LABELS, NEGATIVE_STYLE_LABELS, SCALE_MODE_LABELS,
  unitGroupLabel, formatMismatchStore,
  type FormatStyleId, type TextCase, type TextAlign, type DecimalMode, type LogicalStyle,
  type NegativeStyle, type ScaleMode,
} from "../formatAnnotationStore";
import {
  familyOf, controlsFor, COMPLEX_FORMAT_STYLES,
  groupingApplies, scaleApplies, negativeApplies,
} from "../formatModel";
import { packsStore } from "../packs";
import { activePackUnits, activePackFormats } from "../fcExtensions";
import { SOCKET_COLORS } from "../sockets";
import { processGraph, repositionDockedNodes } from "../process";
import { getOwningEditor } from "../activeGraph";
import { NodeCard } from "./NodeCard";
import { NodeSocket } from "./NodeSocket";
import { SegToggle } from "./SegToggle";
import type { NodeProps } from "./nodeKit";
import "./nodeCard.css";
import "./FormatControllerNode.css";

// Base unit-group display order. Active packs' groups are appended (before
// "custom") at render time — see the component's useMemo.
const BASE_UNIT_GROUP_ORDER: string[] = [
  "none", "angle", "length", "mass", "temperature",
  "time", "area", "volume", "speed", "data", "currency",
];

type UnitOption = { id: string; label: string };

// A small rounded direction arrow shown beside the Format / Unit controls to
// show how that property flows. "back" (←) = applies to the box behind this FC;
// "fwd" (→) = travels with the value downstream / arrives from upstream.
function FcArrow({ dir, title }: { dir: "back" | "fwd"; title?: string }) {
  return (
    <span
      className="solenoid-fc__arrow"
      aria-hidden="true"
      title={title}
      style={{ display: "inline-flex", opacity: 0.72, flex: "0 0 auto" }}
    >
      <svg width="9" height="9" viewBox="0 0 14 14" fill="none" stroke="currentColor"
           strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {dir === "fwd"
          ? (<><path d="M2.5 7h8.2" /><path d="M7 3.3 10.7 7 7 10.7" /></>)
          : (<><path d="M11.5 7H3.3" /><path d="M7 3.3 3.3 7 7 10.7" /></>)}
      </svg>
    </span>
  );
}

export function FormatControllerComponent({ data, emit }: NodeProps<FormatControllerNodeType>) {
  const node = data;

  const [format,        setFormatLocal]   = useState<FormatStyleId>(node.format);
  const [customPattern, setPatternLocal]  = useState(node.customPattern);
  const [unit,          setUnitLocal]     = useState(node.unit);
  const [customUnit,    setCustomUnitLocal] = useState(node.customUnit);
  const [textCase,      setTextCaseLocal] = useState<TextCase>(node.textCase);
  const [logicalStyle,  setLogicalLocal]  = useState<LogicalStyle>(node.logicalStyle);
  const [grouping,      setGroupingLocal] = useState(node.grouping);
  const [negativeStyle, setNegativeLocal] = useState<NegativeStyle>(node.negativeStyle);
  const [scaleMode,     setScaleModeLocal] = useState<ScaleMode>(node.scaleMode);
  const [advancedOpen,  setAdvancedLocal] = useState(node.advancedOpen);
  const [bold,          setBoldLocal]     = useState(node.bold);
  const [italic,        setItalicLocal]   = useState(node.italic);
  const [textScale,     setScaleLocal]    = useState(node.textScale);
  const [textAlign,     setTextAlignLocal] = useState<TextAlign>(node.textAlign);
  const [textMarkdown,  setTextMdLocal]   = useState(node.textMarkdown);
  const [textMono,      setTextMonoLocal] = useState(node.textMono);
  const [decimalDigits, setDigitsLocal]   = useState(node.decimalDigits);
  const [decimalMode,   setModeLocal]     = useState<DecimalMode>(node.decimalMode);
  // Raw text of the digits box, kept separate from the committed number so the
  // field can be transiently empty while editing (backspace the last digit).
  const [digitsText,    setDigitsText]    = useState(String(node.decimalDigits));

  const mismatch = useSyncExternalStore(
    formatMismatchStore.subscribe,
    () => formatMismatchStore.has(node.id),
  );

  // Merge built-in units/formats with the ones active packs contribute, so the
  // dropdowns grow when a pack is switched on. (Resolution of a value already
  // works for any registered pack id; this is just what the dropdowns OFFER.)
  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const { unitGroups, unitGroupOrder } = useMemo(() => {
    const byGroup = new Map<string, UnitOption[]>();
    const add = (g: string, u: UnitOption) => {
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push({ id: u.id, label: u.label });
    };
    for (const u of UNIT_ANNOTATIONS) add(u.group, u);
    const order = [...BASE_UNIT_GROUP_ORDER];
    for (const u of activePackUnits()) {
      add(u.group, u);
      if (!order.includes(u.group)) order.push(u.group);
    }
    if (byGroup.has("custom")) order.push("custom");
    return { unitGroups: byGroup, unitGroupOrder: order };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packsVersion]);
  const packFormatGroups = useMemo(() => {
    const m = new Map<string, UnitOption[]>();
    for (const f of activePackFormats()) {
      const g = f.group ?? "Pack";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push({ id: f.id, label: f.label });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packsVersion]);

  // Re-home onto a different-typed socket (drag-to-dock) can change node.format
  // and socketDataType externally; resync local state so the controlled selects
  // reflect it instead of showing a stale value.
  useEffect(() => {
    setFormatLocal(node.format);
    setUnitLocal(node.unit);
    setTextCaseLocal(node.textCase);
    setLogicalLocal(node.logicalStyle);
    setGroupingLocal(node.grouping);
    setNegativeLocal(node.negativeStyle);
    setScaleModeLocal(node.scaleMode);
    setBoldLocal(node.bold);
    setItalicLocal(node.italic);
    setScaleLocal(node.textScale);
    setTextAlignLocal(node.textAlign);
    setTextMdLocal(node.textMarkdown);
    setTextMonoLocal(node.textMono);
    // Resync when the wiring changes these externally — e.g. a forwarding FC's
    // unit being mirrored/locked from its upstream — so the dropdowns reflect it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.socketDataType, node.unit, node.format, node.forwarding, node.lockedByConvert]);

  function syncNode() {
    const editor = getOwningEditor(node.id); // refresh FCs in this node's own graph (drill-in too)
    if (editor) {
      // Refresh every FC, not just this one: a unit change here must propagate
      // to any downstream forwarding FC (whose unit is locked to its upstream).
      for (const n of editor.getNodes()) {
        if (n instanceof FormatControllerNode) n.refreshAnnotation(editor);
      }
    }
    void processGraph();
  }

  function onFormatChange(f: FormatStyleId) {
    node.format = f;
    setFormatLocal(f);
    syncNode();
    // Decimal/Percent add a middle row, changing the chip height; a docked FC
    // must re-center on its host socket once the new height has laid out.
    if (node.hostNodeId) {
      requestAnimationFrame(() => requestAnimationFrame(() => repositionDockedNodes(node.hostNodeId)));
    }
  }

  function onPatternChange(p: string) {
    node.customPattern = p;
    setPatternLocal(p);
    syncNode();
  }

  function onUnitChange(u: string) {
    node.unit = u;
    setUnitLocal(u);
    syncNode();
  }

  function onCustomUnitChange(u: string) {
    node.customUnit = u;
    setCustomUnitLocal(u);
    syncNode();
  }

  function onCaseChange(c: TextCase) {
    node.textCase = c;
    setTextCaseLocal(c);
    syncNode();
  }

  function onLogicalChange(s: LogicalStyle) {
    node.logicalStyle = s;
    setLogicalLocal(s);
    syncNode();
  }

  function toggleGrouping() {
    node.grouping = !node.grouping;
    setGroupingLocal(node.grouping);
    syncNode();
  }

  function onNegativeChange(s: NegativeStyle) {
    node.negativeStyle = s;
    setNegativeLocal(s);
    syncNode();
  }

  function onScaleChangeMode(s: ScaleMode) {
    node.scaleMode = s;
    setScaleModeLocal(s);
    syncNode();
  }

  // Expanding/collapsing the advanced tier changes the chip height; a docked
  // FC must re-center on its host socket once the new height has laid out
  // (same double-RAF as a format change).
  function toggleAdvanced() {
    node.advancedOpen = !node.advancedOpen;
    setAdvancedLocal(node.advancedOpen);
    if (node.hostNodeId) {
      requestAnimationFrame(() => requestAnimationFrame(() => repositionDockedNodes(node.hostNodeId)));
    }
  }

  function toggleBold() {
    node.bold = !node.bold;
    setBoldLocal(node.bold);
    syncNode();
  }

  function toggleItalic() {
    node.italic = !node.italic;
    setItalicLocal(node.italic);
    syncNode();
  }

  function onScaleChange(s: number) {
    node.textScale = s;
    setScaleLocal(s);
    syncNode();
  }

  function onTextAlignChange(a: TextAlign) {
    node.textAlign = a;
    setTextAlignLocal(a);
    syncNode();
  }

  function toggleTextMarkdown() {
    node.textMarkdown = !node.textMarkdown;
    setTextMdLocal(node.textMarkdown);
    syncNode();
  }

  function toggleTextMono() {
    node.textMono = !node.textMono;
    setTextMonoLocal(node.textMono);
    syncNode();
  }

  // Commit a final, clamped digit count (also normalizes the visible text).
  function commitDigits(d: number) {
    const lo = decimalMode === "sigfigs" ? 1 : 0;
    const clamped = Math.max(lo, Math.min(20, Math.round(d)));
    node.decimalDigits = clamped;
    setDigitsLocal(clamped);
    setDigitsText(String(clamped));
    syncNode();
  }

  // While typing: reflect exactly what's in the box (including empty), and
  // commit only when it parses — so backspacing the last digit isn't blocked.
  function onDigitsInput(raw: string) {
    setDigitsText(raw);
    if (raw === "") return; // transient empty — wait for more input or blur
    const d = parseInt(raw, 10);
    if (!Number.isFinite(d)) return;
    const lo = decimalMode === "sigfigs" ? 1 : 0;
    const clamped = Math.max(lo, Math.min(20, Math.round(d)));
    node.decimalDigits = clamped;
    setDigitsLocal(clamped);
    syncNode();
  }

  // On blur, an empty/invalid box falls back to 1 (0 sig figs is meaningless,
  // and an empty value shouldn't stick).
  function onDigitsBlur() {
    const d = parseInt(digitsText, 10);
    commitDigits(digitsText === "" || !Number.isFinite(d) ? 1 : d);
  }

  function onModeSet(mode: DecimalMode) {
    if (mode === decimalMode) return;
    node.decimalMode = mode;
    setModeLocal(mode);
    // sig figs needs ≥ 1; bump a 0 up so the value doesn't vanish.
    if (mode === "sigfigs" && decimalDigits < 1) commitDigits(1);
    syncNode();
  }

  const inputPort  = node.inputs["in"];
  const outputPort = node.outputs["out"];

  const socketAccent = SOCKET_COLORS[node.socketDataType];
  const accent = mismatch ? "#e06c2e" : socketAccent;

  // The FC adapts its controls to the host socket's type via the format model
  // (formatModel.ts / docs/format-model.md) — the ONE truth table for which
  // rows exist per family. A control outside the family is hidden, not
  // disabled: dates get date styles (no units), text gets case/B/I/size,
  // logical gets show-as, numbers get styles + precision + units, complex a
  // reduced style list, structural types (frame/cube/chart/…) nothing.
  const family = familyOf(node.socketDataType);
  const c = controlsFor(family, format);

  // Flow arrows flanking the controls — a three-state visual language matching
  // the v0.9 annotation semantics (the WHOLE annotation rides the value forward
  // through passthroughs; only the unit can be inherited or Convert-dictated):
  //   ← →  authored HERE: applies to the box behind, travels ahead with the value
  //   → →  inherited: the upstream value's unit passes through (forwarding FC)
  //   ← ←  dictated from ahead (Convert primacy)
  // The format/style row is always "authored here" (a downstream FC can
  // re-format — format never inherits), so it gets the fixed ← → pair.
  const hasUnit = unit !== "none";
  let unitLeft: "back" | "fwd" | null = null;
  let unitRight: "back" | "fwd" | null = null;
  if (node.lockedByConvert)   { unitLeft = "back"; unitRight = "back"; }
  else if (node.forwarding)   { unitLeft = "fwd"; unitRight = "fwd"; }
  else if (hasUnit)           { unitLeft = "back"; unitRight = "fwd"; }
  const backTitle = "Applies to the box behind this controller";
  const fwdTitle  = "Travels with the value through passthroughs";

  return (
    <NodeCard
      selected={node.selected}
      node={node}
      className="solenoid-fc"
      accentOverride={accent}
    >
      {/* Input socket (left) */}
      {inputPort && (
        <NodeSocket side="input" socketKey="in" nodeId={node.id} emit={emit} payload={inputPort.socket} />
      )}
      {/* Output socket (right) */}
      {outputPort && (
        <NodeSocket side="output" socketKey="out" nodeId={node.id} emit={emit} payload={outputPort.socket} />
      )}

      {/* Mismatch indicator — corner badge (no header to host it). */}
      {mismatch && (
        <span className="solenoid-fc__mismatch" title="Unit mismatch on connected cable">!</span>
      )}
      {c.text ? (
        /* Text: display-only case + bold / italic / size (non-destructive). */
        <>
        <div className="solenoid-fc__row">
          <FcArrow dir="back" title={backTitle} />
          <select
            className="solenoid-node__op-select solenoid-fc__select solenoid-fc__select--wide"
            value={textCase}
            onChange={(e) => onCaseChange(e.target.value as TextCase)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="Letter case (display only)"
          >
            <option value="none">Aa (as-is)</option>
            <option value="upper">UPPER</option>
            <option value="lower">lower</option>
            <option value="proper">Proper</option>
          </select>
          <FcArrow dir="fwd" title={fwdTitle} />
        </div>
        <div className="solenoid-fc__row">
          <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
          <button
            type="button"
            className={`solenoid-fc__toggle${bold ? " solenoid-fc__toggle--on" : ""}`}
            style={{ fontWeight: 700 }}
            onClick={toggleBold}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="Bold"
          >B</button>
          <button
            type="button"
            className={`solenoid-fc__toggle${italic ? " solenoid-fc__toggle--on" : ""}`}
            style={{ fontStyle: "italic" }}
            onClick={toggleItalic}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="Italic"
          >I</button>
          <select
            className="solenoid-node__op-select solenoid-fc__size"
            value={textScale}
            onChange={(e) => onScaleChange(parseFloat(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="Text size"
          >
            {[11, 12, 14, 16, 20, 24, 32].map((px) => (
              <option key={px} value={px}>{px}</option>
            ))}
          </select>
          <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
        </div>
        {/* Advanced tier — alignment / markdown / monospace, all display-only. */}
        {c.advanced && advancedOpen && (
          <>
            <div className="solenoid-fc__row">
              <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
              <SegToggle
                className="solenoid-seg--inline"
                value={textAlign}
                onChange={onTextAlignChange}
                options={[
                  { value: "left",   label: "L", title: "Align left" },
                  { value: "center", label: "C", title: "Align center" },
                  { value: "right",  label: "R", title: "Align right (default)" },
                ]}
              />
              <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
            </div>
            <div className="solenoid-fc__row">
              <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
              <label
                className="solenoid-fc__check"
                title="Render the text as markdown"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <input type="checkbox" checked={textMarkdown} onChange={toggleTextMarkdown} />
                Markdown
              </label>
              <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
            </div>
            <div className="solenoid-fc__row">
              <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
              <label
                className="solenoid-fc__check"
                title="Render in a monospace face"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <input type="checkbox" checked={textMono} onChange={toggleTextMono} />
                Monospace
              </label>
              <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
            </div>
          </>
        )}
        {c.advanced && (
          <div className="solenoid-fc__more-row">
            <button
              type="button"
              className="solenoid-fc__more"
              onClick={toggleAdvanced}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              title="Advanced text options"
              aria-expanded={advancedOpen}
            >
              <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true"
                   style={{ display: "block", transform: advancedOpen ? "rotate(180deg)" : undefined }}>
                <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
        </>
      ) : c.dateStyle ? (
        /* Date socket: one date-style dropdown, no units. */
        <>
        <div className="solenoid-fc__row">
          <FcArrow dir="back" title={backTitle} />
          <select
            className="solenoid-node__op-select solenoid-fc__select solenoid-fc__select--wide"
            value={format}
            onChange={(e) => onFormatChange(e.target.value as FormatStyleId)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="Date format"
          >
            {DATE_FORMAT_STYLES.map((s) => (
              <option key={s} value={s}>
                {s === "date_custom" ? "Custom…" : FORMAT_STYLE_LABELS[s]}
              </option>
            ))}
          </select>
          <FcArrow dir="fwd" title={fwdTitle} />
        </div>
        {format === "date_custom" && (
          <div className="solenoid-fc__row solenoid-fc__row--custom">
            <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
            <input
              type="text"
              className="solenoid-node__inline-input solenoid-fc__pattern"
              value={customPattern}
              placeholder="pattern, e.g. YYYY-MM-DD"
              onChange={(e) => onPatternChange(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
          </div>
        )}
        </>
      ) : c.logical ? (
        /* Logical socket: show-as (TRUE/FALSE · 1/0 · Yes/No · ✓/✗), display only. */
        <div className="solenoid-fc__row">
          <FcArrow dir="back" title={backTitle} />
          <select
            className="solenoid-node__op-select solenoid-fc__select solenoid-fc__select--wide"
            value={logicalStyle}
            onChange={(e) => onLogicalChange(e.target.value as LogicalStyle)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="How TRUE/FALSE renders"
          >
            {Object.entries(LOGICAL_STYLE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <FcArrow dir="fwd" title={fwdTitle} />
        </div>
      ) : !c.numberStyle && !c.complexStyle ? (
        /* Structural socket (frame/cube/chart/lambda): nothing formattable here —
           per-column frame formats are the v1.1 units milestone. */
        <div
          className="solenoid-fc__row solenoid-fc__row--none"
          title="No formattable value on this socket — table columns get formats with the units milestone"
        >—</div>
      ) : (
        /* Number-ish socket: number format and unit, stacked for a narrow chip.
           Complex gets the reduced style list (auto/decimal/scientific). */
        <>
        <div className="solenoid-fc__row">
          <FcArrow dir="back" title={backTitle} />
          <select
            className="solenoid-node__op-select solenoid-fc__select solenoid-fc__select--wide"
            value={format}
            onChange={(e) => onFormatChange(e.target.value as FormatStyleId)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="Number format"
          >
            {c.complexStyle ? (
              COMPLEX_FORMAT_STYLES.map((s) => (
                <option key={s} value={s}>{FORMAT_STYLE_LABELS[s]}</option>
              ))
            ) : (
              <>
              {Object.entries(FORMAT_STYLE_GROUPS).map(([group, styles]) =>
                styles.length === 1 && group === "General" ? (
                  <option key={styles[0]} value={styles[0]}>{FORMAT_STYLE_LABELS[styles[0]]}</option>
                ) : (
                  <optgroup key={group} label={group}>
                    {styles.map((s) => (
                      <option key={s} value={s}>{FORMAT_STYLE_LABELS[s]}</option>
                    ))}
                  </optgroup>
                )
              )}
              {[...packFormatGroups].map(([group, items]) => (
                <optgroup key={`pack:${group}`} label={group}>
                  {items.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </optgroup>
              ))}
              </>
            )}
          </select>
          <FcArrow dir="fwd" title={fwdTitle} />
        </div>
        {c.precision && (
          <div className="solenoid-fc__row solenoid-fc__row--decimal">
            {/* spacers matching the arrow gutters, so the controls line up with
                the dropdowns above and below */}
            <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
            <input
              type="number"
              className="solenoid-node__inline-input solenoid-fc__digits"
              value={digitsText}
              min={decimalMode === "sigfigs" ? 1 : 0}
              max={20}
              step={1}
              onChange={(e) => onDigitsInput(e.target.value)}
              onBlur={onDigitsBlur}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              title={decimalMode === "places" ? "Digits after the decimal point" : "Number of significant figures"}
            />
            <SegToggle
              className="solenoid-seg--inline"
              value={decimalMode}
              onChange={onModeSet}
              options={[
                { value: "places",  label: "places",   title: "Decimal places" },
                { value: "sigfigs", label: "sig figs", title: "Significant figures" },
              ]}
            />
            <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
          </div>
        )}
        {/* Custom pattern directly under the style rows — it IS a format. */}
        {format === "custom" && (
          <div className="solenoid-fc__row solenoid-fc__row--custom">
            <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
            <input
              type="text"
              className="solenoid-node__inline-input solenoid-fc__pattern"
              value={customPattern}
              placeholder='format, e.g. "0.00"'
              onChange={(e) => onPatternChange(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
          </div>
        )}
        {/* Advanced tier — MORE FORMATS, so it lives with the format cluster
            (above the unit row: formats re-format freely downstream, units
            lock — the two must not visually interleave). Rows are per-style
            gated by formatModel (never disabled-but-visible). */}
        {c.advanced && advancedOpen && (
          <>
            {groupingApplies(format) && (
              <div className="solenoid-fc__row">
                <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
                <label
                  className="solenoid-fc__check"
                  title="Thousands separator"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input type="checkbox" checked={grouping} onChange={toggleGrouping} />
                  1,000 separator
                </label>
                <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
              </div>
            )}
            {negativeApplies(format) && (
              <div className="solenoid-fc__row">
                <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
                <select
                  className="solenoid-node__op-select solenoid-fc__select solenoid-fc__select--wide"
                  value={negativeStyle}
                  onChange={(e) => onNegativeChange(e.target.value as NegativeStyle)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Negative numbers"
                >
                  {Object.entries(NEGATIVE_STYLE_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
                <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
              </div>
            )}
            {scaleApplies(format) && (
              <div className="solenoid-fc__row">
                <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
                <select
                  className="solenoid-node__op-select solenoid-fc__select solenoid-fc__select--wide"
                  value={scaleMode}
                  onChange={(e) => onScaleChangeMode(e.target.value as ScaleMode)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Show scaled down — 1,200,000 in millions reads 1.2M"
                >
                  {Object.entries(SCALE_MODE_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
                <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
              </div>
            )}
          </>
        )}
        {/* The expander closes the FORMAT cluster; the unit row sits below it.
            The row itself is plain card (draggable) — only the small chevron
            button captures the click. */}
        {c.advanced && (
          <div className="solenoid-fc__more-row">
            <button
              type="button"
              className="solenoid-fc__more"
              onClick={toggleAdvanced}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              title="Advanced formatting"
              aria-expanded={advancedOpen}
            >
              <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true"
                   style={{ display: "block", transform: advancedOpen ? "rotate(180deg)" : undefined }}>
                <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
        <div className="solenoid-fc__row">
          {unitLeft ? <FcArrow dir={unitLeft} title={
            node.lockedByConvert ? "Unit dictated by the Convert downstream"
            : node.forwarding    ? "Unit arrives with the value from upstream"
            : "Unit labels this box and travels downstream"
          } /> : <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />}
          <select
            className="solenoid-node__op-select solenoid-fc__select solenoid-fc__select--wide"
            value={unit}
            disabled={node.unitLocked}
            onChange={(e) => onUnitChange(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title={node.unitLocked ? "Unit locked (set elsewhere in the chain)" : "Unit label / cable constraint"}
          >
            {unitGroupOrder.map((group) => {
              const items = unitGroups.get(group);
              if (!items?.length) return null;
              if (group === "none") {
                return items.map((u) => (
                  <option key={u.id} value={u.id}>No unit</option>
                ));
              }
              return (
                <optgroup key={group} label={unitGroupLabel(group)}>
                  {items.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id === "custom" ? "Custom…" : (u.label.trim() || u.id)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {unitRight ? <FcArrow dir={unitRight} title={
            node.lockedByConvert ? "Unit dictated by the Convert downstream"
            : "Unit travels downstream with the value"
          } /> : <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />}
        </div>
        {unit === "custom" && (
          <div className="solenoid-fc__row solenoid-fc__row--custom">
            <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
            <input
              type="text"
              className="solenoid-node__inline-input solenoid-fc__pattern"
              value={customUnit}
              placeholder="unit, e.g. psi"
              onChange={(e) => onCustomUnitChange(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <span className="solenoid-fc__arrow-spacer" aria-hidden="true" />
          </div>
        )}
        </>
      )}
    </NodeCard>
  );
}
