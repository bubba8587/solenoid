import {
  useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type PointerEvent as RPointerEvent, type ReactNode,
} from "react";
import { specMapStore } from "../specMapStore";
import {
  buildSuiteNodes, parseArchDoc, parseRulesDoc,
  type SpecDomain, type SpecRule, type SuiteNode,
} from "../specMap";
import { buildArchGraph, type ArchLink } from "../archGraph";
import { Camera, pinchStep } from "../hicCamera";
import { getCablePath, Position } from "../cablePaths";
import rulesMd from "../../../docs/rules.md?raw";
import archMd from "../../../docs/architecture.md?raw";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";
import "./SpecMapView.css";

// The Architecture map overlay: the system drawn in the app's own language — a
// pan/zoom canvas of module-group cards whose cables are the source's REAL
// import dependencies (virtual:arch-deps, scanned at build; aggregated by
// archGraph.ts; laid out by ELK, the same engine as Tidy). The reading pane
// carries the docs' text: a rule's MUST/Why/Origin, a group's module roles, a
// cable's file-level imports. Enforcement rides the cards as a status meter of
// the rules whose suites live there. Everything derives from docs/rules.md,
// docs/architecture.md and the import scan — nothing hand-kept (SSOT-3).
// Unmapped files and suites without a home card stay visible as counts/notes,
// never guessed into a group.

const GRADE_LABEL = { ARR: "author-ruled", INFERRED: "inferred", DEFAULT: "default" } as const;
const STATUS_LABEL = { enforced: "enforced", partial: "partially enforced", unenforced: "unenforced" } as const;
const STATUS_ORDER = ["enforced", "partial", "unenforced"] as const;

