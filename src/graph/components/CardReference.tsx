// [[B16]] oneFormulaSurface, [[D96]] emptySlotShowsItsValue, [[C73]] inspectorIsStatic
// The Reference: the Add menu's own tree and search on the left, a card's page on the right, built from what the card
// and the catalog already declare. Nothing here is hand-kept.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { frStore } from "../frStore";
import { buildCardReference, type CardRef } from "../functionReference";
import { addNodeByCatalogType, buildCatalog } from "../catalogUtils";
import { flattenLeaves, searchLeaves } from "../catalogSearch";
import { formulaHomes } from "../formulaCards";
import { allPacks, packsStore } from "../packs";
import { DrillMenu, LeafRow, type NodeCatalogEntry } from "../AddNodeMenu";
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

const EMPTY_KIND: Record<EmptyFieldShown["kind"], string> = {
  fallback: "Fallback",
  behavior: "Behavior",
  example: "Example",
  required: "Required",
};

export function CardReference() {
  const cards = useMemo(() => buildCardReference(), []);
  const byType = useMemo(() => new Map(cards.map((c) => [c.type, c])), [cards]);
  const catalog = useMemo(() => buildCatalog(false), []);
  const leaves = useMemo(() => flattenLeaves(catalog), [catalog]);
  const packName = useMemo(() => new Map(allPacks().map((p) => [p.id, p.name])), []);

  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<number[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
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
      setSelected(cards.find((c) => c.packs.includes(id))?.type ?? null);
    } else if (focus.startsWith("card:")) {
      setPack(null);
      setSelected(focus.slice(5));
    }
  }, [ver, cards]);

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

  const packCards = useMemo(
    () => (pack ? leaves.filter((l) => !l.leaf.type.includes("__") && (l.leaf.packs ?? []).includes(pack)).map((l) => l.leaf) : []),
    [pack, leaves],
  );

  const pick = (leaf: NodeCatalogEntry) => setSelected(cardTypeOf(leaf));
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
            if (e.key === "Enter" && results[0]) pick(results[0]);
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
              : results.map((leaf) => (
                <LeafRow key={leaf.type} leaf={leaf} active={selected === cardTypeOf(leaf)} dim={false} onSelect={() => pick(leaf)} />
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
          <CardPage key={card.type} card={card} packName={packName} onBack={() => setSelected(null)} />
        ) : (
          <div className="fr-page__intro">
            <p>Every card, with the formulas that do the same job, its fields and what an empty one does, and where it comes from in Excel, numpy, scipy or R.</p>
            <p>Browse the folders as in the Add menu, or search by a card’s name or any formula name.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function CardPage({ card, packName, onBack }: { card: CardRef; packName: Map<string, string>; onBack: () => void }) {
  useSyncExternalStore(packsStore.subscribe, packsStore.version);
  // A fresh card, as the Add menu would drop it: its sockets and empty fields are the page's Inputs and Outputs.
  const node = useMemo(() => {
    try { return card.create() as GraphNode; } catch { return null; }
  }, [card]);
  const roles = node ? rolesOf(node) : undefined;
  const op = (node as { op?: string } | null)?.op;
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
          onClick={() => { void addNodeByCatalogType(card.type); frStore.close(); }}
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

      {(card.excel.length > 0 || card.formulas.length > 0) && (
        <Section title="Formulas">
          {card.excel.map((e) => (
            <div key={e.name} className="fr-card__fx">
              <code>{e.syntax.replace(/^=/, "")}</code>
              <span className="fr-card__fx-meta">Excel{e.parity ? "" : " · differs"}</span>
              {(e.note || !e.parity) && <div className="fr-card__fx-note">{e.note ?? "Answers differ from Excel’s in some cases."}</div>}
            </div>
          ))}
          {card.formulas.map((f) => (
            <div key={f.name} className="fr-card__fx">
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
              <span key={o.op} className="fr-card__op">
                {o.label}
              </span>
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
                empty={empty} />
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

function SocketLine({ node, sockKey, label, socket, empty }: {
  node: GraphNode; sockKey: string; label: string; socket: unknown; empty?: EmptyFieldShown;
}) {
  const t = socket instanceof SolenoidSocket ? socket.dataType : null;
  const doc = socketDocFor(node, sockKey);
  return (
    <div className="fr-card__sock">
      <div className="fr-card__sock-row">
        <span className="fr-card__sock-dot">{socket instanceof SolenoidSocket && <SocketComponent data={socket} />}</span>
        <span className="fr-card__sock-name">{label}</span>
        <span className="fr-card__sock-type">{t ? SOCKET_TYPE_LABELS[t] : ""}</span>
        {empty && (
          <span className={`fr-card__empty fr-card__empty--${empty.kind}`} title="What this field does when it's empty">
            {EMPTY_KIND[empty.kind]}{empty.shown ? ` · ${empty.shown}` : ""}
          </span>
        )}
      </div>
      {doc && <div className="fr-card__sock-doc">{doc}</div>}
    </div>
  );
}
