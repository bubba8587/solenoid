import { useMemo, useState, useSyncExternalStore } from "react";
import { specMapStore } from "../specMapStore";
import { parseArchDoc, parseRulesDoc, testCitationIndex, type SpecRule } from "../specMap";
import rulesMd from "../../../docs/rules.md?raw";
import archMd from "../../../docs/architecture.md?raw";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";
import "./SpecMapView.css";

// The Architecture map overlay: the enforcement web as a three-layer graph.
// Left nodes are docs/rules.md domains, middle nodes are every test suite the
// rules cite (an edge IS an `Enforced by:` line), right nodes are the
// docs/architecture.md module groups a suite's home module is tabled under.
// A suite with no right-hand edge is real information: its module isn't in an
// architecture table (nodes/, packs/, prose-mapped sections). Everything
// derives from the two docs, imported ?raw and parsed by specMap.ts.

const GRADE_LABEL = { ARR: "author-ruled", INFERRED: "inferred", DEFAULT: "default" } as const;

const plain = (s: string) => s.replace(/`/g, "");
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const stemOf = (t: string) => t.replace(/\.test\.ts$/, "").split("/").pop()!;

type Sel = { kind: "domain" | "suite" | "group"; id: string } | null;
type SuiteNode = { suite: string; ruleIds: string[]; domains: string[]; groups: string[] };

// Fixed layout space in real pixels (no viewBox scaling) so the type stays at
// its true dense size; the container scrolls when the panel is smaller.
const VIEW_W = 1160;
const CARD_W = 216;
const CARD_H = 48;
const PAD_Y = 16;
const LEFT_X = 24;
const RIGHT_X = VIEW_W - CARD_W - 24;
const SUITE_CX = VIEW_W / 2;
const SUITE_HALF = 122;
const SUITE_ROW = 13;

function ruleTooltip(r: SpecRule): string {
  const enforced = r.tests.length ? `Enforced by: ${r.tests.join(", ")}` : "No enforcing test";
  const tags = GRADE_LABEL[r.grade] + (r.hasExceptions ? ", has exceptions" : "");
  return `${plain(r.title)} (${tags})\n\n${plain(r.must)}\n\n${enforced}`;
}

export function SpecMapView() {
  const open = useSyncExternalStore(specMapStore.subscribe, specMapStore.get);
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<Sel>(null);
  const model = useMemo(() => parseRulesDoc(rulesMd), []);
  const groups = useMemo(() => parseArchDoc(archMd), []);

  // One node per cited suite, in doc order (the citation index walks the rules
  // in document order). Suite → group: the suite's stem names its home module.
  const suites: SuiteNode[] = useMemo(() => {
    return [...testCitationIndex(model)].map(([suite, ruleIds]) => {
      const stem = stemOf(suite);
      return {
        suite,
        ruleIds,
        domains: [...new Set(ruleIds.map((id) => id.split("-")[0]))],
        groups: groups
          .filter((g) => g.modules.some((m) =>
            m.name === `${stem}.ts` || m.name.startsWith(`${stem}.`) || m.nameCell.includes(`${stem}.`)))
          .map((g) => g.title),
      };
    });
  }, [model, groups]);

  useEscapeToClose(() => specMapStore.close(), open);
  if (!open) return null;

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

  // Hover previews, selection sticks; both light the same 2-hop neighborhood.
  const hot = hover ?? sel;
  const hotSets = (() => {
    if (!hot) return null;
    const d = new Set<string>(), s = new Set<string>(), g = new Set<string>();
    if (hot.kind === "domain") {
      d.add(hot.id);
      for (const sn of suites) if (sn.domains.includes(hot.id)) { s.add(sn.suite); sn.groups.forEach((x) => g.add(x)); }
    } else if (hot.kind === "suite") {
      const sn = suites.find((x) => x.suite === hot.id);
      if (sn) { s.add(sn.suite); sn.domains.forEach((x) => d.add(x)); sn.groups.forEach((x) => g.add(x)); }
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
  const pick = (kind: NonNullable<Sel>["kind"], id: string) =>
    setSel(isSel(kind, id) ? null : { kind, id });

  const selDomain = sel?.kind === "domain" ? model.domains.find((d) => d.prefix === sel.id) : undefined;
  const selSuite = sel?.kind === "suite" ? suites.find((s) => s.suite === sel.id) : undefined;
  const selGroup = sel?.kind === "group" ? groups.find((g) => g.title === sel.id) : undefined;
  const allRules = model.domains.flatMap((d) => d.rules);
  const moduleCount = groups.reduce((n, g) => n + g.modules.length, 0);

  const edge = (x1: number, y1: number, x2: number, y2: number) =>
    `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;

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
          <span className="specmap-stat">{suites.length} suites · {moduleCount} files</span>
          <button className="specmap-close" onClick={() => specMapStore.close()} title="Close (Esc)" aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

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
              const statuses = (["enforced", "partial", "unenforced"] as const)
                .filter((st) => d.rules.some((r) => r.enforcement === st));
              return (
                <g
                  key={d.prefix}
                  className={cls("specmap-node", hotSets?.d.has(d.prefix) ?? false, isSel("domain", d.prefix))}
                  transform={`translate(${LEFT_X}, ${y})`}
                  onClick={(e) => { e.stopPropagation(); pick("domain", d.prefix); }}
                  onMouseEnter={() => setHover({ kind: "domain", id: d.prefix })}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect className="specmap-node__box" width={CARD_W} height={CARD_H} rx={8} />
                  <text className="specmap-node__id" x={12} y={20}>{d.prefix}</text>
                  <text className="specmap-node__count" x={CARD_W - 12} y={20} textAnchor="end">
                    {d.rules.length} {d.rules.length === 1 ? "rule" : "rules"}
                  </text>
                  <text className="specmap-node__sub" x={12} y={37}>{trunc(plain(d.title), 32)}</text>
                  {statuses.map((st, i) => (
                    <circle key={st} className={`specmap-nodedot specmap-nodedot--${st}`}
                      cx={CARD_W - 16 - i * 10} cy={33} r={3.5} />
                  ))}
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
                  onMouseEnter={() => setHover({ kind: "suite", id: s.suite })}
                  onMouseLeave={() => setHover(null)}
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
                  onMouseEnter={() => setHover({ kind: "group", id: g.title })}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect className="specmap-node__box" width={CARD_W} height={CARD_H} rx={8} />
                  <text className="specmap-node__title" x={12} y={20}>{trunc(plain(g.title), 30)}</text>
                  <text className="specmap-node__sub" x={12} y={37}>
                    {g.modules.length} {g.modules.length === 1 ? "file" : "files"}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {selDomain && (
          <div className="specmap-detail">
            <div className="specmap-detail__head">
              <span className="specmap-detail__name">{selDomain.prefix}</span>
              <span className="specmap-detail__sub">{plain(selDomain.title)}</span>
            </div>
            <p className="specmap-detail__blurb">{plain(selDomain.blurb)}</p>
            <div className="specmap-detail__chips">
              {selDomain.rules.map((r) => (
                <span key={r.id} className="specmap-chip" title={ruleTooltip(r)}>
                  <span className={`specmap-dot specmap-dot--${r.enforcement}`} />
                  {r.id}
                </span>
              ))}
            </div>
          </div>
        )}
        {selSuite && (
          <div className="specmap-detail">
            <div className="specmap-detail__head">
              <span className="specmap-detail__name">{selSuite.suite}</span>
              <span className="specmap-detail__sub">
                {selSuite.groups.length ? `home group: ${selSuite.groups.join(", ")}` : "home module not in an architecture table"}
              </span>
            </div>
            <div className="specmap-detail__chips">
              {selSuite.ruleIds.map((id) => {
                const r = allRules.find((x) => x.id === id);
                return (
                  <span key={id} className="specmap-chip" title={r ? ruleTooltip(r) : undefined}>
                    {r && <span className={`specmap-dot specmap-dot--${r.enforcement}`} />}
                    {id}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {selGroup && (
          <div className="specmap-detail">
            <div className="specmap-detail__head">
              <span className="specmap-detail__name">{plain(selGroup.title)}</span>
              <span className="specmap-detail__sub">
                {selGroup.modules.length} {selGroup.modules.length === 1 ? "file" : "files"}
              </span>
            </div>
            <div className="specmap-detail__chips">
              {selGroup.modules.map((m) => (
                <span key={m.name} className="specmap-chip" title={plain(m.role)}>{m.nameCell}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
