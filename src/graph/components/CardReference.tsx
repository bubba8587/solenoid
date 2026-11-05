// [[B16]] oneFormulaSurface, [[D96]] emptySlotShowsItsValue, [[C73]] inspectorIsStatic
// The Reference: the Add menu's own tree and search on the left, a card's page on the right, built from what the card
// and the catalog already declare. Nothing here is hand-kept.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { frStore } from "../frStore";
import { buildCardReference, type CardRef } from "../functionReference";
import { addNodeFrom, buildCatalog } from "../catalogUtils";
import { flattenLeaves, searchLeaves } from "../catalogSearch";
import { formulaHomes } from "../formulaCards";
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

  const pick = (leaf: NodeCatalogEntry) => { setStartOp(null); setPicked(leaf); };
  const card = selected ? byType.get(selected) ?? null : null;

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
      <section className="fr-page">
        {card ? (
          <CardPage key={`${picked!.type}#${startOp ?? ""}`} card={card} leaf={picked!} startOp={startOp} packName={packName} onBack={() => setPicked(null)} />
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

function CardPage({ card, leaf, startOp, packName, onBack }: {
  card: CardRef; leaf: NodeCatalogEntry; startOp: string | null; packName: Map<string, string>; onBack: () => void;
}) {
  useSyncExternalStore(packsStore.subscribe, packsStore.version);
  // A card with ops shows the one picked; its chips switch it.
  const [opPick, setOpPick] = useState<string | null>(startOp);
  const make = useMemo(
    () => (opPick && card.createOp ? () => card.createOp!(opPick) : leaf.create),
    [opPick, card, leaf],
  );
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

  return (
    <article className="fr-card">
      <button type="button" className="fr-card__back" onClick={onBack}>‹ Cards</button>
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
        {packOff && <span className="fr-card__off"> · off, turn it on in Settings</span>}
      </div>
      {card.description && <p className="fr-card__desc" dangerouslySetInnerHTML={{ __html: descriptionHtml(card.description) }} />}

      {(ownFormula || card.excel.length > 0 || card.formulas.length > 0 || card.operators.length > 0) && (
        <Section title="Formulas">
          {ownFormula && (
            <div className="fr-card__fx">
              <code>{ownFormula}</code>
              <span className="fr-card__fx-meta">this card’s formula</span>
            </div>
          )}
          {card.operators.map((o) => (
            <div key={o} className="fr-card__fx">
              <code>{o}</code>
              <span className="fr-card__fx-meta">operator</span>
            </div>
          ))}
          {card.excel.map((e) => (
            <div key={e.name} className="fr-card__fx">
              <code>{e.syntax.replace(/^=/, "")}</code>
              <span className="fr-card__fx-meta">Excel{e.parity ? "" : " · differs"}</span>
              {(e.note || !e.parity) && <div className="fr-card__fx-note">{e.note ?? "Answers differ from Excel’s in some cases."}</div>}
            </div>
          ))}
          {card.formulas.map((f) => (
            <div key={f.name} className={`fr-card__fx${f.via && f.via === opLabel ? " fr-card__fx--on" : ""}`}>
              <code>{f.name}({f.signature})</code>
              {f.via && <span className="fr-card__fx-meta">{f.via}</span>}
            </div>
          ))}
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
