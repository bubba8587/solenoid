// [[C51]] formulaNaming
import { useMemo, useState, useSyncExternalStore } from "react";
import { frStore } from "../frStore";
import { buildFunctionReference, type FnRefRow } from "../functionReference";
import { EXCEL_SECTIONS, excelSection } from "../excelSections";
import { buildCatalog } from "../catalogUtils";
import { flattenLeaves } from "../catalogSearch";
import { IS_COARSE } from "../coarse";
import { appThemeStore } from "../appTheme";
import type { NodeCatalogEntry } from "../AddNodeMenu";
import { accentVars, cardAccent } from "./CardReference";

/** A heavy square-cut arrow, as the Frame mark is drawn: butt ends, mitred point. */
function ChunkyArrow() {
  return (
    <svg className="fr-xl__arrow" viewBox="0 0 20 14" width="24" height="17" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="butt" strokeLinejoin="miter">
      <path d="M1 7 H16 M10.5 1.5 L16.2 7 L10.5 12.5" />
    </svg>
  );
}

/** One Excel function: the cards that answer it, or the newer function that replaced it, or why it has no card. */
interface XlEntry { name: string; cards: NodeCatalogEntry[]; use?: { text: string; card?: NodeCatalogEntry } }

/** For someone coming from Excel: its functions under its own sections, A to Z, each opening the card that does it. */
export function ExcelCoverage() {
  const [search, setSearch] = useState("");
  const mode = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.getMode);
  const data = useMemo(() => {
    const leaf = new Map(flattenLeaves(buildCatalog(false)).map(({ leaf: l }) => [l.type, l] as const));
    const rows = buildFunctionReference().filter((r): r is FnRefRow & { excel: string } => r.excel !== null);
    const byName = new Map<string, XlEntry>();
    for (const r of rows) {
      const e = byName.get(r.excel) ?? { name: r.excel, cards: [] };
      const card = r.catalogType ? leaf.get(r.catalogType) : undefined;
      if (card && !e.cards.includes(card)) e.cards.push(card);
      byName.set(r.excel, e);
    }
    // A replaced function points at its replacement, by the card that answers it when the note names one.
    for (const r of rows) {
      const e = byName.get(r.excel)!;
      if (e.cards.length || !r.note) continue;
      if (r.superseded) {
        const text = /^[^.;]*/.exec(r.note)![0].replace(/^Use /, "");
        const named = /^[A-Z][A-Z0-9.]*/.exec(text)?.[0];
        e.use = { text, card: named ? byName.get(named)?.cards[0] : undefined };
      }
    }
    const done = rows.filter((r) => r.implemented);
    const parity = done.filter((r) => r.parity).length;
    const counts = [
      { key: "yes", n: parity, label: "full parity" },
      { key: "no", n: done.length - parity, label: "partial / different" },
      { key: "sup", n: rows.filter((r) => r.superseded).length, label: "superseded" },
      { key: "oos", n: rows.filter((r) => r.oos).length, label: "out of scope" },
    ];
    return { list: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), counts };
  }, []);
  const { list: entries, counts } = data;

  const q = search.trim().toUpperCase();
  const shown = q ? entries.filter((e) => e.name.includes(q)) : entries;
  const open = (c: NodeCatalogEntry) => frStore.openCard(c.type);
  const cardLink = (c: NodeCatalogEntry) => (
    <button key={c.type} type="button" className="fr-xl__card" style={accentVars(cardAccent(c, mode))} onClick={() => open(c)}>{c.label}</button>
  );

  return (
    <div className="fr-xl">
      <div className="fr-xl__head">
        <div className="fr-xl__top">
          <input
            className="solenoid-add-menu__search fr-xl__search"
            placeholder="Search Excel functions…"
            value={search}
            spellCheck={false}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && search) { e.stopPropagation(); setSearch(""); } }}
            // Touch must not pop the on-screen keyboard over the fresh panel.
            autoFocus={!IS_COARSE}
          />
          <div className="fr-xl__legend">
            {counts.map((c) => <span key={c.key}><i className={`fr-xl__dot fr-xl__dot--${c.key}`} />{c.n} {c.label}</span>)}
          </div>
        </div>
        <p className="fr-xl__sum">Coming from Excel? Find a function where Excel files it, and open the card that does it here.</p>
        <div className="fr-xl__cols-head" aria-hidden="true">
          <span>Excel</span><ChunkyArrow /><span>Solenoid</span>
        </div>
      </div>
      <div className="fr-xl__scroll">
        {shown.length === 0 ? (
          <div className="fr-empty">No Excel function matches “{search}”</div>
        ) : EXCEL_SECTIONS.map((s) => {
          const list = shown.filter((e) => excelSection(e.name) === s);
          if (!list.length) return null;
          return (
            <section key={s} className="fr-xl__group">
              <div className="fr-card__label fr-xl__caption">{s}</div>
              <div className="fr-xl__cols">
                {list.map((e) => (
                  <div key={e.name} className={`fr-xl__row${e.cards.length ? "" : " fr-xl__row--none"}`}>
                    <span className="fr-xl__name">{e.name}</span>
                    <span />
                    <span className="fr-xl__to">
                      {e.cards.length ? e.cards.map(cardLink)
                        : e.use ? <>use {e.use.card ? cardLink(e.use.card) : e.use.text}</>
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
