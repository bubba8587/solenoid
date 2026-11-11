// [[C44]] dateSerials, [[frame-verbs#pivot]]
import { useLayoutEffect, useMemo, useState } from "react";
import { serialToJsDate } from "../nodes/dateSerial";
import { SearchField } from "./SearchField";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import "./PivotFilterList.css";

/** One line of the list: a value, or a date field's year or month over the values under it. */
interface Row {
  id: string;
  label: string;
  keys: string[];
  depth: number;
  group: boolean;
}

const ROW_PX = 22;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Numbers and dates by value, text by character code ([[C59]] byteStringOrder), the blank last: as the core lists them. */
function ordered(keys: readonly string[], numeric: boolean): string[] {
  const blank = keys.filter((k) => k === "");
  const rest = keys.filter((k) => k !== "");
  if (numeric) {
    const nums = rest.filter((k) => Number.isFinite(Number(k))).sort((a, b) => Number(a) - Number(b));
    const other = rest.filter((k) => !Number.isFinite(Number(k))).sort(byCode);
    return [...nums, ...other, ...blank];
  }
  return [...rest.sort(byCode), ...blank];
}

/** A date field's values as year › month › day, the years and months folded until opened. */
function dateTree(keys: readonly string[], label: (k: string) => string, open: ReadonlySet<string>): Row[] {
  const years = new Map<number, Map<number, string[]>>();
  const loose: string[] = [];
  for (const k of keys) {
    const n = Number(k);
    if (k === "" || !Number.isFinite(n)) { loose.push(k); continue; }
    const d = serialToJsDate(n);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const months = years.get(y) ?? new Map<number, string[]>();
    years.set(y, months);
    const days = months.get(m) ?? [];
    months.set(m, days);
    days.push(k);
  }
  const rows: Row[] = [];
  for (const [y, months] of years) {
    const yid = `y${y}`;
    rows.push({ id: yid, label: String(y), keys: [...months.values()].flat(), depth: 0, group: true });
    if (!open.has(yid)) continue;
    for (const [m, days] of months) {
      const mid = `${yid}m${m}`;
      rows.push({ id: mid, label: MONTHS[m], keys: days, depth: 1, group: true });
      if (!open.has(mid)) continue;
      for (const k of days) rows.push({ id: `k${k}`, label: label(k), keys: [k], depth: 2, group: false });
    }
  }
  for (const k of loose) rows.push({ id: `k${k}`, label: label(k), keys: [k], depth: 0, group: false });
  return rows;
}

/**
 * A pivot field's value checklist: a search, All and None over what the search matches, Only on each line, a date
 * field as a year › month › day tree, and only the lines in view drawn, so a field of thousands of values stays quick.
 */
export function PivotFilterList({ type, keys, total, hidden, label, onChange }: {
  type: string;
  keys: readonly string[];
  /** How many distinct values the field has; more than `keys` where the list is capped. */
  total: number;
  hidden: readonly string[];
  label: (key: string) => string;
  onChange: (hidden: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [top, setTop] = useState(0);
  // The list's own height, which its bottom edge drags: how many lines to draw follows it.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [viewPx, setViewPx] = useState(12 * ROW_PX);
  useLayoutEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(() => setViewPx(box.clientHeight));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const sorted = useMemo(() => ordered(keys, type === "number" || type === "date"), [keys, type]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? sorted.filter((k) => label(k).toLowerCase().includes(q)) : sorted), [sorted, q, label]);
  const rows: Row[] = useMemo(() => {
    if (type === "date" && !q) return dateTree(sorted, label, open);
    return matches.map((k) => ({ id: `k${k}`, label: label(k), keys: [k], depth: 0, group: false }));
  }, [type, q, sorted, matches, label, open]);

  const shownOf = (ks: readonly string[]) => ks.reduce((n, k) => n + (hiddenSet.has(k) ? 0 : 1), 0);
  const setShown = (ks: readonly string[], show: boolean) => {
    const next = new Set(hiddenSet);
    for (const k of ks) { if (show) next.delete(k); else next.add(k); }
    onChange([...next]);
  };
  // Only: every listed value hidden but these; values past the list's cap keep their state.
  const only = (ks: readonly string[]) => {
    const keep = new Set(ks);
    const next = new Set(hiddenSet);
    for (const k of sorted) { if (keep.has(k)) next.delete(k); else next.add(k); }
    onChange([...next]);
  };
  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const first = Math.max(0, Math.floor(top / ROW_PX) - 4);
  const last = Math.min(rows.length, first + Math.ceil(viewPx / ROW_PX) + 8);
  const capped = total > keys.length;
  const hiddenCount = hidden.length;

  return (
    <div className="pivot-filter__list" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pivot-filter__actions">
        {keys.length > 8 && (
          <SearchField className="pivot-filter__search" value={query} onChange={(v) => { setQuery(v); setTop(0); }} placeholder="Search" label="Search values"
            count={q ? `${matches.length} of ${keys.length}` : undefined} />
        )}
        <button onClick={() => setShown(matches, true)}>All</button>
        <button onClick={() => setShown(matches, false)}>None</button>
      </div>
      <div ref={setBox} className="pivot-filter__scroll" style={{ height: Math.min(Math.max(rows.length, 1), 12) * ROW_PX }}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
        <div style={{ height: rows.length * ROW_PX, position: "relative" }}>
          {rows.slice(first, last).map((r, i) => {
            const n = shownOf(r.keys);
            const all = n === r.keys.length;
            return (
              <div key={r.id} className={`pivot-filter__opt${r.group ? " pivot-filter__opt--group" : ""}`}
                style={{ top: (first + i) * ROW_PX, paddingLeft: r.depth * 14 + (r.group || type !== "date" || q ? 0 : 14) }}>
                {r.group && (
                  <button className="pivot-filter__fold" onClick={() => toggleOpen(r.id)} aria-label={open.has(r.id) ? "Fold" : "Unfold"}>
                    {open.has(r.id) ? <ChevronDownIcon size={10} strokeWidth={2} /> : <ChevronRightIcon size={10} strokeWidth={2} />}
                  </button>
                )}
                <label>
                  <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = n > 0 && !all; }}
                    onChange={() => setShown(r.keys, !all)} />
                  <span>{r.label}</span>
                </label>
                <button className="pivot-filter__only" onClick={() => only(r.keys)}>Only</button>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && <div className="pivot-filter__empty">No match</div>}
      </div>
      {(capped || hiddenCount > 0) && (
        <div className="pivot-filter__note">
          {hiddenCount > 0 && `${hiddenCount.toLocaleString()} hidden`}
          {capped && hiddenCount > 0 && " · "}
          {capped && `first ${keys.length.toLocaleString()} of ${total.toLocaleString()} values`}
        </div>
      )}
    </div>
  );
}
