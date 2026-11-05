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
import { appThemeStore } from "../appTheme";
import { nodeAccent } from "../nodes/kind";
import { contrastInk, darkenAccent } from "../palette";
import { documentStore } from "../documentStore";
import { allPacks, packsStore } from "../packs";
import { DrillMenu, LeafRow, drillStackTo, type NodeCatalogEntry, type CatalogEntry, type CatalogCategory, type CatalogPair } from "../AddNodeMenu";
import { IS_COARSE } from "../coarse";
import { descriptionHtml } from "../descriptionMd";
import { SolenoidSocket, SOCKET_TYPE_LABELS } from "../sockets";
import { socketDocFor } from "../socketDocs";
import { rolesOf } from "../nodes/shared";
import { emptyFieldShown, type EmptyFieldShown } from "../emptySlots";
import { SocketComponent } from "./SocketComponent";
import { SegToggle } from "./SegToggle";
import { ChevronLeftIcon } from "./Icons";
import "../Settings.css";
import "./nodeCard.css";
import type { GraphNode } from "../graphModel";

/** An op or formula row's leaf ("list-smooth__op-gaussian") belongs to its host card. */
const cardTypeOf = (leaf: NodeCatalogEntry) => leaf.type.split("__")[0];

// What an empty field does, as the card draws it: the field itself, its placeholder upright for a Fallback, in brackets
// for a Behavior, italic for an Example, and blank for Required.
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
  // The open folder's color, worn by the navigator's top row as the landing's folder header wears it.
  const navMode = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.getMode);
  const navAccent = useMemo(() => {
    if (pack) return folderAccent(packCards, navMode);
    const top = stack.length ? catalog[stack[0]] : null;
    return top ? folderAccent(leavesUnder(top), navMode) : null;
  }, [pack, packCards, stack, catalog, navMode]);
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
        <div className="solenoid-add-menu__scroll fr-nav__list" style={accentVars(navAccent)}>
          {pack && !q && (
            <div className="solenoid-add-menu__item solenoid-add-menu__item--back" onClick={() => setPack(null)} title="Show every card">
              <ChevronLeftIcon size={14} />
              <span>{packName.get(pack) ?? pack} pack</span>
            </div>
          )}
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
          <Landing catalog={catalog} onCard={pick} onFolder={(i) => setStack([i])} />
        )}
      </section>
    </div>
  );
}

type ModeMeta = Record<string, { label: string; title?: string }>;

/** The cards under a folder, Add-menu order, pairs flattened. */
function leavesUnder(e: CatalogEntry): NodeCatalogEntry[] {
  if (e.type === "category") return (e as CatalogCategory).children.flatMap(leavesUnder);
  if (e.type === "pair") return (e as CatalogPair).children.filter((c) => !c.hidden);
  return (e as NodeCatalogEntry).hidden ? [] : [e as NodeCatalogEntry];
}

/** A folder's color: its first card's, as that card's header wears it. */
function folderAccent(cards: NodeCatalogEntry[], mode: "dark" | "light"): string | null {
  try { return cards[0] ? nodeAccent(cards[0].create() as GraphNode, mode) : null; } catch { return null; }
}

/** The color vars a surface in that color publishes, as NodeCard does. */
function accentVars(accent: string | null): React.CSSProperties | undefined {
  return accent
    ? ({ "--node-accent": accent, "--node-accent-ink": contrastInk(accent), "--node-accent-dark": darkenAccent(accent) } as React.CSSProperties)
    : undefined;
}

