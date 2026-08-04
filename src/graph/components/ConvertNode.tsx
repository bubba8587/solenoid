import { useState, useRef, useLayoutEffect, useSyncExternalStore, type ChangeEvent } from "react";
import type { ConvertNode as ConvertNodeType, ConvertCategory, ConvertUnitDef } from "../rete-nodes";
import { CONVERT_UNIT_DEFS, CONVERT_CATEGORY_LABELS, FormatControllerNode } from "../rete-nodes";
import {
  applyFormatStyle, FORMAT_STYLE_GROUPS, FORMAT_STYLE_LABELS, type FormatStyle,
} from "../formatAnnotationStore";
import { processGraph } from "../process";
import { getOwningEditor } from "../activeGraph";
import { collapseStore } from "../collapseStore";
import { LazySelect } from "./LazySelect";
import { NodeSocket } from "./NodeSocket";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

const CATEGORY_ORDER: ConvertCategory[] = [
  "angle", "length", "mass", "temperature",
  "time", "area", "volume", "speed", "energy", "pressure",
];

type UnitEntry = [string, ConvertUnitDef];

const unitsByCategory = new Map<ConvertCategory, UnitEntry[]>();
for (const [key, def] of Object.entries(CONVERT_UNIT_DEFS)) {
  let arr = unitsByCategory.get(def.category);
  if (!arr) { arr = []; unitsByCategory.set(def.category, arr); }
  arr.push([key, def]);
}

// A value + its unit's short code, formatted via the box's own format style.
function withUnit(n: number, code: string, format: FormatStyle): string {
  if (Number.isNaN(n)) return "—";
  const body = applyFormatStyle(n, format);
  return code ? `${body} ${code}` : body;
}

// The in/out format dropdown — Convert's own display format for each box,
// reusing the FC number-format groups.
function FormatSelect({ value, onChange }: { value: FormatStyle; onChange: (e: ChangeEvent<HTMLSelectElement>) => void }) {
  return (
    <LazySelect
      className="solenoid-node__op-select"
      value={value}
      onChange={onChange}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      title="Display format"
    >
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
    </LazySelect>
  );
}

// A unit-imposing arrow shown on Convert when an FC is wired adjacent. "up"
// points back toward the input (Convert dictates the upstream FC's unit); "down"
// points forward toward the output (it dictates the downstream FC's unit).
function DirArrow({ dir }: { dir: "up" | "down" }) {
  return (
    <span
      aria-hidden="true"
      title={dir === "up" ? "This sets the upstream unit" : "This sets the downstream unit"}
      style={{ display: "inline-flex", color: "var(--node-accent, #9aa0a6)", opacity: 0.6, flex: "0 0 auto" }}
    >
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor"
           strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {dir === "down"
          ? (<><path d="M2.5 7h8.2" /><path d="M7 3.3 10.7 7 7 10.7" /></>)
          : (<><path d="M11.5 7H3.3" /><path d="M7 3.3 3.3 7 7 10.7" /></>)}
      </svg>
    </span>
  );
}