const plain = (s: string) => s.replace(/\*\*?/g, "").replace(/`/g, "");
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Display label for an architecture group: the title's parentheticals and
// dash-tail asides stay in the doc; the card carries the name.
const groupLabel = (t: string) => plain(t).replace(/\s*\([^)]*\)/g, "").split(" — ")[0].trim();

type Sel = { kind: "group" | "link" | "rule" | "suite" | "domain"; id: string } | null;
type Card = { title: string; files: string[]; x: number; y: number; w: number; h: number };
type Layout = {
  cards: Card[];
  links: ArchLink[];
  home: Map<string, string>;
  unmapped: string[];
  degree: Map<string, number>;
  failed?: boolean;
};

const CARD_W = 200;
const HEADER_H = 25;
const ROW_H = 13.5;
const SAMPLE_ROWS = 6;
const linkKey = (l: ArchLink) => `${l.from} ${l.to}`;

export function SpecMapView() {
  const open = useSyncExternalStore(specMapStore.subscribe, specMapStore.get);
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<Sel>(null);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<Layout | null>(null);
  const model = useMemo(() => parseRulesDoc(rulesMd), []);
  const groups = useMemo(() => parseArchDoc(archMd), []);
  const suites = useMemo(() => buildSuiteNodes(model, groups), [model, groups]);

  // Rules homed per group (via each suite's home groups) — the card meters.
  const groupRules = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const sn of suites)
      for (const gt of sn.groups) {
        const set = m.get(gt) ?? new Set();
        sn.ruleIds.forEach((id) => set.add(id));
        m.set(gt, set);
      }
    return m;
  }, [suites]);

  const allRules = useMemo(() => model.domains.flatMap((d) => d.rules), [model]);
  const ruleById = (id: string) => allRules.find((r) => r.id === id);

  // Camera: the same pure world↔screen math as the canvas renderers.
  const camRef = useRef(new Camera({ minScale: 0.12, maxScale: 3 }));
  const [cam, setCam] = useState({ k: 1, tx: 0, ty: 0 });
  const syncCam = () => {
    const c = camRef.current;
    setCam({ k: c.scale, tx: c.tx, ty: c.ty });
  };
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fitted = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);
  const moved = useRef(0);

  // Derive the import graph and lay it out — once per session, on first open.
  useEffect(() => {
    if (!open || layout) return;
    let dead = false;
    (async () => {
      let graph;
      try {
        const { default: deps } = await import("virtual:arch-deps");
        graph = buildArchGraph(groups, deps);
      } catch (err) {
        console.error("Architecture map: dependency scan unavailable", err);
        if (!dead)
          setLayout({ cards: [], links: [], home: new Map(), unmapped: [], degree: new Map(), failed: true });
        return;
      }
      const sized = graph.cards.map((c) => {
        const extra = c.files.length > SAMPLE_ROWS ? 1 : 0;
        const rows = Math.min(c.files.length, SAMPLE_ROWS) + extra;
        const meter = groupRules.has(c.title) ? 10 : 4;
        return { ...c, x: 0, y: 0, w: CARD_W, h: HEADER_H + 7 + rows * ROW_H + meter + 6 };
      });
      let placed = sized;
      try {
        const ELK = (await import("elkjs")).default;
        const res = await new ELK().layout({
          id: "root",
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": "RIGHT",
            "elk.layered.spacing.nodeNodeBetweenLayers": "170",
            "elk.spacing.nodeNode": "52",
          },
          children: sized.map((c) => ({ id: c.title, width: c.w, height: c.h })),
          edges: graph.links.map((l, i) => ({ id: `e${i}`, sources: [l.from], targets: [l.to] })),
        });
        const pos = new Map((res.children ?? []).map((ch) => [ch.id, ch]));
        placed = sized.map((c) => ({ ...c, x: pos.get(c.title)?.x ?? 0, y: pos.get(c.title)?.y ?? 0 }));
      } catch (err) {
        console.error("Architecture map: ELK layout failed, using grid", err);
        placed = sized.map((c, i) => ({ ...c, x: (i % 4) * (CARD_W + 90), y: Math.floor(i / 4) * 240 }));
      }
      if (!dead)
        setLayout({ cards: placed, links: graph.links, home: graph.home, unmapped: graph.unmapped, degree: graph.degree });
    })();
    return () => { dead = true; };
  }, [open, layout, groups, groupRules]);

  // Fit the whole graph on first layout.
  useEffect(() => {
    if (!open || !layout?.cards.length || fitted.current) return;
    const el = canvasRef.current;
    if (!el) return;
    const b = {
      minX: Math.min(...layout.cards.map((c) => c.x)),
      minY: Math.min(...layout.cards.map((c) => c.y)),
      maxX: Math.max(...layout.cards.map((c) => c.x + c.w)),
      maxY: Math.max(...layout.cards.map((c) => c.y + c.h)),
    };
    camRef.current.fit(b, el.clientWidth, el.clientHeight, 60);
    fitted.current = true;
    syncCam();
  }, [open, layout]);

  // Wheel zoom needs a non-passive native listener (React's is passive).
  useEffect(() => {
    if (!open) return;
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      camRef.current.zoomBy(Math.exp(-e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
      syncCam();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, layout]);

  useEscapeToClose(() => {
    if (query) setQuery("");
    else if (sel) setSel(null);
    else specMapStore.close();
  }, open);

  // Cable endpoints: spread each card's in/out connections along its edges,
  // sorted by the far card's vertical position so cables fan without crossing
  // at the socket.
  const endpoints = useMemo(() => {
    if (!layout) return new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
    const cardBy = new Map(layout.cards.map((c) => [c.title, c]));
    const pts = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
    const spread = (card: Card, ls: ArchLink[], far: (l: ArchLink) => string, assign: (l: ArchLink, y: number) => void) => {
      const sorted = [...ls].sort((a, b) =>
        (cardBy.get(far(a))?.y ?? 0) - (cardBy.get(far(b))?.y ?? 0) || far(a).localeCompare(far(b)));
      const top = card.y + HEADER_H + 6;
      const span = card.h - HEADER_H - 14;
      sorted.forEach((l, i) => assign(l, top + ((i + 0.5) * span) / sorted.length));
    };
    for (const card of layout.cards) {
      spread(card, layout.links.filter((l) => l.from === card.title), (l) => l.to, (l, y) => {
        const p = pts.get(linkKey(l)) ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
        p.x1 = card.x + card.w;
        p.y1 = y;
        pts.set(linkKey(l), p);
      });
      spread(card, layout.links.filter((l) => l.to === card.title), (l) => l.from, (l, y) => {
        const p = pts.get(linkKey(l)) ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
        p.x2 = card.x;
        p.y2 = y;
        pts.set(linkKey(l), p);
      });
    }
    return pts;
  }, [layout]);

  if (!open) return null;

  // Hover previews, selection sticks; both light the same neighborhood.
  const hot = hover ?? sel;
  const hotSets = (() => {
    if (!hot) return null;
    const g = new Set<string>(), l = new Set<string>();
    const lightGroupsOf = (ids: string[]) => {
      for (const sn of suites) if (ids.some((id) => sn.ruleIds.includes(id))) sn.groups.forEach((x) => g.add(x));
    };
    if (hot.kind === "group") {
      g.add(hot.id);
      for (const ln of layout?.links ?? [])
        if (ln.from === hot.id || ln.to === hot.id) { l.add(linkKey(ln)); g.add(ln.from); g.add(ln.to); }
    } else if (hot.kind === "link") {
      const ln = layout?.links.find((x) => linkKey(x) === hot.id);
      if (ln) { l.add(hot.id); g.add(ln.from); g.add(ln.to); }
    } else if (hot.kind === "rule") {
      lightGroupsOf([hot.id]);
    } else if (hot.kind === "suite") {
      suites.find((s) => s.suite === hot.id)?.groups.forEach((x) => g.add(x));
    } else {
      lightGroupsOf(model.domains.find((d) => d.prefix === hot.id)?.rules.map((r) => r.id) ?? []);
    }
    return { g, l };
  })();

  const cls = (base: string, active: boolean, selected = false) =>
    `${base}${selected ? ` ${base}--selected` : ""}${hotSets ? ` ${base}--${active ? "hot" : "dim"}` : ""}`;
  const isSel = (kind: NonNullable<Sel>["kind"], id: string) =>
    sel !== null && sel.kind === kind && sel.id === id;
  const pick = (kind: NonNullable<Sel>["kind"], id: string) => {
    setSel(isSel(kind, id) ? null : { kind, id });
    setQuery("");
  };
  const centerOn = (title: string) => {
    const card = layout?.cards.find((c) => c.title === title);
    const el = canvasRef.current;
    if (!card || !el) return;
    const c = camRef.current;
    c.tx = el.clientWidth / 2 - (card.x + card.w / 2) * c.scale;
    c.ty = el.clientHeight / 2 - (card.y + card.h / 2) * c.scale;
    syncCam();
  };
  const pickGroup = (title: string) => { pick("group", title); centerOn(title); };
  const hoverProps = (kind: NonNullable<Sel>["kind"], id: string) => ({
    onMouseEnter: () => setHover({ kind, id }),
    onMouseLeave: () => setHover(null),
  });

  // One-finger pan, two-finger pinch; a real drag suppresses the click behind it.
  const onPointerDown = (e: RPointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = null;
    moved.current = 0;
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = canvasRef.current;
    if (!el) return;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const prev = pinch.current;
      const step = pinchStep(a, b, prev?.dist ?? 0, prev?.mid ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      if (prev) {
        const r = el.getBoundingClientRect();
        camRef.current.zoomBy(step.factor, step.mid.x - r.left, step.mid.y - r.top);
        camRef.current.panBy(step.panX, step.panY);
        syncCam();
      }
      pinch.current = { dist: step.dist, mid: step.mid };
      moved.current += 10;
    } else {
      moved.current += Math.abs(e.movementX) + Math.abs(e.movementY);
      camRef.current.panBy(e.movementX, e.movementY);
      syncCam();
    }
  };
  const onPointerEnd = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  };
  const clickedNotDragged = () => moved.current < 6;

  const selDomain = sel?.kind === "domain" ? model.domains.find((d) => d.prefix === sel.id) : undefined;
  const selRule = sel?.kind === "rule" ? ruleById(sel.id) : undefined;
  const selSuite = sel?.kind === "suite" ? suites.find((s) => s.suite === sel.id) : undefined;
  const selGroup = sel?.kind === "group" ? layout?.cards.find((c) => c.title === sel.id) : undefined;
  const selLink = sel?.kind === "link" ? layout?.links.find((l) => linkKey(l) === sel.id) : undefined;
  const selGroupDoc = sel?.kind === "group" ? groups.find((g) => g.title === sel.id) : undefined;

  const ruleRow = (r: SpecRule) => (
    <button key={r.id} className="specmap-row" onClick={() => pick("rule", r.id)} {...hoverProps("rule", r.id)}>
      <span className={`specmap-dot specmap-dot--${r.enforcement}`} />
      <span className="specmap-row__id">{r.id}</span>
      <span className="specmap-row__label">{plain(r.title)}</span>
    </button>
  );
  const suiteRow = (s: SuiteNode) => (
    <button key={s.suite} className="specmap-row" onClick={() => pick("suite", s.suite)} {...hoverProps("suite", s.suite)}>
      <span className="specmap-row__id">{s.suite}</span>
      <span className="specmap-row__label">{s.ruleIds.join(" ")}</span>
    </button>
  );

  const q = query.trim().toLowerCase();
  const found = !q ? null : {
    rules: allRules.filter((r) => `${r.id} ${r.title} ${r.must}`.toLowerCase().includes(q)).slice(0, 20),
    suites: suites.filter((s) => s.suite.toLowerCase().includes(q)).slice(0, 12),
    modules: groups
      .flatMap((g) => g.modules.map((m) => ({ g, m })))
      .filter(({ m }) => `${m.nameCell} ${m.role}`.toLowerCase().includes(q)).slice(0, 14),
    files: (layout ? [...layout.home.keys(), ...layout.unmapped] : [])
      .filter((f) => f.toLowerCase().includes(q)).slice(0, 14),
  };

  const mappedCount = layout ? layout.home.size : 0;

  return (
    <div className="specmap-backdrop" onPointerDown={() => specMapStore.close()}>
      <div className="specmap-panel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="specmap-head">
          <span className="specmap-head__title">Architecture map</span>
          <span className="specmap-head__src">derived from docs/rules.md, docs/architecture.md and the import scan</span>
          <span className="specmap-stat"><span className="specmap-dot specmap-dot--enforced" />{model.summary.enforced} enforced</span>
          {model.summary.partial > 0 && (
            <span className="specmap-stat"><span className="specmap-dot specmap-dot--partial" />{model.summary.partial} partial</span>
          )}
          {model.summary.unenforced > 0 && (
            <span className="specmap-stat"><span className="specmap-dot specmap-dot--unenforced" />{model.summary.unenforced} unenforced</span>
          )}
          <input
            className="specmap-search"
            type="text"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              setQuery("");
              e.currentTarget.blur();
            }}
          />
          <button className="specmap-close" onClick={() => specMapStore.close()} title="Close (Esc)" aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="specmap-body">
          <div
            className="specmap-canvas"
            ref={canvasRef}
            style={{
              backgroundSize: `${24 * cam.k}px ${24 * cam.k}px`,
              backgroundPosition: `${cam.tx}px ${cam.ty}px`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            {layout?.failed ? (
              <div className="specmap-canvas__note">Dependency scan unavailable.</div>
            ) : layout ? (
              <svg className="specmap-world" onClick={() => { if (clickedNotDragged()) setSel(null); }}>
                <g transform={`translate(${cam.tx} ${cam.ty}) scale(${cam.k})`}>
                  {layout.links.map((l) => {
                    const p = endpoints.get(linkKey(l))!;
                    const d = getCablePath("spline", {
                      sourceX: p.x1, sourceY: p.y1, sourcePosition: Position.Right,
                      targetX: p.x2, targetY: p.y2, targetPosition: Position.Left,
                    });
                    const active = hotSets?.l.has(linkKey(l)) ?? false;
                    return (
                      <g
                        key={linkKey(l)}
                        className={cls("specmap-cable", active, isSel("link", linkKey(l)))}
                        onClick={(e) => { e.stopPropagation(); if (clickedNotDragged()) pick("link", linkKey(l)); }}
                        {...hoverProps("link", linkKey(l))}
                      >
                        <path className="specmap-cable__hit" d={d} />
                        <path
                          className="specmap-cable__stroke"
                          d={d}
                          strokeWidth={1 + Math.min(2.4, Math.log2(l.weight + 1) * 0.55)}
                        />
                      </g>
                    );
                  })}

                  {layout.cards.map((c) => {
                    const homedRules = [...(groupRules.get(c.title) ?? [])]
                      .map(ruleById).filter((r): r is SpecRule => !!r);
                    const rows = c.files.slice(0, SAMPLE_ROWS);
                    const more = c.files.length - rows.length;
                    const meterW = c.w - 20;
                    let mx = 10;
                    return (
                      <g
                        key={c.title}
                        className={cls("specmap-card", hotSets?.g.has(c.title) ?? false, isSel("group", c.title))}
                        transform={`translate(${c.x}, ${c.y})`}
                        onClick={(e) => { e.stopPropagation(); if (clickedNotDragged()) pick("group", c.title); }}
                        {...hoverProps("group", c.title)}
                      >
                        <rect className="specmap-card__box" width={c.w} height={c.h} rx={8} />
                        <path
                          className="specmap-card__header"
                          d={`M 0 8 A 8 8 0 0 1 8 0 H ${c.w - 8} A 8 8 0 0 1 ${c.w} 8 V ${HEADER_H} H 0 Z`}
                        />
                        <line className="specmap-card__divider" x1={0} y1={HEADER_H} x2={c.w} y2={HEADER_H} />
                        <text className="specmap-card__title" x={10} y={17}>{trunc(groupLabel(c.title), 24)}</text>
                        <text className="specmap-card__count" x={c.w - 10} y={17} textAnchor="end">{c.files.length}</text>
                        {rows.map((f, i) => (
                          <text key={f} className="specmap-card__row" x={10} y={HEADER_H + 16 + i * ROW_H}>
                            {trunc(f, 30)}
                          </text>
                        ))}
                        {more > 0 && (
                          <text className="specmap-card__more" x={10} y={HEADER_H + 16 + rows.length * ROW_H}>
                            +{more} more
                          </text>
                        )}
                        {homedRules.length > 0 && STATUS_ORDER.map((st) => {
                          const w = (homedRules.filter((r) => r.enforcement === st).length / homedRules.length) * meterW;
                          const x = mx;
                          mx += w;
                          return w > 0 && (
                            <rect key={st} className={`specmap-meter specmap-meter--${st}`}
                              x={x} y={c.h - 9} width={w} height={2.5} />
                          );
                        })}
                        {layout.links.filter((l) => l.to === c.title).map((l) => {
                          const p = endpoints.get(linkKey(l))!;
                          return <circle key={`i${linkKey(l)}`} className="specmap-sock" cx={0} cy={p.y2 - c.y} r={5.5} />;
                        })}
                        {layout.links.filter((l) => l.from === c.title).map((l) => {
                          const p = endpoints.get(linkKey(l))!;
                          return <circle key={`o${linkKey(l)}`} className="specmap-sock" cx={c.w} cy={p.y1 - c.y} r={5.5} />;
                        })}
                      </g>
                    );
                  })}
                </g>
              </svg>
            ) : (
              <div className="specmap-canvas__note">Loading…</div>
            )}
          </div>

          <div className="specmap-pane">
            {found ? (
              <>
                {found.rules.length > 0 && <div className="specmap-pane__label">Rules</div>}
                {found.rules.map(ruleRow)}
                {found.suites.length > 0 && <div className="specmap-pane__label">Suites</div>}
                {found.suites.map((s) => (
                  <button key={s.suite} className="specmap-row" onClick={() => pick("suite", s.suite)} {...hoverProps("suite", s.suite)}>
                    <span className="specmap-row__id">{s.suite}</span>
                  </button>
                ))}
                {found.modules.length > 0 && <div className="specmap-pane__label">Modules</div>}
                {found.modules.map(({ g, m }) => (
                  <button key={`${g.title}/${m.name}`} className="specmap-row" onClick={() => pickGroup(g.title)} {...hoverProps("group", g.title)}>
                    <span className="specmap-row__id">{m.name}</span>
                    <span className="specmap-row__label">{groupLabel(g.title)}</span>
                  </button>
                ))}
                {found.files.length > 0 && <div className="specmap-pane__label">Files</div>}
                {found.files.map((f) => {
                  const home = layout?.home.get(f);
                  return home ? (
                    <button key={f} className="specmap-row" onClick={() => pickGroup(home)} {...hoverProps("group", home)}>
                      <span className="specmap-row__id">{f}</span>
                      <span className="specmap-row__label">{groupLabel(home)}</span>
                    </button>
                  ) : (
                    <div key={f} className="specmap-row specmap-row--inert">
                      <span className="specmap-row__id">{f}</span>
                      <span className="specmap-row__label">unmapped</span>
                    </div>
                  );
                })}
                {found.rules.length + found.suites.length + found.modules.length + found.files.length === 0 && (
                  <p className="specmap-pane__note">No matches.</p>
                )}
              </>
            ) : selRule ? (
              <RulePane
                rule={selRule}
                domain={model.domains.find((d) => d.prefix === selRule.domain)!}
                pick={pick}
                hoverProps={hoverProps}
                homeOf={(f) => layout?.home.get(f)}
                pickGroup={pickGroup}
              />
            ) : selDomain ? (
              <>
                <div className="specmap-pane__head">
                  <span className="specmap-pane__name">{selDomain.prefix}</span>
                  <span className="specmap-pane__meta">{plain(selDomain.title)}</span>
                </div>
                <p className="specmap-pane__text">{plain(selDomain.blurb)}</p>
                {selDomain.rules.map(ruleRow)}
              </>
            ) : selSuite ? (
              <>
                <div className="specmap-pane__head">
                  <span className="specmap-pane__name specmap-pane__name--wrap">{selSuite.suite}</span>
                </div>
                {selSuite.groups.length ? (
                  <div className="specmap-chips">
                    {selSuite.groups.map((gt) => (
                      <button key={gt} className="specmap-chip" onClick={() => pickGroup(gt)} {...hoverProps("group", gt)}>
                        {groupLabel(gt)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="specmap-pane__note">Home module not on a card.</p>
                )}
                <div className="specmap-pane__label">Cited by</div>
                {selSuite.ruleIds.map((id) => {
                  const r = ruleById(id);
                  return r ? ruleRow(r) : null;
                })}
              </>
            ) : selLink ? (
              <>
                <div className="specmap-pane__head">
                  <span className="specmap-pane__name specmap-pane__name--sans">
                    {groupLabel(selLink.from)} → {groupLabel(selLink.to)}
                  </span>
                  <span className="specmap-pane__meta">
                    {selLink.weight} {selLink.weight === 1 ? "import" : "imports"}
                  </span>
                </div>
                {selLink.pairs.slice(0, 60).map(([a, b]) => (
                  <div key={`${a}>${b}`} className="specmap-mod">
                    <div className="specmap-mod__name">{a}</div>
                    <div className="specmap-mod__role">→ {b}</div>
                  </div>
                ))}
                {selLink.pairs.length > 60 && (
                  <p className="specmap-pane__note">+{selLink.pairs.length - 60} more</p>
                )}
              </>
            ) : selGroup ? (
              <GroupPane
                card={selGroup}
                doc={selGroupDoc}
                links={layout?.links ?? []}
                suites={suites.filter((s) => s.groups.includes(selGroup.title))}
                pick={pick}
                hoverProps={hoverProps}
                suiteRow={suiteRow}
              />
            ) : (
              <>
                <p className="specmap-pane__text">
                  Each card is a module group from architecture.md; cables are the import
                  dependencies between them, scanned from the source.
                </p>
                <div className="specmap-pane__stats">
                  <span>{model.ruleCount} rules · {model.domains.length} domains</span>
                  <span>{suites.length} cited suites</span>
                  {layout && !layout.failed && (
                    <span>{mappedCount} files on {layout.cards.length} cards · {layout.unmapped.length} unmapped</span>
                  )}
                </div>
                <div className="specmap-chips specmap-chips--domains">
                  {model.domains.map((d) => (
                    <button key={d.prefix} className="specmap-chip" onClick={() => pick("domain", d.prefix)} {...hoverProps("domain", d.prefix)}>
                      {d.prefix} {d.rules.length}
                    </button>
                  ))}
                </div>
                {model.summary.unenforced > 0 && <div className="specmap-pane__label">Unenforced</div>}
                {allRules.filter((r) => r.enforcement === "unenforced").map(ruleRow)}
                {model.summary.partial > 0 && <div className="specmap-pane__label">Partially enforced</div>}
                {allRules.filter((r) => r.enforcement === "partial").map(ruleRow)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RulePane({ rule, domain, pick, hoverProps, homeOf, pickGroup }: {
  rule: SpecRule;
  domain: SpecDomain;
  pick: (kind: NonNullable<Sel>["kind"], id: string) => void;
  hoverProps: (kind: NonNullable<Sel>["kind"], id: string) => object;
  homeOf: (file: string) => string | undefined;
  pickGroup: (title: string) => void;
}) {
  return (
    <>
      <button className="specmap-crumb" onClick={() => pick("domain", domain.prefix)} {...hoverProps("domain", domain.prefix)}>
        {domain.prefix} · {plain(domain.title)}
      </button>
      <div className="specmap-pane__head">
        <span className="specmap-pane__name">{rule.id}</span>
        <span className="specmap-pane__meta">
          <span className={`specmap-dot specmap-dot--${rule.enforcement}`} /> {STATUS_LABEL[rule.enforcement]}
        </span>
        <span className="specmap-pane__meta">{GRADE_LABEL[rule.grade]}</span>
      </div>
      <div className="specmap-pane__title">{plain(rule.title)}</div>
      <p className="specmap-pane__text specmap-pane__text--must">{plain(rule.must)}</p>
      {rule.why && (<><div className="specmap-pane__label">Why</div><p className="specmap-pane__text">{plain(rule.why)}</p></>)}
      {rule.origin && (<><div className="specmap-pane__label">Origin</div><p className="specmap-pane__text">{plain(rule.origin)}</p></>)}
      {rule.exceptions && (<><div className="specmap-pane__label">Exceptions</div><p className="specmap-pane__text">{plain(rule.exceptions)}</p></>)}
      <div className="specmap-pane__label">Enforced by</div>
      {rule.tests.length ? (
        <div className="specmap-chips">
          {rule.tests.map((t) => (
            <button key={t} className="specmap-chip" onClick={() => pick("suite", t)} {...hoverProps("suite", t)}>
              {t}
            </button>
          ))}
        </div>
      ) : (
        <p className="specmap-pane__note">No enforcing test.</p>
      )}
      {rule.moduleRefs.length > 0 && (
        <>
          <div className="specmap-pane__label">Cited modules</div>
          <div className="specmap-chips">
            {rule.moduleRefs.map((f) => {
              const home = homeOf(f);
              return home ? (
                <button key={f} className="specmap-chip" onClick={() => pickGroup(home)} {...hoverProps("group", home)}>
                  {f}
                </button>
              ) : (
                <span key={f} className="specmap-chip specmap-chip--inert">{f}</span>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function GroupPane({ card, doc, links, suites, pick, hoverProps, suiteRow }: {
  card: Card;
  doc: { modules: { name: string; nameCell: string; role: string }[] } | undefined;
  links: ArchLink[];
  suites: SuiteNode[];
  pick: (kind: NonNullable<Sel>["kind"], id: string) => void;
  hoverProps: (kind: NonNullable<Sel>["kind"], id: string) => object;
  suiteRow: (s: SuiteNode) => ReactNode;
}) {
  const outs = links.filter((l) => l.from === card.title);
  const ins = links.filter((l) => l.to === card.title);
  const tabled = doc?.modules ?? [];
  const tabledNames = new Set(tabled.flatMap((m) => m.nameCell.match(/[\w./-]+\.tsx?/g) ?? []));
  const rest = card.files.filter((f) => !tabledNames.has(f) && !tabledNames.has(f.split("/").pop()!));
  const shown = rest.slice(0, 40);
  return (
    <>
      <div className="specmap-pane__head">
        <span className="specmap-pane__name specmap-pane__name--sans">{groupLabel(card.title)}</span>
        <span className="specmap-pane__meta">{card.files.length} {card.files.length === 1 ? "file" : "files"}</span>
      </div>
      {outs.length > 0 && (
        <>
          <div className="specmap-pane__label">Imports</div>
          <div className="specmap-chips">
            {outs.map((l) => (
              <button key={linkKey(l)} className="specmap-chip" onClick={() => pick("link", linkKey(l))} {...hoverProps("link", linkKey(l))}>
                {groupLabel(l.to)} {l.weight}
              </button>
            ))}
          </div>
        </>
      )}
      {ins.length > 0 && (
        <>
          <div className="specmap-pane__label">Imported by</div>
          <div className="specmap-chips">
            {ins.map((l) => (
              <button key={linkKey(l)} className="specmap-chip" onClick={() => pick("link", linkKey(l))} {...hoverProps("link", linkKey(l))}>
                {groupLabel(l.from)} {l.weight}
              </button>
            ))}
          </div>
        </>
      )}
      {suites.length > 0 && (
        <>
          <div className="specmap-pane__label">Test suites</div>
          {suites.map(suiteRow)}
        </>
      )}
      {tabled.length > 0 && <div className="specmap-pane__label">Modules</div>}
      {tabled.map((m) => (
        <div key={m.name} className="specmap-mod">
          <div className="specmap-mod__name">{m.nameCell}</div>
          <div className="specmap-mod__role">{plain(m.role)}</div>
        </div>
      ))}
      {rest.length > 0 && <div className="specmap-pane__label">{tabled.length ? "Other files" : "Files"}</div>}
      {shown.map((f) => (
        <div key={f} className="specmap-mod specmap-mod--bare">
          <div className="specmap-mod__name">{f}</div>
        </div>
      ))}
      {rest.length > shown.length && <p className="specmap-pane__note">+{rest.length - shown.length} more</p>}
    </>
  );
}
