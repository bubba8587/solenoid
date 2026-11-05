// [[B16]] oneFormulaSurface, [[D96]] emptySlotShowsItsValue, [[C73]] inspectorIsStatic
// The Reference: the Add menu's own tree and search on the left, a card's page on the right, built from what the card
// and the catalog already declare. Nothing here is hand-kept.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { frStore } from "../frStore";
import { buildCardReference, type CardRef } from "../functionReference";
import { addNodeFrom, buildCatalog } from "../catalogUtils";
import { flattenLeaves, searchLeaves } from "../catalogSearch";
import { formulaHomes } from "../formulaCards";
import { examplesUsing } from "../cardExamples";
import { documentStore } from "../documentStore";
import { allPacks, packsStore } from "../packs";
import { DrillMenu, LeafRow, drillStackTo, type NodeCatalogEntry } from "../AddNodeMenu";
import { IS_COARSE } from "../coarse";
import { descriptionHtml } from "../descriptionMd";
import { SolenoidSocket, SOCKET_TYPE_LABELS } from "../sockets";
import { socketDocFor } from "../socketDocs";
import { rolesOf } from "../nodes/shared";
import { emptyFieldShown, type EmptyFieldShown } from "../emptySlots";
import { SocketComponent } from "./SocketComponent";
import type { GraphNode } from "../graphModel";

/** An op or formula row's leaf ("list-smooth__op-gaussian") belongs to its host card. */
const cardTypeOf = (leaf: NodeCatalogEntry) => leaf.type.split("__")[0];

const EMPTY_KIND: Record<EmptyFieldShown["kind"], { name: string; means: string }> = {
  fallback: { name: "Fallback", means: "Left empty, the card computes with this value." },
  behavior: { name: "Behavior", means: "Left empty, the card does this instead." },
  example: { name: "Example", means: "A hint only: the card computes nothing from it, so type a value." },
  required: { name: "Required", means: "Left empty, the card shows an error until it gets a value." },
};

