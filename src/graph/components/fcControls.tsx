// The FC's format/unit dropdowns, shared with other surfaces so the option data can't drift.
// Plain controlled selects — none of the FC node's value-mutating behavior lives here.

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  FORMAT_STYLE_LABELS, FORMAT_STYLE_GROUPS, DATE_FORMAT_STYLES, UNIT_ANNOTATIONS,
  LOGICAL_STYLE_LABELS, unitGroupLabel, type FormatStyleId, type LogicalStyle, type TextCase,
} from "../formatAnnotationStore";
import { packsStore } from "../packs";
import { activePackUnits, activePackFormats } from "../fcExtensions";
import { LazySelect } from "./LazySelect";

// The FC's three flow states, shared so the popup dropdowns speak the same language:
//   ← →  authored HERE — applies to this box, travels ahead with the value
//   → →  inherited     — the value's unit arrived from upstream (read-only / locked)
//   ← ←  dictated from ahead (Convert primacy) — FC-only, not used in the popup

export type FcDir = "back" | "fwd" | null;
export interface FcFlowState { left: FcDir; right: FcDir }

/** Authored here: set on this box, rides forward with the value (← →). */
export const FLOW_AUTHORED: FcFlowState = { left: "back", right: "fwd" };
/** Inherited from upstream: the value already carries it (→ →) — pairs with a lock. */
export const FLOW_INHERITED: FcFlowState = { left: "fwd", right: "fwd" };

