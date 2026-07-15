// ─── Reusable Format-Controller controls ─────────────────────────────────────
// The FC node's number-format and unit dropdowns, factored out so OTHER surfaces
// (the table popup's per-column format row) render the exact same menus over the
// exact same option data — one source of truth for "what formats/units exist",
// including the ones active packs contribute. The FC node component consumes the
// same `useFcFormatOptions()` hook, so the two can't drift.
//
// These are plain controlled <select>s (LazySelect) — no docking / forwarding /
// propagation, none of the FC node's value-mutating behaviour. A caller drives
// them from its own state and decides what a change means (the FC mutates the
// value; the popup re-renders display-only).

import { useMemo, useSyncExternalStore } from "react";
import {
  FORMAT_STYLE_LABELS, FORMAT_STYLE_GROUPS, DATE_FORMAT_STYLES, UNIT_ANNOTATIONS,
  unitGroupLabel, type FormatStyleId,
} from "../formatAnnotationStore";
import { packsStore } from "../packs";
import { activePackUnits, activePackFormats } from "../fcExtensions";
import { LazySelect } from "./LazySelect";

// Base unit-group display order — active packs' groups are appended (before
// "custom") at render time. Kept in sync with FormatControllerNode's copy.
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

/**
 * The option data for the FC format + unit dropdowns — built-in styles/units
 * merged with the ones active packs contribute. Re-derives when packs toggle.
 * Shared by FormatControllerComponent and the table popup so their menus stay
 * identical.
 */
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

/** The <option>/<optgroup> tree for the NUMBER-format dropdown (General / Number /
 *  Percent / Custom + active-pack format groups). Rendered inside a caller's
 *  <select> so both the FC and the popup share the exact list. */
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

/** A unit <select> matching the FC's, driven by external state. */
export function UnitSelect({ value, onChange, className, title }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  title?: string;
}) {
  const opts = useFcFormatOptions();
  return (
    <LazySelect
      className={className}
      value={value}
      title={title ?? "Unit"}
      onChange={(e) => onChange(e.target.value)}
    >
      {unitOptions(opts)}
    </LazySelect>
  );
}
