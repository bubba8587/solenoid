import { Fragment, useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { elementPicker } from "../elementPickerStore";
import { elementCell, searchElements } from "../nodeClasses";
import { ELEMENTS, ELEMENT_BY_SYMBOL, ELEMENT_CATEGORIES, type ElementMeta } from "../nodes/chemistryOps";
import { useSeriesColors } from "./chartCore";
import { PopupShell } from "./PopupShell";
import "./ElementPicker.css";

/** The Element node's periodic-table picker; module store, mounted once in App. */
export function ElementPicker() {
  const state = useSyncExternalStore(elementPicker.subscribe, elementPicker.get);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const palette = useSeriesColors();
  const hueOf = (category: string) => {
    const i = ELEMENT_CATEGORIES.indexOf(category as (typeof ELEMENT_CATEGORIES)[number]);
    return i < 0 ? "var(--border-strong)" : palette[i % palette.length];
  };
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset only when the popup opens: a pick updates the state and must keep the search and the hover.
  const open = state !== null;
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHovered(null);
    inputRef.current?.focus();
  }, [open]);

  if (!state) return null;

  const matches = searchElements(query);
  const matchSet = new Set(matches.map((e) => e.symbol));
  const best = query.trim() ? matches[0] : undefined;
  const shown = ELEMENT_BY_SYMBOL.get(hovered ?? best?.symbol ?? state.symbol);

  // A pick sets the card and stays open, the new element marked current; the close button or Escape closes.
  const pick = (sym: string) => {
    state.onPick(sym);
    elementPicker.open({ ...state, symbol: sym });
  };

  const cellClass = (e: ElementMeta) => {
    let cls = "el-picker__cell";
    if (e.symbol === state.symbol) cls += " el-picker__cell--current";
    if (query.trim() && !matchSet.has(e.symbol)) cls += " el-picker__cell--dim";
    if (best && e.symbol === best.symbol) cls += " el-picker__cell--best";
    return cls;
  };

  return (
    <PopupShell title="Element" onClose={() => elementPicker.close()} cardClassName="el-picker">
      <div className="el-picker__body">
        <input
          ref={inputRef}
          className="el-picker__search"
          value={query}
          placeholder="Fe, iron, 26…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && best) { e.preventDefault(); pick(best.symbol); }
          }}
        />
        <div className="el-picker__table" role="listbox" aria-label="Periodic table" onMouseLeave={() => setHovered(null)}>
          {shown && <ElementDetail e={shown} hue={hueOf(shown.category)} />}
          {ELEMENTS.map((e) => {
            const { row, col } = elementCell(e.n);
            return (
              <button
                key={e.symbol}
                type="button"
                className={cellClass(e)}
                style={{ gridRow: row, gridColumn: col, "--el-hue": hueOf(e.category) } as React.CSSProperties}
                aria-label={`${e.n} ${e.name}`}
                onMouseEnter={() => setHovered(e.symbol)}
                onFocus={() => setHovered(e.symbol)}
                onClick={() => pick(e.symbol)}
              >
                <span className="el-picker__cell-z">{e.n}</span>
                <span className="el-picker__cell-symbol">{e.symbol}</span>
              </button>
            );
          })}
          {/* Where the f-block's two rows belong in the main body. */}
          <span className="el-picker__gap" style={{ gridRow: 6, gridColumn: 3 }}>57–71</span>
          <span className="el-picker__gap" style={{ gridRow: 7, gridColumn: 3 }}>89–103</span>
        </div>
        <ul className="el-picker__legend">
          {ELEMENT_CATEGORIES.map((c) => (
            <li key={c} style={{ "--el-hue": hueOf(c) } as React.CSSProperties}>{c}</li>
          ))}
        </ul>
      </div>
    </PopupShell>
  );
}

const num = (v: number | null, unit = "") => (v === null ? "–" : `${v}${unit}`);

/** The hovered element (or the current pick) in the table's empty top-middle, where a printed table puts its key:
 *  its tile, then every property the card's Elements frame carries. */
function ElementDetail({ e, hue }: { e: ElementMeta; hue: string }) {
  const facts: [string, string][] = [
    ["Config.", e.config],
    ["State", e.state],
    ["Group / period", `${e.group ?? "–"} / ${e.period}`],
    ["Block", e.block],
    ["Electroneg.", num(e.electronegativity)],
    ["Radius", num(e.radius, " pm")],
    ["Discovered", e.discovered === null ? "Ancient" : String(e.discovered)],
    ["Ionization", num(e.ionization, " kJ/mol")],
    ["Affinity", num(e.affinity, " kJ/mol")],
    ["Oxidation", e.oxidation || "–"],
    ["Melts", num(e.melting, " K")],
    ["Boils", num(e.boiling, " K")],
    ["Density", num(e.density, " g/cm³")],
  ];
  const half = Math.ceil(facts.length / 2);

  return (
    <div className="el-picker__detail" style={{ gridRow: "1 / 4", gridColumn: "3 / 13", "--el-hue": hue } as React.CSSProperties}>
      <div className="el-picker__detail-tile">
        <span className="el-picker__detail-z">{e.n}</span>
        <span className="el-picker__detail-symbol">{e.symbol}</span>
        <span className="el-picker__detail-name">{e.name}<span className="el-picker__detail-category">{e.category}</span></span>
        <span className="el-picker__detail-mass">{Number(e.mass.toFixed(3))}</span>
      </div>
      {[facts.slice(0, half), facts.slice(half)].map((col, i) => (
        <dl key={i} className="el-picker__detail-facts">
          {col.map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd title={v}>{v}</dd></Fragment>))}
        </dl>
      ))}
    </div>
  );
}