export function CardReference() {
  const cards = useMemo(() => buildCardReference(), []);
  const byType = useMemo(() => new Map(cards.map((c) => [c.type, c])), [cards]);
  const catalog = useMemo(() => buildCatalog(false), []);
  const leaves = useMemo(() => flattenLeaves(catalog), [catalog]);
  const packName = useMemo(() => new Map(allPacks().map((p) => [p.id, p.name])), []);

  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<number[]>([]);
  // The row picked: an op's row ("Smooth: Gaussian") opens the card in that op.
  const [picked, setPicked] = useState<NodeCatalogEntry | null>(null);
  const [active, setActive] = useState(0);
  // The op a card opened from the Inspector is set to.
  const [startOp, setStartOp] = useState<string | null>(null);
  const selected = picked ? cardTypeOf(picked) : null;
  const [pack, setPack] = useState<string | null>(null);

  // Settings opens a pack here, and the Inspector or the Excel table a card.
  const ver = useSyncExternalStore(frStore.subscribe, frStore.version);
  useEffect(() => {
    const focus = frStore.takeFocus();
    if (!focus) return;
    setQuery("");
    if (focus.startsWith("pack:")) {
      const id = focus.slice(5);
      setPack(id);
      setPicked(leaves.find((l) => !l.leaf.type.includes("__") && (l.leaf.packs ?? []).includes(id))?.leaf ?? null);
    } else if (focus.startsWith("card:")) {
      // An op's own type ("list-smooth__op-gaussian") opens the card in that op.
      const [type, op] = focus.slice(5).split("#");
      const base = type.split("__")[0];
      setPack(null);
      setStartOp(op ?? null);
      setPicked((leaves.find((l) => l.leaf.type === type) ?? leaves.find((l) => l.leaf.type === base))?.leaf ?? null);
      // The folder list opens where the card lives, as the Add menu would show it.
      setStack(drillStackTo(catalog, base) ?? []);
    }
  }, [ver, leaves, catalog]);

  const q = query.trim();
  const results = useMemo(() => {
    if (!q) return [];
    // A formula name lands on its card even when the card's label is nothing like it (KRON → MMULT).
    const up = q.toUpperCase();
    const byFormula: NodeCatalogEntry[] = [];
    for (const [name, home] of formulaHomes()) {
      if (name !== up) continue;
      const card = byType.get(home.type);
      if (card) byFormula.push({ type: card.type, label: `${name} → ${card.label}`, description: card.description, create: card.create } as NodeCatalogEntry);
    }
    const found = searchLeaves(leaves, q);
    // The Add menu's own search already places an op's formula name ("Smooth: Gaussian"); add only what it missed.
    const placed = new Set(found.map(cardTypeOf));
    return [...byFormula.filter((l) => !placed.has(cardTypeOf(l))), ...found];
  }, [q, leaves, byType]);
  useEffect(() => setActive(0), [q]);

  const packCards = useMemo(
    () => (pack ? leaves.filter((l) => !l.leaf.type.includes("__") && (l.leaf.packs ?? []).includes(pack)).map((l) => l.leaf) : []),
    [pack, leaves],
  );

  // Pages reached by a link inside a page, so Back retraces them.
  const [trail, setTrail] = useState<NodeCatalogEntry[]>([]);
  const pick = (leaf: NodeCatalogEntry) => { setStartOp(null); setTrail([]); setPicked(leaf); };
  const follow = (leaf: NodeCatalogEntry) => {
    if (picked) setTrail([...trail, picked]);
    setStartOp(null);
    setPicked(leaf);
    setStack(drillStackTo(catalog, cardTypeOf(leaf)) ?? stack);
  };
  const back = () => { setStartOp(null); setPicked(trail[trail.length - 1] ?? null); setTrail(trail.slice(0, -1)); };
  // A name in a page's prose that has a page: a formula ("MMULT") or a card label ("Frame Filter").
  const byLabel = useMemo(() => {
    const m = new Map<string, NodeCatalogEntry>();
    for (const l of leaves) if (!l.leaf.type.includes("__") && !m.has(l.leaf.label.toLowerCase())) m.set(l.leaf.label.toLowerCase(), l.leaf);
    return m;
  }, [leaves]);
  const resolve = (text: string): NodeCatalogEntry | null => {
    const name = text.replace(/^=/, "").replace(/\(.*$/, "").trim();
    const home = formulaHomes().get(name.toUpperCase());
    if (home) return leaves.find((l) => l.leaf.type === home.type)?.leaf ?? null;
    return byLabel.get(name.toLowerCase()) ?? null;
  };
  const card = selected ? byType.get(selected) ?? null : null;
  // Each page opens at its top, not where the last one was scrolled to.
  const pageRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => { pageRef.current?.scrollTo({ top: 0 }); }, [picked]);

  return (
    <div className={`fr-cards${card ? " fr-cards--page" : ""}`}>
      <nav className="fr-nav">
        <input
          className="solenoid-add-menu__search fr-nav__search"
          placeholder="Search cards and formulas…"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && results.length) { e.preventDefault(); const i = Math.min(active + 1, results.length - 1); setActive(i); pick(results[i]); }
            else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); const i = Math.max(active - 1, 0); setActive(i); pick(results[i]); }
            else if (e.key === "Enter" && results[active]) pick(results[active]);
            else if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); }
          }}
          // Touch must not pop the on-screen keyboard over the fresh panel.
          autoFocus={!IS_COARSE}
        />
        {pack && !q && (
          <button type="button" className="fr-nav__chip" onClick={() => setPack(null)} title="Show every card">
            {packName.get(pack) ?? pack}<span aria-hidden="true"> ×</span>
          </button>
        )}
        <div className="solenoid-add-menu__scroll fr-nav__list">
          {q ? (
            results.length === 0
              ? <div className="solenoid-add-menu__empty">Nothing matches “{q}”.</div>
              : results.map((leaf, i) => (
                <LeafRow key={leaf.type} leaf={leaf} active={picked ? picked.type === leaf.type : i === active} dim={false} onSelect={() => { setActive(i); pick(leaf); }} />
              ))
          ) : pack ? (
            packCards.map((leaf) => (
              <LeafRow key={leaf.type} leaf={leaf} active={selected === leaf.type} dim={false} onSelect={() => pick(leaf)} />
            ))
          ) : (
            <DrillMenu
              entries={catalog}
              stack={stack}
              onPush={(i) => setStack([...stack, i])}
              onPop={() => setStack(stack.slice(0, -1))}
              onSelect={pick}
              isDim={() => false}
              activeType={selected ?? undefined}
            />
          )}
        </div>
      </nav>
      <section className="fr-page" ref={pageRef}>
        {card ? (
          <CardPage
            key={`${picked!.type}#${startOp ?? ""}`}
            card={card} leaf={picked!} startOp={startOp} packName={packName}
            onBack={() => setPicked(null)}
            backTo={trail.length ? byType.get(cardTypeOf(trail[trail.length - 1]))?.label ?? null : null}
            onRetrace={back}
            resolve={resolve}
            onFollow={follow}
          />
        ) : (
          <div className="fr-page__intro">
            <p>Every card, with the formulas that do the same job, its fields and what an empty one does, and where it comes from in Excel, numpy, scipy or R.</p>
            <p>Browse the folders as in the Add menu, or search by a card’s name or any formula name.</p>
            <div className="fr-page__legend">
              <div className="fr-card__label">What an empty field does</div>
              {(Object.keys(EMPTY_KIND) as EmptyFieldShown["kind"][]).map((k) => (
                <div key={k} className="fr-page__legend-row">
                  <span className={`fr-card__empty fr-card__empty--${k}`}>{EMPTY_KIND[k].name}</span>
                  <span>{EMPTY_KIND[k].means}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

type ModeMeta = Record<string, { label: string; title?: string }>;

function CardPage({ card, leaf, startOp, packName, onBack, backTo, onRetrace, resolve, onFollow }: {
  card: CardRef; leaf: NodeCatalogEntry; startOp: string | null; packName: Map<string, string>; onBack: () => void;
  backTo: string | null; onRetrace: () => void;
  resolve: (text: string) => NodeCatalogEntry | null; onFollow: (leaf: NodeCatalogEntry) => void;
}) {
  useSyncExternalStore(packsStore.subscribe, packsStore.version);
  // A card with ops shows the one picked, and one with modes (List / Grid) the mode picked; chips switch both.
  const [opPick, setOpPick] = useState<string | null>(startOp);
  const [modePick, setModePick] = useState<string | null>(null);
  const make = useMemo(() => {
    const base = opPick && card.createOp ? () => card.createOp!(opPick) : leaf.create;
    if (!modePick) return base;
    return () => {
      const n = base() as { op?: string; constructor: new (init: object) => unknown };
      return new n.constructor({ ...(n.op ? { op: n.op } : {}), mode: modePick });
    };
  }, [opPick, modePick, card, leaf]);
  // A fresh card, as the Add menu would drop it: its sockets and empty fields are the page's Inputs and Outputs.
  const node = useMemo(() => {
    try { return make() as GraphNode; } catch { return null; }
  }, [make]);
  const roles = node ? rolesOf(node) : undefined;
  const op = (node as { op?: string } | null)?.op;
  const opLabel = card.ops.find((o) => o.op === op)?.label;
  // A locked Expression or Equation is its formula: Geometry's Circle Area is `PI() * r^2`.
  const preset = node as { locked?: boolean; expr?: string; varDescriptions?: Record<string, string>; varUnits?: Record<string, string> } | null;
  const ownFormula = preset?.locked && preset.expr ? preset.expr : null;
  const packOff = card.packs.length > 0 && !card.packs.some((p) => packsStore.isActive(p));
  const examples = useMemo(() => examplesUsing(card.type), [card]);
  const modeMeta = (node?.constructor as { modeMeta?: ModeMeta } | undefined)?.modeMeta;
  const mode = (node as { mode?: string } | null)?.mode;

  // Code spans in the prose that name a formula or card become links to its page.
  const descRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    for (const el of descRef.current?.querySelectorAll("code") ?? []) {
      const target = resolve(el.textContent ?? "");
      if (target && cardTypeOf(target) !== card.type) el.classList.add("fr-xref");
    }
  }, [card, resolve]);
  const onDescClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest("code.fr-xref");
    const target = el && resolve(el.textContent ?? "");
    if (target) onFollow(target);
  };

  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1200);
    }).catch(() => {});
  };

  return (
    <article className="fr-card">
      <button type="button" className="fr-card__back" onClick={onBack}>‹ Cards</button>
      {backTo && <button type="button" className="fr-card__retrace" onClick={onRetrace}>‹ {backTo}</button>}
      <header className="fr-card__head">
        <h2 className="fr-card__title">{card.label}</h2>
        <button
          type="button"
          className="fr-card__add"
          title="Drop this card on the canvas"
          onClick={() => { void addNodeFrom(make); frStore.close(); }}
        >+ Add to canvas</button>
      </header>
      <div className="fr-card__crumb">
        {card.path[0] === "Packs"
          ? <>{card.packs.map((p) => packName.get(p) ?? p).join(", ")} pack{card.path.length > 2 ? ` ▸ ${card.path.slice(2).join(" ▸ ")}` : ""}</>
          : card.path.join(" ▸ ")}
        {card.path[0] !== "Packs" && card.packs.length > 0 && <>{" · "}{card.packs.map((p) => packName.get(p) ?? p).join(", ")} pack</>}
        {packOff && (
          <>
            <span className="fr-card__off"> · off</span>
            <button type="button" className="fr-card__turn-on" onClick={() => packsStore.toggle(card.packs[0])}>Turn on</button>
          </>
        )}
      </div>
      {card.description && (
        <p ref={descRef} className="fr-card__desc" onClick={onDescClick} dangerouslySetInnerHTML={{ __html: descriptionHtml(card.description) }} />
      )}

      {(ownFormula || card.excel.length > 0 || card.formulas.length > 0 || card.operators.length > 0) && (
        <Section title="Formulas">
          {ownFormula && <FxRow text={ownFormula} meta="this card’s formula" copied={copied} onCopy={copy} />}
          {card.operators.map((o) => <FxRow key={o} text={o} meta="operator" copied={copied} onCopy={copy} />)}
          {card.excel.map((e) => (
            <FxRow key={e.name} text={e.syntax.replace(/^=/, "")} meta={`Excel${e.parity ? "" : " · differs"}`} copied={copied} onCopy={copy}
              note={e.note || !e.parity ? e.note ?? "Answers differ from Excel’s in some cases." : undefined} />
          ))}
          {card.formulas.map((f) => {
            const viaOp = card.createOp ? card.ops.find((o) => o.label === f.via)?.op : undefined;
            return (
              <FxRow key={f.name} text={`${f.name}(${f.signature})`} meta={f.via} on={!!f.via && f.via === opLabel}
                copied={copied} onCopy={copy} onMeta={viaOp ? () => setOpPick(viaOp) : undefined} />
            );
          })}
        </Section>
      )}

      {modeMeta && (
        <Section title="Modes">
          <div className="fr-card__ops">
            {Object.entries(modeMeta).map(([m, meta]) => (
              <button key={m} type="button" className={`fr-card__op${m === mode ? " fr-card__op--on" : ""}`}
                title={meta.title} onClick={() => setModePick(m)}>{meta.label}</button>
            ))}
          </div>
        </Section>
      )}

      {card.ops.length > 0 && (
        <Section title="Ops">
          <div className="fr-card__ops">
            {card.ops.map((o) => (
              <button
                key={o.op}
                type="button"
                className={`fr-card__op${o.op === op ? " fr-card__op--on" : ""}`}
                disabled={!card.createOp}
                onClick={() => setOpPick(o.op)}
                title="Show the card set to this op"
              >{o.label}</button>
            ))}
          </div>
        </Section>
      )}

      {node && Object.keys(node.inputs).length > 0 && (
        <Section title="Inputs">
          {Object.entries(node.inputs).map(([key, input]) => {
            const empty = emptyFieldShown(node.constructor.name, key, roles?.[key], op);
            return (
              <SocketLine key={key} node={node} sockKey={key} label={input?.label ?? key} socket={input?.socket}
                empty={empty} doc={preset?.varDescriptions?.[key]} unit={preset?.varUnits?.[key]} />
            );
          })}
        </Section>
      )}
      {node && Object.keys(node.outputs).length > 0 && (
        <Section title="Outputs">
          {Object.entries(node.outputs).map(([key, output]) => (
            <SocketLine key={key} node={node} sockKey={key} label={output?.label ?? key} socket={output?.socket} />
          ))}
        </Section>
      )}

      {examples.length > 0 && (
        <Section title="See it in an example">
          <div className="fr-card__ops">
            {examples.slice(0, 8).map((ex) => (
              <button key={ex.id} type="button" className="fr-card__op" title="Open this example in a new tab"
                onClick={() => { frStore.close(); void documentStore.newFromTemplate(ex.id); }}>{ex.label}</button>
            ))}
          </div>
        </Section>
      )}

      {card.libs.filter((l) => l !== "Excel").length > 0 && (
        <Section title="Also known from">
          <div className="fr-card__ops">
            {card.libs.filter((l) => l !== "Excel").map((l) => <span key={l} className="fr-card__op">{l}</span>)}
          </div>
        </Section>
      )}
    </article>
  );
}