/** The landing: every top-level folder in its cards' color, with its count and first cards, then the legend. */
function Landing({ catalog, onCard, onFolder }: {
  catalog: CatalogEntry[]; onCard: (leaf: NodeCatalogEntry) => void; onFolder: (i: number) => void;
}) {
  const themeMode = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.getMode);
  const folders = useMemo(() => catalog.flatMap((e, i) => {
    if (e.type !== "category") return [];
    const cards = leavesUnder(e);
    if (!cards.length) return [];
    return [{ i, label: (e as CatalogCategory).label, cards, accent: folderAccent(cards, themeMode) }];
  }), [catalog, themeMode]);

  return (
    <div className="fr-land">
      <div className="fr-land__grid">
        {folders.map((f) => (
          <section key={f.label} className="fr-land__folder"
            style={accentVars(f.accent)}>
            <button type="button" className="fr-land__head" onClick={() => onFolder(f.i)} title="Open this folder">
              <span>{f.label}</span><span className="fr-land__count">{f.cards.length}</span>
            </button>
            <div className="fr-land__cards">
              {f.cards.slice(0, 9).map((c) => (
                <button key={c.type} type="button" className="fr-land__card" onClick={() => onCard(c)}>{c.label}</button>
              ))}
              {f.cards.length > 9 && (
                <button type="button" className="fr-land__more" onClick={() => onFolder(f.i)}>{f.cards.length - 9} more ›</button>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

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
  // The card's own color, as its header wears it on the canvas (DESIGN.md § Nearest-Accent Rule).
  const themeMode = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.getMode);
  const accent = useMemo(() => { try { return node ? nodeAccent(node, themeMode) : null; } catch { return null; } }, [node, themeMode]);
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

  const hasFormulas = !!ownFormula || card.excel.length > 0 || card.formulas.length > 0 || card.operators.length > 0;
  const where = card.path[0] === "Packs"
    ? `${card.packs.map((p) => packName.get(p) ?? p).join(", ")} pack${card.path.length > 2 ? ` ▸ ${card.path.slice(2).join(" ▸ ")}` : ""}`
    : `${card.path.join(" ▸ ")}${card.packs.length ? ` · ${card.packs.map((p) => packName.get(p) ?? p).join(", ")} pack` : ""}`;
  const hasRail = !!modeMeta || card.ops.length > 0 || examples.length > 0;

  return (
    <article className="fr-card" style={accent ? ({ "--node-accent": accent, "--node-accent-ink": contrastInk(accent) } as React.CSSProperties) : undefined}>
      <button type="button" className="fr-card__back" onClick={onBack}>‹ Cards</button>
      <header className="fr-card__head">
        {backTo && <button type="button" className="fr-card__retrace" onClick={onRetrace}>‹ {backTo}</button>}
        <div className="fr-card__head-row">
          <h2 className="fr-card__title">{card.label}</h2>
          <button type="button" className="solenoid-node__open-btn fr-card__add" title="Drop this card on the canvas"
            onClick={() => { void addNodeFrom(make); frStore.close(); }}>Add to Canvas</button>
        </div>
        <div className="fr-card__crumb">
          <span>{where}</span>
          {card.packs.length > 0 && (
            <span className="fr-card__pack-switch">
              <button
                type="button"
                role="switch"
                aria-checked={!packOff}
                aria-label={`${packName.get(card.packs[0]) ?? card.packs[0]} pack`}
                className={`solenoid-settings__switch${packOff ? "" : " solenoid-settings__switch--on"}`}
                onClick={() => packsStore.toggle(card.packs[0])}
              >
                <span className="solenoid-settings__knob" />
              </button>
            </span>
          )}
        </div>
      </header>

      {card.description && (
        <p ref={descRef} className="fr-card__desc" onClick={onDescClick} dangerouslySetInnerHTML={{ __html: descriptionHtml(card.description) }} />
      )}

      <div className={`fr-card__body${hasRail ? "" : " fr-card__body--solo"}`}>
        <div className="fr-card__main">
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
          {hasFormulas && (
            <Section title="Formulas">
              {ownFormula && <FxRow text={ownFormula} copied={copied} onCopy={copy} />}
              {card.operators.map((o) => <FxRow key={o} text={o} copied={copied} onCopy={copy} />)}
              {card.excel.map((e) => (
                <FxRow key={e.name} text={e.syntax.replace(/^=/, "")} copied={copied} onCopy={copy} note={e.note} />
              ))}
              {card.formulas.map((f) => (
                <FxRow key={f.name} text={`${f.name}(${f.signature})`} on={!!f.via && f.via === opLabel} copied={copied} onCopy={copy} />
              ))}
            </Section>
          )}
        </div>

        {hasRail && (
          <aside className="fr-card__rail">
            {modeMeta && (
              <Section title="Mode">
                <SegToggle
                  value={mode ?? Object.keys(modeMeta)[0]}
                  onChange={(m) => setModePick(m)}
                  options={Object.entries(modeMeta).map(([m, meta]) => ({ value: m, label: meta.label, title: meta.title }))}
                />
              </Section>
            )}
            {card.ops.length > 0 && (
              <Section title="Operations">
                <div className="fr-card__ops-list">
                  {card.ops.map((o) => (
                    <div key={o.op}
                      className={`solenoid-add-menu__item${o.op === op ? " solenoid-add-menu__item--active" : ""}`}
                      onClick={card.createOp ? () => setOpPick(o.op) : undefined}
                      title={card.createOp ? "Show the card set to this operation" : undefined}>{o.label}</div>
                  ))}
                </div>
              </Section>
            )}
            {examples.length > 0 && (
              <Section title="Examples">
                <div className="fr-card__links">
                  {examples.slice(0, 8).map((ex) => (
                    <button key={ex.id} type="button" className="fr-card__link" title="Open this example in a new tab"
                      onClick={() => { frStore.close(); void documentStore.newFromTemplate(ex.id); }}>{ex.label} ›</button>
                  ))}
                </div>
              </Section>
            )}
          </aside>
        )}
      </div>
    </article>
  );
}

/** A formula line; the code copies on click. */
function FxRow({ text, note, on, copied, onCopy }: {
  text: string; note?: string; on?: boolean; copied: string | null; onCopy: (t: string) => void;
}) {
  return (
    <div className={`fr-card__fx${on ? " fr-card__fx--on" : ""}`}>
      <button type="button" className="fr-card__fx-code" onClick={() => onCopy(text)} title="Copy">
        <code>{text}</code>
      </button>
      {copied === text && <span className="fr-card__fx-copied">Copied</span>}
      {note && <div className="fr-card__fx-note">{note}</div>}
    </div>
  );
}

/** An empty field as the card draws it: the card's own inline input, its placeholder styled by kind. */
function EmptyField({ kind, shown }: { kind: EmptyFieldShown["kind"]; shown?: string }) {
  return (
    <input
      readOnly
      tabIndex={-1}
      className={`solenoid-node__inline-input fr-card__field${kind === "example" ? " sol-placeholder-example" : ""}`}
      placeholder={kind === "required" ? "" : shown ?? ""}
      aria-label={EMPTY_KIND[kind].name}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="fr-card__section">
      <div className="fr-card__label">{title}</div>
      <div className="fr-card__section-body">{children}</div>
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
        <span className="fr-card__sock-dot" title={t ? SOCKET_TYPE_LABELS[t] : undefined}>{socket instanceof SolenoidSocket && <SocketComponent data={socket} />}</span>
        <span className="fr-card__sock-name">{label}</span>
        {unit && <span className="fr-card__sock-type">{unit}</span>}
        {empty && <span className="fr-card__empty"><EmptyField kind={empty.kind} shown={empty.shown} /></span>}
      </div>
      {doc && <div className="fr-card__sock-doc">{doc}</div>}
    </div>
  );
}
