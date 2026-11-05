// [[C51]] formulaNaming
import { useMemo, useState } from "react";
import { frStore } from "../frStore";
import { buildFunctionReference, fnRefGroups, type FnRefRow, libraryTags, LIBRARY_TAGS, type LibraryTag } from "../functionReference";
import { IS_COARSE } from "../coarse";
import { allPacks } from "../packs";
import { descriptionHtml } from "../descriptionMd";
import { TriangleAlertIcon } from "./Icons";

/** Excel's function list against Solenoid: what each maps to, how close, and what was left out on purpose. */
export function ExcelCoverage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [lib, setLib] = useState<"All" | LibraryTag>("All");
  const [openDesc, setOpenDesc] = useState<string | null>(null);

  const rows = useMemo(() => buildFunctionReference().filter((r) => r.excel !== null), []);
  const groups = useMemo(() => fnRefGroups(rows), [rows]);
  const packName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allPacks()) m.set(p.id, p.name);
    return m;
  }, []);

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

  const excelRows = rows;
  const implemented = excelRows.filter((r) => r.implemented);
  const parityCount = implemented.filter((r) => r.parity).length;
  const supersededCount = excelRows.filter((r) => r.superseded).length;
  const oosCount = excelRows.filter((r) => r.oos).length;

  const shownGroups = packFilter !== null || category === "All"
    ? groups : groups.filter((g) => g.key === category);

  const packsCell = (r: FnRefRow) =>
    r.packs.length ? r.packs.map((p) => packName.get(p) ?? p).join(", ") : "";

  return (
      <>
        <div className="fr-header">
          <div className="fr-header-row1">
            <input
              className="fr-search"
              placeholder="Search Excel functions…"
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
                title="Only the rows that cite this library"
              >
                <option value="All">Any library</option>
                {LIBRARY_TAGS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="fr-stats">
          <span><span className="dot dot--yes" />{parityCount} full parity</span>
          <span><span className="dot dot--no" />{implemented.length - parityCount} partial / different</span>
          <span><span className="dot dot--sup" />{supersededCount} superseded</span>
          <span><span className="dot dot--oos" />{oosCount} out of scope</span>
          <span style={{ marginLeft: "auto" }}>{filtered.length} shown</span>
        </div>

        <div className="fr-scroll">
          {filtered.length === 0 ? (
            <div className="fr-empty">{search ? `No functions match "${search}"` : "No functions match the filters"}</div>
          ) : (
            <table className="fr-table fr-table--excel">
              <colgroup>
                <col className="col-sol" />
                <col className="col-excel" />
                <col className="col-syntax" />
                <col className="col-packs" />
                <col className="col-dep" />
                <col className="col-parity" />
                <col className="col-note" />
              </colgroup>
              <thead>
                <tr>
                  <th>Solenoid Card</th>
                  <th>Excel Function</th>
                  <th>Excel Syntax</th>
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
                      <td colSpan={7}>{g.label}</td>
                    </tr>,
                    ...gr.flatMap((r, i) => {
                      const rowKey = `${g.key}-${i}`;
                      const expandable = !!r.description;
                      const rows = [
                        <tr
                          key={rowKey}
                          className={expandable ? "fr-row--expandable" : undefined}
                          onClick={expandable ? () => setOpenDesc(openDesc === rowKey ? null : rowKey) : undefined}
                        >
                          <td className={`fr-td-sol${r.implemented ? "" : " fr-td-sol--missing"}`}>
                            {r.implemented && r.catalogType && r.nodeLabel ? (
                              <button
                                className="fr-sol-btn"
                                title="Open this card in the Reference"
                                onClick={(e) => { e.stopPropagation(); frStore.openCard(r.catalogType!); }}
                              >
                                {r.nodeLabel}
                              </button>
                            ) : "—"}
                          </td>
                          <td className="fr-td-excel">{r.excel}</td>
                          <td className="fr-td-syntax">{r.syntax}</td>
                          <td className="fr-td-packs">{packsCell(r)}</td>
                          <td className="fr-td-dep">{r.dependency ? "✓" : ""}</td>
                          <td className="fr-td-parity">
                            {!r.implemented
                              ? <span className="fr-parity-miss">—</span>
                              : r.parity
                                ? <span className="fr-parity-yes">✓</span>
                                : <span className="fr-parity-warn"><TriangleAlertIcon size={13} /></span>}
                          </td>
                          <td className="fr-td-note">{r.note ?? ""}</td>
                        </tr>,
                      ];
                      if (expandable && openDesc === rowKey) {
                        rows.push(
                          <tr key={`${rowKey}-d`} className="fr-desc-row">
                            <td colSpan={7} dangerouslySetInnerHTML={{ __html: descriptionHtml(r.description ?? "") }} />
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
  );
}