/** A formula line: the code copies on click; the op name beside it switches the page to that op. */
function FxRow({ text, meta, note, on, copied, onCopy, onMeta }: {
  text: string; meta?: string; note?: string; on?: boolean;
  copied: string | null; onCopy: (t: string) => void; onMeta?: () => void;
}) {
  return (
    <div className={`fr-card__fx${on ? " fr-card__fx--on" : ""}`}>
      <button type="button" className="fr-card__fx-code" onClick={() => onCopy(text)} title="Copy">
        <code>{text}</code>
      </button>
      {copied === text
        ? <span className="fr-card__fx-meta fr-card__fx-copied">Copied</span>
        : meta && (onMeta
          ? <button type="button" className="fr-card__fx-meta fr-card__fx-via" onClick={onMeta} title="Show the card set to this op">{meta}</button>
          : <span className="fr-card__fx-meta">{meta}</span>)}
      {note && <div className="fr-card__fx-note">{note}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="fr-card__section">
      <div className="fr-card__label">{title}</div>
      {children}
    </section>
  );
}

function SocketLine({ node, sockKey, label, socket, empty, doc: given, unit }: {
  node: GraphNode; sockKey: string; label: string; socket: unknown; empty?: EmptyFieldShown; doc?: string; unit?: string;
}) {
  const t = socket instanceof SolenoidSocket ? socket.dataType : null;
  const doc = socketDocFor(node, sockKey) ?? given;
  return (
    <div className="fr-card__sock">
      <div className="fr-card__sock-row">
        <span className="fr-card__sock-dot">{socket instanceof SolenoidSocket && <SocketComponent data={socket} />}</span>
        <span className="fr-card__sock-name">{label}</span>
        <span className="fr-card__sock-type">{t ? SOCKET_TYPE_LABELS[t] : ""}{unit ? ` · ${unit}` : ""}</span>
        {empty && (
          <span className={`fr-card__empty fr-card__empty--${empty.kind}`} title={EMPTY_KIND[empty.kind].means}>
            {EMPTY_KIND[empty.kind].name}
            {empty.shown ? ` · ${empty.shown}` : empty.kind === "fallback" ? " · empty" : ""}
          </span>
        )}
      </div>
      {doc && <div className="fr-card__sock-doc">{doc}</div>}
    </div>
  );
}
