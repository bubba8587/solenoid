import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { elementPicker } from "../elementPickerStore";
import { ELEMENTS, elementCell, searchElements, type ElementMeta } from "../rete-nodes";
import "./popupChrome.css";
import "./ElementPicker.css";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";

/**
 * The Element node's picker: a search field over symbol / name / atomic number
 * plus the periodic table itself, symbols only, laid out on the standard
 * 18-column grid (f-block detached below). Typing narrows the table — matches
 * stay live, the rest dim — and Enter takes the best match. Mirrors
 * TablePopup / ChartPopup: module store, mounted once in App.
 */
export function ElementPicker() {
  const state = useSyncExternalStore(elementPicker.subscribe, elementPicker.get);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeToClose(() => elementPicker.close(), !!state, { capture: true });

  useEffect(() => {
    if (!state) return;
    setQuery("");
    inputRef.current?.focus();
  }, [state]);

  if (!state) return null;

  const matches = searchElements(query);
  const matchSet = new Set(matches.map((e) => e.symbol));
  const best = query.trim() ? matches[0] : undefined;

  const pick = (sym: string) => {
    state.onPick(sym);
    elementPicker.close();
  };

  const cellClass = (e: ElementMeta) => {
    let cls = "el-picker__cell";
    if (e.symbol === state.symbol) cls += " el-picker__cell--current";
    if (query.trim() && !matchSet.has(e.symbol)) cls += " el-picker__cell--dim";
    if (best && e.symbol === best.symbol) cls += " el-picker__cell--best";
    return cls;
  };

  return (
    <div className="sol-popup-overlay" onPointerDown={() => elementPicker.close()}>
      <div className="sol-popup el-picker" onPointerDown={(e) => e.stopPropagation()}>
        <div className="sol-popup__header">
          <div className="sol-popup__title">Element</div>
          <button className="sol-popup__close" onClick={() => elementPicker.close()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>
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
          <div className="el-picker__table" role="listbox" aria-label="Periodic table">
            {ELEMENTS.map((e) => {
              const { row, col } = elementCell(e.n);
              return (
                <button
                  key={e.symbol}
                  type="button"
                  className={cellClass(e)}
                  style={{ gridRow: row, gridColumn: col }}
                  title={`${e.n} · ${e.name} — ${e.mass} g/mol`}
                  onClick={() => pick(e.symbol)}
                >
                  {e.symbol}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
