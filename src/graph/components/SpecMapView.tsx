import { useMemo, useState, useSyncExternalStore } from "react";
import { specMapStore } from "../specMapStore";
import {
  buildSuiteNodes, parseArchDoc, parseRulesDoc,
  type ArchGroup, type SpecDomain, type SpecRule, type SuiteNode,
} from "../specMap";
import rulesMd from "../../../docs/rules.md?raw";
import archMd from "../../../docs/architecture.md?raw";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";
import "./SpecMapView.css";

// The Architecture map overlay: the enforcement web as a three-layer graph
// (rule domains → cited test suites → the architecture.md module groups their
// home modules are tabled under) beside a reading pane that carries the actual
// spec text — a rule's MUST/Why/Origin, a group's module roles — so the map is
// a browser, not just a picture. A suite with no right-hand edge is real
// information: its module isn't in an architecture table. Everything derives
// from the two docs, imported ?raw and parsed by specMap.ts.

const GRADE_LABEL = { ARR: "author-ruled", INFERRED: "inferred", DEFAULT: "default" } as const;
const STATUS_LABEL = { enforced: "enforced", partial: "partially enforced", unenforced: "unenforced" } as const;
const STATUS_ORDER = ["enforced", "partial", "unenforced"] as const;

const plain = (s: string) => s.replace(/\*\*?/g, "").replace(/`/g, "");
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Display label for an architecture group: the title's parentheticals and
// dash-tail asides stay in the doc; the card carries the name.
const groupLabel = (t: string) => plain(t).replace(/\s*\([^)]*\)/g, "").split(" — ")[0].trim();

type Sel = { kind: "domain" | "rule" | "suite" | "group"; id: string } | null;

// Fixed layout space in real pixels (no viewBox scaling) so the type stays at
// its true dense size; the canvas scrolls when the panel is smaller.
const VIEW_W = 1080;
const CARD_W = 204;
const CARD_H = 48;
const PAD_Y = 16;
const LEFT_X = 20;
const RIGHT_X = VIEW_W - CARD_W - 20;
const SUITE_CX = VIEW_W / 2;
const SUITE_HALF = 130;
const SUITE_ROW = 13;

export function SpecMapView() {
  const open = useSyncExternalStore(specMapStore.subscribe, specMapStore.get);
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<Sel>(null);
  const [query, setQuery] = useState("");
  const model = useMemo(() => parseRulesDoc(rulesMd), []);
  const groups = useMemo(() => parseArchDoc(archMd), []);
  const suites = useMemo(() => buildSuiteNodes(model, groups), [model, groups]);

  useEscapeToClose(() => {
    if (query) setQuery("");
    else if (sel) setSel(null);
    else specMapStore.close();
  }, open);
  if (!open) return null;

  const allRules = model.domains.flatMap((d) => d.rules);
  const ruleById = (id: string) => allRules.find((r) => r.id === id);
  const moduleHome = (file: string) =>
    groups.find((g) => g.modules.some((m) => m.name === file || m.nameCell.includes(file)));
  const moduleCount = groups.reduce((n, g) => n + g.modules.length, 0);

  const H = Math.max(
    PAD_Y * 2 + suites.length * SUITE_ROW,
    PAD_Y * 2 + Math.max(model.domains.length, groups.length) * (CARD_H + 10),
  );
  // Cards spread across the full height so edge fans stay shallow.
  const spreadY = (i: number, count: number) =>
    count === 1 ? (H - CARD_H) / 2 : PAD_Y + (i * (H - PAD_Y * 2 - CARD_H)) / (count - 1);
  const domainY = new Map(model.domains.map((d, i) => [d.prefix, spreadY(i, model.domains.length)]));
  const groupY = new Map(groups.map((g, i) => [g.title, spreadY(i, groups.length)]));
  const suiteY = new Map(suites.map((s, i) => [s.suite, PAD_Y + i * SUITE_ROW + SUITE_ROW / 2]));

  // Hover previews, selection sticks; both light the same neighborhood. A rule
  // selection narrows its domain's fan to exactly that rule's suites.
  const hot = hover ?? sel;
  const hotSets = (() => {
    if (!hot) return null;
    const d = new Set<string>(), s = new Set<string>(), g = new Set<string>();
    const lightSuite = (sn: SuiteNode) => { s.add(sn.suite); sn.groups.forEach((x) => g.add(x)); };
    if (hot.kind === "domain") {
      d.add(hot.id);
      for (const sn of suites) if (sn.domains.includes(hot.id)) lightSuite(sn);
    } else if (hot.kind === "rule") {
      const r = ruleById(hot.id);
      if (r) {
        d.add(r.domain);
        for (const sn of suites) if (sn.ruleIds.includes(r.id)) lightSuite(sn);
      }
    } else if (hot.kind === "suite") {
      const sn = suites.find((x) => x.suite === hot.id);
      if (sn) { lightSuite(sn); sn.domains.forEach((x) => d.add(x)); }
    } else {
      g.add(hot.id);
      for (const sn of suites) if (sn.groups.includes(hot.id)) { s.add(sn.suite); sn.domains.forEach((x) => d.add(x)); }
    }
    return { d, s, g };
  })();

  const cls = (base: string, active: boolean, selected = false) =>
    `${base}${selected ? ` ${base}--selected` : ""}${hotSets ? ` ${base}--${active ? "hot" : "dim"}` : ""}`;
  const isSel = (kind: NonNullable<Sel>["kind"], id: string) =>
    sel !== null && sel.kind === kind && sel.id === id;
  const pick = (kind: NonNullable<Sel>["kind"], id: string) => {
    setSel(isSel(kind, id) ? null : { kind, id });
    setQuery("");
  };
  const hoverProps = (kind: NonNullable<Sel>["kind"], id: string) => ({
    onMouseEnter: () => setHover({ kind, id }),
    onMouseLeave: () => setHover(null),
  });

  const edge = (x1: number, y1: number, x2: number, y2: number) =>
    `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;

  const selDomain = sel?.kind === "domain" ? model.domains.find((d) => d.prefix === sel.id) : undefined;
  const selRule = sel?.kind === "rule" ? ruleById(sel.id) : undefined;
  const selSuite = sel?.kind === "suite" ? suites.find((s) => s.suite === sel.id) : undefined;
  const selGroup = sel?.kind === "group" ? groups.find((g) => g.title === sel.id) : undefined;

  const ruleRow = (r: SpecRule) => (
    <button key={r.id} className="specmap-row" onClick={() => pick("rule", r.id)} {...hoverProps("rule", r.id)}>
      <span className={`specmap-dot specmap-dot--${r.enforcement}`} />
      <span className="specmap-row__id">{r.id}</span>
      <span className="specmap-row__label">{plain(r.title)}</span>
    </button>
  );

  const q = query.trim().toLowerCase();
  const found = !q ? null : {
    rules: allRules.filter((r) =>
      `${r.id} ${r.title} ${r.must}`.toLowerCase().includes(q)).slice(0, 20),
    suites: suites.filter((s) => s.suite.toLowerCase().includes(q)).slice(0, 12),
    modules: groups
      .flatMap((g) => g.modules.map((m) => ({ g, m })))
      .filter(({ m }) => `${m.nameCell} ${m.role}`.toLowerCase().includes(q)).slice(0, 20),
  };

  return (
    <div className="specmap-backdrop" onPointerDown={() => specMapStore.close()}>
      <div className="specmap-panel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="specmap-head">
          <span className="specmap-head__title">Architecture map</span>
          <span className="specmap-head__src">derived from docs/rules.md and docs/architecture.md</span>
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
          <div className="specmap-canvas">
            <svg className="specmap-svg" width={VIEW_W} height={H} onClick={() => setSel(null)}>
              {suites.map((s) => {
                const sy = suiteY.get(s.suite)!;
                const active = hotSets?.s.has(s.suite) ?? false;
                return (
                  <g key={`e-${s.suite}`}>
                    {s.domains.map((dp) => (
                      <path
                        key={dp}
                        className={cls("specmap-edge", active && (hotSets?.d.has(dp) ?? false))}
                        d={edge(LEFT_X + CARD_W, domainY.get(dp)! + CARD_H / 2, SUITE_CX - SUITE_HALF, sy)}
                      />
                    ))}
                    {s.groups.map((gt) => (
                      <path
                        key={gt}
                        className={cls("specmap-edge", active && (hotSets?.g.has(gt) ?? false))}
                        d={edge(SUITE_CX + SUITE_HALF, sy, RIGHT_X, groupY.get(gt)! + CARD_H / 2)}
                      />
                    ))}
                  </g>
                );
              })}

              {model.domains.map((d) => {
                const y = domainY.get(d.prefix)!;
                const meterW = CARD_W - 24;
                let mx = 12;
                return (
                  <g
                    key={d.prefix}
                    className={cls("specmap-node", hotSets?.d.has(d.prefix) ?? false, isSel("domain", d.prefix))}
                    transform={`translate(${LEFT_X}, ${y})`}
                    onClick={(e) => { e.stopPropagation(); pick("domain", d.prefix); }}
                    {...hoverProps("domain", d.prefix)}
                  >
                    <rect className="specmap-node__box" width={CARD_W} height={CARD_H} rx={8} />
                    <text className="specmap-node__id" x={12} y={19}>{d.prefix}</text>
                    <text className="specmap-node__count" x={CARD_W - 12} y={19} textAnchor="end">
                      {d.rules.length} {d.rules.length === 1 ? "rule" : "rules"}
                    </text>
                    <text className="specmap-node__sub" x={12} y={34}>{trunc(plain(d.title), 32)}</text>
                    {STATUS_ORDER.map((st) => {
                      const w = (d.rules.filter((r) => r.enforcement === st).length / d.rules.length) * meterW;
                      const x = mx;
                      mx += w;
                      return w > 0 && (
                        <rect key={st} className={`specmap-meter specmap-meter--${st}`}
                          x={x} y={39.5} width={w} height={2.5} />
                      );
                    })}
                  </g>
                );
              })}

              {suites.map((s) => {
                const sy = suiteY.get(s.suite)!;
                return (
                  <g
                    key={s.suite}
                    className={cls("specmap-suitenode", hotSets?.s.has(s.suite) ?? false, isSel("suite", s.suite))}
                    onClick={(e) => { e.stopPropagation(); pick("suite", s.suite); }}
                    {...hoverProps("suite", s.suite)}
                  >
                    <rect
                      className="specmap-suitenode__hit"
                      x={SUITE_CX - SUITE_HALF} y={sy - SUITE_ROW / 2}
                      width={SUITE_HALF * 2} height={SUITE_ROW}
                    />
                    <text className="specmap-suitenode__label" x={SUITE_CX} y={sy + 3} textAnchor="middle">
                      {s.suite}
                    </text>
                  </g>
                );
              })}

              {groups.map((g) => {
                const y = groupY.get(g.title)!;
                return (
                  <g
                    key={g.title}
                    className={cls("specmap-node", hotSets?.g.has(g.title) ?? false, isSel("group", g.title))}
                    transform={`translate(${RIGHT_X}, ${y})`}
                    onClick={(e) => { e.stopPropagation(); pick("group", g.title); }}
                    {...hoverProps("group", g.title)}
                  >
                    <rect className="specmap-node__box" width={CARD_W} height={CARD_H} rx={8} />
                    <text className="specmap-node__title" x={12} y={20}>{trunc(groupLabel(g.title), 30)}</text>
                    <text className="specmap-node__sub" x={12} y={37}>
                      {g.modules.length} {g.modules.length === 1 ? "file" : "files"}
                    </text>
                  </g>
                );
              })}
            </svg>
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
                  <button key={`${g.title}/${m.name}`} className="specmap-row" onClick={() => pick("group", g.title)} {...hoverProps("group", g.title)}>
                    <span className="specmap-row__id">{m.name}</span>
                    <span className="specmap-row__label">{groupLabel(g.title)}</span>
                  </button>
                ))}
                {found.rules.length + found.suites.length + found.modules.length === 0 && (
                  <p className="specmap-pane__note">No matches.</p>
                )}
              </>
            ) : selRule ? (
              <RulePane
                rule={selRule}
                domain={model.domains.find((d) => d.prefix === selRule.domain)!}
                pick={pick}
                hoverProps={hoverProps}
                moduleHome={moduleHome}
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
                      <button key={gt} className="specmap-chip" onClick={() => pick("group", gt)} {...hoverProps("group", gt)}>
                        {groupLabel(gt)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="specmap-pane__note">Home module not in an architecture table.</p>
                )}
                <div className="specmap-pane__label">Cited by</div>
                {selSuite.ruleIds.map((id) => {
                  const r = ruleById(id);
                  return r ? ruleRow(r) : null;
                })}
              </>
            ) : selGroup ? (
              <>
                <div className="specmap-pane__head">
                  <span className="specmap-pane__name specmap-pane__name--sans">{groupLabel(selGroup.title)}</span>
                  <span className="specmap-pane__meta">
                    {selGroup.modules.length} {selGroup.modules.length === 1 ? "file" : "files"}
                  </span>
                </div>
                {selGroup.modules.map((m) => (
                  <div key={m.name} className="specmap-mod">
                    <div className="specmap-mod__name">{m.nameCell}</div>
                    <div className="specmap-mod__role">{plain(m.role)}</div>
                  </div>
                ))}
              </>
            ) : (
              <>
                <p className="specmap-pane__text">
                  An edge is a citation: the rule names the suite that enforces it, and the
                  suite sits with the module group its code lives in.
                </p>
                <div className="specmap-pane__stats">
                  <span>{model.ruleCount} rules · {model.domains.length} domains</span>
                  <span>{suites.length} cited suites</span>
                  <span>{moduleCount} files · {groups.length} groups</span>
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

function RulePane({ rule, domain, pick, hoverProps, moduleHome }: {
  rule: SpecRule;
  domain: SpecDomain;
  pick: (kind: NonNullable<Sel>["kind"], id: string) => void;
  hoverProps: (kind: NonNullable<Sel>["kind"], id: string) => object;
  moduleHome: (file: string) => ArchGroup | undefined;
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
              const home = moduleHome(f);
              return home ? (
                <button key={f} className="specmap-chip" onClick={() => pick("group", home.title)} {...hoverProps("group", home.title)}>
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
