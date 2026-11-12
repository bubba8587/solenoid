// [[C51]] formulaNaming
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { frStore } from "../frStore";
import { buildFunctionReference, type FnRefRow } from "../functionReference";
import { EXCEL_SECTIONS, excelSection } from "../excelSections";
import { buildCatalog } from "../catalogUtils";
import { flattenLeaves } from "../catalogSearch";
import { IS_COARSE } from "../coarse";
import { appThemeStore } from "../appTheme";
import type { NodeCatalogEntry } from "../AddNodeMenu";
import { accentVars, cardAccent } from "./CardReference";
import { EqualIcon, TriangleAlertIcon } from "./Icons";
import { hasFunctionRecord, openFunctionRecord } from "../functionRecords";

/** A heavy square-cut arrow, as the Frame mark is drawn: butt ends, mitred point. */
function ChunkyArrow() {
  return (
    <svg className="fr-xl__arrow" viewBox="0 0 20 14" width="24" height="17" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="butt" strokeLinejoin="miter">
      <path d="M1 7 H16 M10.5 1.5 L16.2 7 L10.5 12.5" />
    </svg>
  );
}

/** Where Excel's ribbon folds the rest under More Functions, the navigator draws its divider. */
const MORE_FUNCTIONS = "Statistical";

/** One Excel function: the cards that answer it, or the newer function that replaced it, or why it has no card. */
interface XlEntry {
  name: string; cards: NodeCatalogEntry[]; use?: { text: string; card?: NodeCatalogEntry };
  /** Whether every card answering it gives Excel's answer; a difference is told on the card's page. */
  same?: boolean;
}

/** A row's parity mark, closing the row: = where the card answers as Excel does, ⚠ where it differs. Where the
 *  function has a record, the mark opens the cases behind it ([[function-records]]). */
function ParityMark({ same, name }: { same: boolean; name?: string }) {
  const icon = same ? <EqualIcon size={14} strokeWidth={2.2} /> : <TriangleAlertIcon size={13} />;
  const cls = `fr-xl__parity fr-xl__parity--${same ? "same" : "differs"}`;
  if (name && hasFunctionRecord(name)) {
    return (
      <button type="button" className={`${cls} fr-xl__parity--cases`} title="Cases checked against Excel"
        aria-label={`Open ${name}'s cases checked against Excel`}
        onClick={(ev) => { ev.stopPropagation(); void openFunctionRecord(name); }}>
        {icon}
      </button>
    );
  }
  return (
    <span className={cls} role="img" aria-label={same ? "Same as Excel" : "Differs from Excel: the card's page says how"}>
      {icon}
    </span>
  );
}

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
      if (card) e.same = (e.same ?? true) && r.parity;
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
  const bySection = EXCEL_SECTIONS.map((s) => ({ s, list: shown.filter((e) => excelSection(e.name) === s) })).filter((g) => g.list.length);
  const open = (c: NodeCatalogEntry) => frStore.openCard(c.type);
  const cardLink = (c: NodeCatalogEntry) => (
    <button key={c.type} type="button" className="fr-xl__card" style={accentVars(cardAccent(c, mode))} onClick={() => open(c)}>{c.label}</button>
  );

  // The navigator follows the scroll: the lit section is the one under the pinned header.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState<string | null>(null);
  const spy = () => {
    const box = scrollRef.current;
    if (!box) return;
    let cur: string | null = null;
    for (const el of box.querySelectorAll<HTMLElement>("[data-section]")) if (el.offsetTop - box.offsetTop <= box.scrollTop + 8) cur = el.dataset.section!;
    setLit(cur ?? bySection[0]?.s ?? null);
  };
  useEffect(spy, [q]);
  const jump = (s: string) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-section="${s}"]`);
    if (box && el) box.scrollTo({ top: el.offsetTop - box.offsetTop });
  };

  return (
    <div className="fr-cards fr-xl">
      <nav className="fr-nav">
        <input
          className="solenoid-add-menu__search fr-nav__search"
          placeholder="Search Excel functions…"
          value={search}
          spellCheck={false}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && search) { e.stopPropagation(); setSearch(""); } }}
          // Touch must not pop the on-screen keyboard over the fresh panel.
          autoFocus={!IS_COARSE}
        />
        <div className="solenoid-add-menu__scroll fr-nav__list fr-xl__nav">
          {EXCEL_SECTIONS.map((s) => {
            const n = bySection.find((g) => g.s === s)?.list.length ?? 0;
            return (
              <Fragment key={s}>
                {s === MORE_FUNCTIONS && <div className="solenoid-add-menu__divider" role="separator" />}
                <div className={`solenoid-add-menu__item${lit === s ? " solenoid-add-menu__item--active" : ""}${n ? "" : " solenoid-add-menu__item--incompatible"}`}
                  onClick={() => n && jump(s)}>
                  <span>{s}</span><span className="fr-xl__count">{n}</span>
                </div>
              </Fragment>
            );
          })}
        </div>
      </nav>
      <div className="fr-xl__page">
        <div className="fr-xl__head">
          <p className="fr-xl__sum">Coming from Excel? Find a function where Excel files it, and open the card that does it here.</p>
          <div className="fr-xl__legend">
            {counts.map((c) => (
              <span key={c.key}>{c.key === "yes" || c.key === "no" ? <ParityMark same={c.key === "yes"} /> : null}{c.n} {c.label}</span>
            ))}
          </div>
          <div className="fr-xl__cols-head" aria-hidden="true">
            <span className="fr-xl__from">Excel<ChunkyArrow /></span><span>Solenoid</span>
          </div>
        </div>
        <div className="fr-xl__scroll" ref={scrollRef} onScroll={spy}>
          {bySection.length === 0 ? (
            <div className="fr-empty">No Excel function matches “{search}”</div>
          ) : bySection.map(({ s, list }) => (
            <section key={s} className="fr-xl__group" data-section={s}>
              <div className="fr-card__label fr-xl__caption">{s}</div>
              {list.map((e) => (
                // A function one card answers opens it from anywhere on its row.
                <div key={e.name} className={`fr-xl__row${e.cards.length ? "" : " fr-xl__row--none"}${e.cards.length === 1 ? " fr-xl__row--go" : ""}`}
                  onClick={e.cards.length === 1 ? () => open(e.cards[0]) : undefined}>
                  <span className="fr-xl__name">{e.name}</span>
                  <span className="fr-xl__to" onClick={(ev) => ev.stopPropagation()}>
                    {e.cards.length ? e.cards.map(cardLink)
                      : e.use ? <>use {e.use.card ? cardLink(e.use.card) : e.use.text}</>
                      : "—"}
                  </span>
                  {e.cards.length ? <ParityMark same={!!e.same} name={e.name} /> : <span />}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
