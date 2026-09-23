// [[C94]] formatFamilyGates, [[D41]] formatFlowsDownstream, [[C25]] firstClassUnits, [[C79]] packActivationIsPresentation

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  FORMAT_STYLE_LABELS, FORMAT_STYLE_GROUPS, DATE_FORMAT_STYLES, UNIT_ANNOTATIONS,
  LOGICAL_STYLE_LABELS, TEXT_CASE_LABELS, unitGroupLabel, type FormatStyleId, type LogicalStyle, type TextCase,
} from "../formatAnnotationStore";
import { packsStore } from "../packs";
import { activePackUnits, activePackFormats } from "../fcExtensions";
import { LazySelect } from "./LazySelect";

// The FC's flow states (authored ← →, inherited → →, dictated ← ←): tree/specs/values/format-model.md.

export type FcDir = "back" | "fwd" | null;
export interface FcFlowState { left: FcDir; right: FcDir }

export const FLOW_AUTHORED: FcFlowState = { left: "back", right: "fwd" };
export const FLOW_INHERITED: FcFlowState = { left: "fwd", right: "fwd" };

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

/** A spacer stands in for a missing side, so a stack of these stays column-aligned. */
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

// Pack groups append before "custom"; mirrors FormatControllerNode.
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
  }, [packsVersion]);
}

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


/** A caller passing `inherit` handles `""` in `onChange` by dropping its pick; an element, not a component, because LazySelect's collapsed render walks for `type === "option"`. */
function inheritOption(show?: boolean) {
  return show ? <option value="" title="Inherit the upstream format">—</option> : null;
}

export function FormatStyleSelect({ value, onChange, className, title, inherit }: {
  value: FormatStyleId | "";
  onChange: (v: FormatStyleId | "") => void;
  className?: string;
  title?: string;
  inherit?: boolean;
}) {
  const opts = useFcFormatOptions();
  return (
    <LazySelect
      className={className}
      value={value}
      title={title ?? "Number format"}
      onChange={(e) => onChange(e.target.value)}
    >
      {inheritOption(inherit)}
      {numberFormatOptions(opts.packFormatGroups)}
    </LazySelect>
  );
}

export function DateStyleSelect({ value, onChange, className, title, inherit }: {
  value: FormatStyleId | "";
  onChange: (v: FormatStyleId | "") => void;
  className?: string;
  title?: string;
  inherit?: boolean;
}) {
  return (
    <LazySelect
      className={className}
      value={value}
      title={title ?? "Date format"}
      onChange={(e) => onChange(e.target.value)}
    >
      {inheritOption(inherit)}
      {DATE_FORMAT_STYLES.map((s) => (
        <option key={s} value={s}>
          {s === "date_custom" ? "Custom…" : FORMAT_STYLE_LABELS[s]}
        </option>
      ))}
    </LazySelect>
  );
}

export function LogicalStyleSelect({ value, onChange, className, title, inherit }: {
  value: string | undefined;
  onChange: (v: LogicalStyle | "") => void;
  className?: string;
  title?: string;
  inherit?: boolean;
}) {
  return (
    <LazySelect
      className={className}
      value={value ?? "truefalse"}
      title={title ?? "How TRUE/FALSE renders"}
      onChange={(e) => onChange(e.target.value as LogicalStyle | "")}
    >
      {inheritOption(inherit)}
      {Object.entries(LOGICAL_STYLE_LABELS).map(([id, label]) => (
        <option key={id} value={id}>{label}</option>
      ))}
    </LazySelect>
  );
}

export function TextCaseSelect({ value, onChange, className, title, inherit }: {
  value: string | undefined;
  onChange: (v: TextCase | "" | "chip") => void;
  className?: string;
  title?: string;
  inherit?: boolean;
}) {
  return (
    <LazySelect
      className={className}
      value={value ?? "none"}
      title={title ?? "Letter case / chip, display only"}
      onChange={(e) => onChange(e.target.value as TextCase | "" | "chip")}
    >
      {inheritOption(inherit)}
      {Object.entries(TEXT_CASE_LABELS).map(([id, label]) => (
        <option key={id} value={id}>{label}</option>
      ))}
      <option value="chip" title="Render as a categorical color chip">Chip</option>
    </LazySelect>
  );
}

/** `disabled` is the locked state ([[C25]] firstClassUnits). */
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