/** Color inherits (currentColor) so the arrow reads muted in any container. */
export function FcArrow({ dir, title }: { dir: "back" | "fwd"; title?: string }) {
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

/** Flank a control with the flow arrows, a spacer where a side has none so a stack of
 *  these stays column-aligned. */
export function FcFlow({ flow, backTitle, fwdTitle, children }: {
  flow?: FcFlowState;
  backTitle?: string;
  fwdTitle?: string;
  children: ReactNode;
}) {
  const arrow = (dir: FcDir, side: "left" | "right") =>
    dir ? <FcArrow key={side} dir={dir} title={dir === "back" ? backTitle : fwdTitle} />
        : <span aria-hidden="true" key={side} style={{ flex: "0 0 auto", width: 9 }} />;
  // Layout lives in the consumer's `.sol-fcflow` CSS so it can differ by context.
  return (
    <span className="sol-fcflow">
      {arrow(flow?.left ?? null, "left")}
      {children}
      {arrow(flow?.right ?? null, "right")}
    </span>
  );
}

// Base unit-group order; pack groups append before "custom". Mirrors FormatControllerNode.
const BASE_UNIT_GROUP_ORDER: string[] = [
  "none", "angle", "length", "mass", "temperature",
  "time", "area", "volume", "speed", "data", "currency",
];

type FcOption = { id: string; label: string };

export interface FcFormatOptions {
  unitGroups: Map<string, FcOption[]>;
  unitGroupOrder: string[];
  packFormatGroups: Map<string, FcOption[]>;
}

/** Built-in styles/units merged with active packs', re-derived when packs toggle; shared so
 *  the FC node and the table popup can't show different menus. */
export function useFcFormatOptions(): FcFormatOptions {
  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  return useMemo(() => {
    const unitGroups = new Map<string, FcOption[]>();
    const add = (g: string, u: FcOption) => {
      if (!unitGroups.has(g)) unitGroups.set(g, []);
      unitGroups.get(g)!.push({ id: u.id, label: u.label });
    };
    for (const u of UNIT_ANNOTATIONS) add(u.group, u);
    const unitGroupOrder = [...BASE_UNIT_GROUP_ORDER];
    for (const u of activePackUnits()) {
      add(u.group, u);
      if (!unitGroupOrder.includes(u.group)) unitGroupOrder.push(u.group);
    }
    if (unitGroups.has("custom")) unitGroupOrder.push("custom");

    const packFormatGroups = new Map<string, FcOption[]>();
    for (const f of activePackFormats()) {
      const g = f.group ?? "Pack";
      if (!packFormatGroups.has(g)) packFormatGroups.set(g, []);
      packFormatGroups.get(g)!.push({ id: f.id, label: f.label });
    }
    return { unitGroups, unitGroupOrder, packFormatGroups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packsVersion]);
}

/** The <option>/<optgroup> tree for the NUMBER-format dropdown, rendered inside a caller's
 *  <select> so the FC and the popup share the exact list. */
export function numberFormatOptions(packFormatGroups: Map<string, FcOption[]>) {
  return (
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
  );
}

/** The <option>/<optgroup> tree for the UNIT dropdown, in group order. */
export function unitOptions(opts: FcFormatOptions) {
  return (
    <>
      {opts.unitGroupOrder.map((group) => {
        const items = opts.unitGroups.get(group);
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
    </>
  );
}

// ─── Standalone selects (for non-FC surfaces — the table popup) ───────────────

/** A number-format <select> matching the FC's, driven by external state. */
export function FormatStyleSelect({ value, onChange, className, title }: {
  value: FormatStyleId;
  onChange: (v: FormatStyleId) => void;
  className?: string;
  title?: string;
}) {
  const opts = useFcFormatOptions();
  return (
    <LazySelect
      className={className}
      value={value}
      title={title ?? "Number format"}
      onChange={(e) => onChange(e.target.value as FormatStyleId)}
    >
      {numberFormatOptions(opts.packFormatGroups)}
    </LazySelect>
  );
}

/** A date-format <select> matching the FC's date socket. */
export function DateStyleSelect({ value, onChange, className, title }: {
  value: FormatStyleId;
  onChange: (v: FormatStyleId) => void;
  className?: string;
  title?: string;
}) {
  return (
    <LazySelect
      className={className}
      value={value}
      title={title ?? "Date format"}
      onChange={(e) => onChange(e.target.value as FormatStyleId)}
    >
      {DATE_FORMAT_STYLES.map((s) => (
        <option key={s} value={s}>
          {s === "date_custom" ? "Custom…" : FORMAT_STYLE_LABELS[s]}
        </option>
      ))}
    </LazySelect>
  );
}

/** A logical show-as <select> matching the FC's logical socket (TRUE/FALSE · 1/0 ·
 *  Yes/No · ✓/✗). */
export function LogicalStyleSelect({ value, onChange, className, title }: {
  value: LogicalStyle | undefined;
  onChange: (v: LogicalStyle) => void;
  className?: string;
  title?: string;
}) {
  return (
    <LazySelect
      className={className}
      value={value ?? "truefalse"}
      title={title ?? "How TRUE/FALSE renders"}
      onChange={(e) => onChange(e.target.value as LogicalStyle)}
    >
      {Object.entries(LOGICAL_STYLE_LABELS).map(([id, label]) => (
        <option key={id} value={id}>{label}</option>
      ))}
    </LazySelect>
  );
}

/** A letter-case <select> matching the FC's text socket — display-only, non-destructive. */
export function TextCaseSelect({ value, onChange, className, title }: {
  value: TextCase | undefined;
  onChange: (v: TextCase) => void;
  className?: string;
  title?: string;
}) {
  return (
    <LazySelect
      className={className}
      value={value ?? "none"}
      title={title ?? "Letter case, display only"}
      onChange={(e) => onChange(e.target.value as TextCase)}
    >
      <option value="none">Aa (as-is)</option>
      <option value="upper">UPPER</option>
      <option value="lower">lower</option>
      <option value="proper">Proper</option>
    </LazySelect>
  );
}

/** A unit <select> matching the FC's; `disabled` is the LOCKED state (an inherited unit
 *  the value already carries). */
export function UnitSelect({ value, onChange, className, title, disabled }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const opts = useFcFormatOptions();
  return (
    <LazySelect
      className={className}
      value={value}
      disabled={disabled}
      title={title ?? "Unit"}
      onChange={(e) => onChange(e.target.value)}
    >
      {unitOptions(opts)}
    </LazySelect>
  );
}
