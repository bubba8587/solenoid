import { useMemo, useState, useSyncExternalStore } from "react";
import { frStore } from "../frStore";
import { buildFunctionReference, fnRefGroups, type FnRefRow } from "../functionReference";
import { addNodeByCatalogType } from "../catalogUtils";
import { IS_COARSE } from "../coarse";
import { allPacks } from "../packs";
import { Markdown } from "./Markdown";
import { SocketLegendRows, DimensionalityFlow } from "./SocketLegend";
import helpMd from "../help/help.md?raw";
import notesMd from "../help/notes.md?raw";
import dataTypesMd from "../help/data-types.md?raw";
import dataModelMd from "../help/data-model.md?raw";
import "./FunctionReference.css";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";

export function FunctionReference() {
  const open = useSyncExternalStore(frStore.subscribe, frStore.get);
  const tab = useSyncExternalStore(frStore.subscribe, frStore.tab);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string | "All">("All");
  // "To-do only" and "Out of scope" are opposite slices of the unimplemented
  // rows, so they're one exclusive mode rather than two booleans.
  const [filterMode, setFilterMode] = useState<"all" | "todo" | "oos">("all");
  const [showExcel, setShowExcel] = useState(true);

  // Generated from catalog/node metadata. Independent of pack activation
  // (buildCatalog(false) includes every pack), so it's stable for the session.
  const rows = useMemo(() => buildFunctionReference(), []);
  const groups = useMemo(() => fnRefGroups(rows), [rows]);
  const packName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allPacks()) m.set(p.id, p.name);
    return m;
  }, []);

  useEscapeToClose(() => frStore.close(), open);

  if (!open) return null;

  const q = search.toLowerCase();
  const filtered = rows.filter((r) => {
    if (group !== "All" && r.groupKey !== group) return false;
    if (filterMode === "todo" && (r.implemented || r.oos || r.composition)) return false;
    if (filterMode === "oos" && !r.oos) return false;
    if (!q) return true;
    return (r.excel ?? "").toLowerCase().includes(q)
      || r.syntax.toLowerCase().includes(q)
      || (r.nodeLabel ?? "").toLowerCase().includes(q)
      || (r.description ?? "").toLowerCase().includes(q)
      || (r.note ?? "").toLowerCase().includes(q);
  });

  // Summary counts over Excel functions only (skip Solenoid-only rows).
  const excelRows = rows.filter((r) => r.excel !== null);
  const implemented = excelRows.filter((r) => r.implemented);
  const parityCount = implemented.filter((r) => r.parity).length;
  const composable = excelRows.filter((r) => r.composition).length;
  const unimplemented = excelRows.filter((r) => !r.implemented && !r.composition);
  const oosCount = unimplemented.filter((r) => r.oos).length;
  const plannedCount = unimplemented.length - oosCount;

  const shownGroups = group === "All" ? groups : groups.filter((g) => g.key === group);

  const packsCell = (r: FnRefRow) =>
    r.packs.length ? r.packs.map((p) => packName.get(p) ?? p).join(", ") : "";

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "reference", label: "Function Reference" },
    { key: "sockets", label: "Socket Types" },
    { key: "help", label: "Help" },
    { key: "notes", label: "Notes" },
  ];

  return (
    <div className="fr-backdrop" onPointerDown={() => frStore.close()}>
      <div className="fr-panel" onPointerDown={(e) => e.stopPropagation()}>

        <div className="fr-tabs">
          <div className="fr-tabs__scroll">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`fr-tab${tab === t.key ? " fr-tab--active" : ""}`}
                onClick={() => frStore.setTab(t.key)}
              >{t.label}</button>
            ))}
          </div>
          <button className="fr-close" onClick={() => frStore.close()} title="Close (Esc)" aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        {tab === "sockets" ? (
          <div className="fr-doc-scroll">
            <div className="fr-sockets">
              <SocketLegendRows />
              <Markdown md={dataTypesMd} />
              <DimensionalityFlow />
              <Markdown md={dataModelMd} />
            </div>
          </div>
        ) : tab !== "reference" ? (
          <div className="fr-doc-scroll">
            <Markdown md={tab === "help" ? helpMd : notesMd} />
          </div>
        ) : (
        <>
        <div className="fr-header">
          <div className="fr-header-row1">
            <input
              className="fr-search"
              placeholder="Search functions, syntax, nodes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // Touch: don't pop the on-screen keyboard over the freshly
              // opened panel — the user taps the field when they want it.
              autoFocus={!IS_COARSE}
            />
            <div className="fr-filters">
              <button
                className={`fr-filter-pill${filterMode === "todo" ? " fr-filter-pill--active" : ""}`}
                onClick={() => setFilterMode((m) => (m === "todo" ? "all" : "todo"))}
                title="Show only planned functions, excluding out-of-scope ones like cell refs, OLAP, and superseded classics"
              >To-do only</button>
              <button
                className={`fr-filter-pill${filterMode === "oos" ? " fr-filter-pill--active" : ""}`}
                onClick={() => setFilterMode((m) => (m === "oos" ? "all" : "oos"))}
                title="Show only functions not planned for Solenoid: cell refs, OLAP, and superseded classics"
              >Out of scope</button>
            </div>
            <label className="fr-colcheck" title="Show or hide the Excel Function and Excel Syntax columns">
              <input
                type="checkbox"
                checked={showExcel}
                onChange={(e) => setShowExcel(e.target.checked)}
              />
              Excel columns
            </label>
          </div>
          <div className="fr-cats">
            <button
              className={`fr-cat${group === "All" ? " fr-cat--active" : ""}`}
              onClick={() => setGroup("All")}
            >All</button>
            {groups.map((g) => (
              <button
                key={g.key}
                className={`fr-cat${group === g.key ? " fr-cat--active" : ""}`}
                onClick={() => setGroup(g.key)}
              >{g.label}</button>
            ))}
          </div>
        </div>

        <div className="fr-stats">
          <span><span className="dot dot--yes" />{parityCount} full parity</span>
          <span><span className="dot dot--no" />{implemented.length - parityCount} partial / different</span>
          <span><span className="dot dot--no" />{composable} composable</span>
          <span><span className="dot dot--miss" />{plannedCount} planned (to-do)</span>
          <span><span className="dot dot--oos" />{oosCount} out of scope</span>
          <span style={{ marginLeft: "auto" }}>{filtered.length} shown</span>
        </div>

        <div className="fr-scroll">
          {filtered.length === 0 ? (
            <div className="fr-empty">No functions match "{search}"</div>
          ) : (
            <table className={`fr-table${showExcel ? " fr-table--excel" : ""}`}>
              <colgroup>
                <col className="col-sol" />
                {showExcel && <col className="col-excel" />}
                {showExcel && <col className="col-syntax" />}
                <col className="col-packs" />
                <col className="col-dep" />
                <col className="col-parity" />
                <col className="col-note" />
              </colgroup>
              <thead>
                <tr>
                  <th>Solenoid Node</th>
                  {showExcel && <th>Excel Function</th>}
                  {showExcel && <th>Excel Syntax</th>}
                  <th>Pack</th>
                  <th className="col-dep" title="A pack of this node is depended on by another pack">Dep</th>
                  <th className="col-parity">✓</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {shownGroups.map((g) => {
                  const gr = filtered.filter((r) => r.groupKey === g.key);
                  if (gr.length === 0) return null;
                  return [
                    <tr key={`gh-${g.key}`} className="fr-group-row">
                      <td colSpan={showExcel ? 7 : 5}>{g.label}</td>
                    </tr>,
                    ...gr.map((r, i) => {
                      const isSolOnly = r.excel === null;
                      return (
                        <tr key={`${g.key}-${i}`}>
                          <td className={`fr-td-sol${r.implemented ? "" : " fr-td-sol--missing"}`}>
                            {!r.implemented ? "—" : r.catalogType && r.nodeLabel ? (
                              <button
                                className="fr-sol-btn"
                                title="Add this node to the canvas"
                                onClick={() => { void addNodeByCatalogType(r.catalogType!); frStore.close(); }}
                              >
                                {r.nodeLabel}
                                <span className="fr-sol-btn__add">+</span>
                              </button>
                            ) : (
                              <span className="fr-sol-composition">{r.nodeLabel}</span>
                            )}
                          </td>
                          {showExcel && (
                            <td className={`fr-td-excel${isSolOnly ? " fr-td-excel--missing" : ""}`}>
                              {r.excel ?? <span className="fr-td-excel--sol-only">Solenoid-only</span>}
                            </td>
                          )}
                          {showExcel && <td className="fr-td-syntax">{r.syntax}</td>}
                          <td className="fr-td-packs">{packsCell(r)}</td>
                          <td className="fr-td-dep">{r.dependency ? "✓" : ""}</td>
                          <td className="fr-td-parity">
                            {isSolOnly
                              ? <span className="fr-parity-miss">—</span>
                              : r.composition
                                ? <span className="fr-parity-warn" title="Achievable by composing nodes">✎</span>
                                : !r.implemented
                                  ? <span className="fr-parity-miss">—</span>
                                  : r.parity
                                    ? <span className="fr-parity-yes">✓</span>
                                    : <span className="fr-parity-warn">⚠</span>}
                          </td>
                          <td className="fr-td-note">{r.note ?? ""}</td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