export function ConvertComponent({ data, emit }: NodeProps<ConvertNodeType>) {
  const node = data;
  const [fromUnit, setFromUnit] = useState(node.fromUnit);
  const [toUnit, setToUnit] = useState(node.toUnit);
  const [inFormat, setInFormat] = useState(node.inFormat);
  const [outFormat, setOutFormat] = useState(node.outFormat);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(node.id));

  // Convert has unit primacy: when its from/to changes, any adjacent FC must
  // relock to the new unit. Re-project every FC's annotation, like FC's syncNode.
  function refreshFcs() {
    const editor = getOwningEditor(node.id); // relock FCs in this node's own graph (drill-in too)
    if (!editor) return;
    for (const n of editor.getNodes()) {
      if (n instanceof FormatControllerNode) n.refreshAnnotation(editor);
    }
  }

  async function onFromChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    node.fromUnit = next;
    setFromUnit(next);
    const fromCat = CONVERT_UNIT_DEFS[next]?.category;
    const toCat   = CONVERT_UNIT_DEFS[toUnit]?.category;
    if (fromCat && fromCat !== toCat) {
      const firstInCat = unitsByCategory.get(fromCat)?.[0]?.[0];
      if (firstInCat) {
        node.toUnit = firstInCat;
        setToUnit(firstInCat);
      }
    }
    refreshFcs();
    await processGraph();
  }

  async function onToChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    node.toUnit = next;
    setToUnit(next);
    refreshFcs();
    await processGraph();
  }

  // Display-only: re-render this node with the new box format. No recompute or
  // FC refresh — these formats affect only Convert's own in/out boxes.
  function onInFormatChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as FormatStyle;
    node.inFormat = next;
    setInFormat(next);
  }
  function onOutFormatChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as FormatStyle;
    node.outFormat = next;
    setOutFormat(next);
  }

  const fromCat    = CONVERT_UNIT_DEFS[fromUnit]?.category;
  const toCatUnits = fromCat ? (unitsByCategory.get(fromCat) ?? []) : [];
  const fromCode   = CONVERT_UNIT_DEFS[fromUnit]?.excelCode ?? "";
  const toCode     = CONVERT_UNIT_DEFS[toUnit]?.excelCode ?? "";

  // The input/output sockets align to the in/out display boxes (the data enters
  // at the input box, leaves at the output box). Measure each box's center from
  // the DOM after layout so the dots track regardless of font/padding shifts.
  const inBoxRef  = useRef<HTMLDivElement>(null);
  const outBoxRef = useRef<HTMLDivElement>(null);
  const [inTop, setInTop]   = useState<number | undefined>(undefined);
  const [outTop, setOutTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = (el: HTMLElement | null) =>
      el ? el.offsetTop + el.offsetHeight / 2 - 6 : undefined;
    const i = measure(inBoxRef.current);
    const o = measure(outBoxRef.current);
    setInTop((p) => (p === i ? p : i));
    setOutTop((p) => (p === o ? p : o));
  });

  const inputPort  = node.inputs["in"];
  const outputPort = node.outputs["out"];
  // Sockets are placed by us (aligned to the boxes), so suppress NodeShell's
  // default output socket. When collapsed the boxes are hidden — fall back to
  // the default socket position.
  const sockets = (
    <>
      {inputPort && (
        <NodeSocket side="input" socketKey="in" nodeId={node.id} emit={emit} payload={inputPort.socket} top={collapsed ? undefined : inTop} />
      )}
      {outputPort && (
        <NodeSocket side="output" socketKey="out" nodeId={node.id} emit={emit} payload={outputPort.socket} top={collapsed ? undefined : outTop} />
      )}
    </>
  );

  return (
    <NodeShell node={data} emit={emit} leading={sockets} hideOutputSockets>
      <div ref={inBoxRef} style={{ display: "flex", alignItems: "center", gap: 2 }}>
        {node.imposesUp && <DirArrow dir="up" />}
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <ValueDisplay
            value={node.cachedInput}
            render={(v) => withUnit(v, fromCode, inFormat)}
            toClipboard={(v) => withUnit(v, fromCode, inFormat)}
          />
        </div>
      </div>
      <FormatSelect value={inFormat} onChange={onInFormatChange} />
      <LazySelect
        className="solenoid-node__op-select"
        value={fromUnit}
        onChange={onFromChange}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {CATEGORY_ORDER.map((cat) => {
          const units = unitsByCategory.get(cat);
          if (!units) return null;
          return (
            <optgroup key={cat} label={CONVERT_CATEGORY_LABELS[cat]}>
              {units.map(([key, def]) => (
                <option key={key} value={key}>{def.label}</option>
              ))}
            </optgroup>
          );
        })}
      </LazySelect>
      <div style={{ textAlign: "center", fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", margin: "2px 0" }}>
        ↓ convert to
      </div>
      <LazySelect
        className="solenoid-node__op-select"
        value={toUnit}
        onChange={onToChange}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {toCatUnits.map(([key, def]) => (
          <option key={key} value={key}>{def.label}</option>
        ))}
      </LazySelect>
      <FormatSelect value={outFormat} onChange={onOutFormatChange} />
      <div ref={outBoxRef} style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 4 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <ValueDisplay
            value={node.cachedResult}
            render={(v) => withUnit(v, toCode, outFormat)}
            toClipboard={(v) => withUnit(v, toCode, outFormat)}
          />
        </div>
        {node.imposesDown && <DirArrow dir="down" />}
      </div>
    </NodeShell>
  );
}
