import { useMemo, useState, useSyncExternalStore } from "react";
import { frStore } from "../frStore";
import { buildFunctionReference, fnRefGroups, type FnRefRow , libraryTags, LIBRARY_TAGS, type LibraryTag } from "../functionReference";
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
import { descriptionHtml } from "../descriptionMd";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";

export function FunctionReference() {
  const open = useSyncExternalStore(frStore.subscribe, frStore.get);
  const tab = useSyncExternalStore(frStore.subscribe, frStore.tab);
  const [search, setSearch] = useState("");
  // One category value space: "All", a section groupKey, or "pack:<id>" (membership,
  // so a pack's cross-woven nodes are found too, not just the Packs menu branch).
  const [category, setCategory] = useState("All");
  const [lib, setLib] = useState<"All" | LibraryTag>("All");
  // The row whose catalog description is expanded beneath it (tap/click toggles).
  const [openDesc, setOpenDesc] = useState<string | null>(null);
  const [showExcel, setShowExcel] = useState(true);

  // Independent of pack activation (every pack is included), so stable for the session.
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
  const packFilter = category.startsWith("pack:") ? category.slice(5) : null;
  const filtered = rows.filter((r) => {
    if (packFilter !== null) { if (!r.packs.includes(packFilter)) return false; }
    else if (category !== "All" && r.groupKey !== category) return false;
    if (lib !== "All" && !libraryTags(r).includes(lib)) return false;
    if (!q) return true;
    return (r.excel ?? "").toLowerCase().includes(q)
      || r.syntax.toLowerCase().includes(q)
      || (r.nodeLabel ?? "").toLowerCase().includes(q)
      || (r.description ?? "").toLowerCase().includes(q)
      || (r.note ?? "").toLowerCase().includes(q);
  });

  // Counts cover Excel functions only — Solenoid-only rows are skipped.
  const excelRows = rows.filter((r) => r.excel !== null);
  const implemented = excelRows.filter((r) => r.implemented);
  const parityCount = implemented.filter((r) => r.parity).length;
  const composable = excelRows.filter((r) => r.composition).length;
  const supersededCount = excelRows.filter((r) => r.superseded).length;
  const oosCount = excelRows.filter((r) => r.oos).length;

  const shownGroups = packFilter !== null || category === "All"
    ? groups : groups.filter((g) => g.key === category);

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
              // Touch must not pop the on-screen keyboard over the fresh panel.
              autoFocus={!IS_COARSE}
            />
            <div className="fr-filters">
              <select
                className="fr-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                title="Narrow to one section, or to one pack's nodes"
              >
                <option value="All">All categories</option>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>{g.label}</option>
                ))}
                <optgroup label="By pack">
                  {allPacks().map((p) => (
                    <option key={p.id} value={`pack:${p.id}`}>{p.name}</option>
                  ))}
                </optgroup>
              </select>
              <select
                className="fr-select"
                value={lib}
                onChange={(e) => setLib(e.target.value as "All" | LibraryTag)}
                title="Only the rows that cite this library — the ones you'd reach for from there"
              >
                <option value="All">Any library</option>
                {LIBRARY_TAGS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
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
        </div>

        <div className="fr-stats">
          <span><span className="dot dot--yes" />{parityCount} full parity</span>
          <span><span className="dot dot--no" />{implemented.length - parityCount} partial / different</span>
          <span><span className="dot dot--no" />{composable} composable</span>
          <span><span className="dot dot--sup" />{supersededCount} superseded</span>
          <span><span className="dot dot--oos" />{oosCount} out of scope</span>
          <span style={{ marginLeft: "auto" }}>{filtered.length} shown</span>
        </div>

        <div className="fr-scroll">
          {filtered.length === 0 ? (
            <div className="fr-empty">{search ? `No functions match "${search}"` : "No functions match the filters"}</div>
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
                    ...gr.flatMap((r, i) => {
                      const isSolOnly = r.excel === null;
                      const rowKey = `${g.key}-${i}`;
                      const expandable = !!r.description;
                      const rows = [
                        <tr
                          key={rowKey}
                          // Tap/click toggles the catalog description under the
                          // row — the table stays dense; touch reaches it too.
                          className={expandable ? "fr-row--expandable" : undefined}
                          onClick={expandable ? () => setOpenDesc(openDesc === rowKey ? null : rowKey) : undefined}
                        >
                          <td className={`fr-td-sol${r.implemented ? "" : " fr-td-sol--missing"}`}>
                            {!r.implemented ? "—" : r.catalogType && r.nodeLabel ? (
                              <button
                                className="fr-sol-btn"
                                title="Add this node to the canvas"
                                onClick={(e) => { e.stopPropagation(); void addNodeByCatalogType(r.catalogType!); frStore.close(); }}
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
                        </tr>,
                      ];
                      if (expandable && openDesc === rowKey) {
                        rows.push(
                          <tr key={`${rowKey}-d`} className="fr-desc-row">
                            <td colSpan={showExcel ? 7 : 5} dangerouslySetInnerHTML={{ __html: descriptionHtml(r.description ?? "") }} />
                          </tr>,
                        );
                      }
                      return rows;
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
