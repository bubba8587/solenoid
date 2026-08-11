import { useMemo, useState, useSyncExternalStore } from "react";
import { specMapStore } from "../specMapStore";
import { parseArchDoc, parseRulesDoc, testCitationIndex } from "../specMap";
import rulesMd from "../../../docs/rules.md?raw";
import archMd from "../../../docs/architecture.md?raw";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";
import "./SpecMapView.css";

// The Architecture map overlay: the spec (docs/rules.md) beside the code map
// (docs/architecture.md), both parsed from the ?raw doc text at build time by
// specMap.ts — nothing here is hand-kept. Selecting a rule opens its MUST text
// and lights the modules matching its cited test suites.

const GRADE_LABEL = { ARR: "author-ruled", INFERRED: "inferred", DEFAULT: "default" } as const;
const STATUS_TITLE = {
  enforced: "Enforced by a test",
  partial: "Partially enforced",
  unenforced: "Unenforced",
} as const;

const plain = (s: string) => s.replace(/`/g, "");

export function SpecMapView() {
  const open = useSyncExternalStore(specMapStore.subscribe, specMapStore.get);
  const [sel, setSel] = useState<string | null>(null);
  const model = useMemo(() => parseRulesDoc(rulesMd), []);
  const groups = useMemo(() => parseArchDoc(archMd), []);
  const suiteCount = useMemo(() => testCitationIndex(model).size, [model]);

  useEscapeToClose(() => specMapStore.close(), open);
  if (!open) return null;

  const selRule = model.domains.flatMap((d) => d.rules).find((r) => r.id === sel) ?? null;
  const hotStems = (selRule?.tests ?? []).map((t) => t.replace(/\.test\.ts$/, "").split("/").pop()!);
  const isHot = (name: string) => hotStems.some((s) => name === s || name.startsWith(`${s}.`));
  const moduleCount = groups.reduce((n, g) => n + g.modules.length, 0);

  return (
    <div className="specmap-backdrop" onPointerDown={() => specMapStore.close()}>
      <div className="specmap-panel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="specmap-head">
          <span className="specmap-head__title">Architecture map</span>
          <span className="specmap-head__src">derived from docs/rules.md and docs/architecture.md</span>
          <button className="specmap-close" onClick={() => specMapStore.close()} title="Close (Esc)" aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="specmap-body">
          <section className="specmap-col">
            <div className="specmap-col__head">
              <span className="specmap-col__name">Rules</span>
              <span className="specmap-stat"><span className="specmap-dot specmap-dot--enforced" />{model.summary.enforced} enforced</span>
              {model.summary.partial > 0 && (
                <span className="specmap-stat"><span className="specmap-dot specmap-dot--partial" />{model.summary.partial} partial</span>
              )}
              {model.summary.unenforced > 0 && (
                <span className="specmap-stat"><span className="specmap-dot specmap-dot--unenforced" />{model.summary.unenforced} unenforced</span>
              )}
              <span className="specmap-stat specmap-stat--tail">{suiteCount} suites cited</span>
            </div>
            <div className="specmap-col__scroll">
              {model.domains.map((d) => (
                <div key={d.prefix} className="specmap-domain">
                  <div className="specmap-domain__head">
                    <span className="specmap-domain__prefix">{d.prefix}</span>
                    <span className="specmap-domain__name">{d.title}</span>
                    <span className="specmap-domain__count">{d.rules.length}</span>
                  </div>
                  <p className="specmap-domain__blurb">{plain(d.blurb)}</p>
                  <div className="specmap-domain__rules">
                    {d.rules.map((r) => (
                      <div key={r.id} className={`specmap-rule${sel === r.id ? " specmap-rule--open" : ""}`}>
                        <button className="specmap-rule__row" onClick={() => setSel(sel === r.id ? null : r.id)}>
                          <span className={`specmap-dot specmap-dot--${r.enforcement}`} title={STATUS_TITLE[r.enforcement]} />
                          <span className="specmap-rule__id">{r.id}</span>
                          <span className="specmap-rule__title">{plain(r.title)}</span>
                        </button>
                        {sel === r.id && (
                          <div className="specmap-rule__detail">
                            <p className="specmap-rule__must">{plain(r.must)}</p>
                            <div className="specmap-rule__meta">
                              <span className={`specmap-grade${r.grade === "ARR" ? " specmap-grade--arr" : ""}`}>
                                {GRADE_LABEL[r.grade]}
                              </span>
                              {r.tests.map((t) => <span key={t} className="specmap-suite">{t}</span>)}
                              {r.hasExceptions && <span className="specmap-flag">has exceptions</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="specmap-col">
            <div className="specmap-col__head">
              <span className="specmap-col__name">Modules</span>
              <span className="specmap-stat specmap-stat--tail">{moduleCount} files in {groups.length} groups</span>
            </div>
            <div className="specmap-col__scroll">
              {groups.map((g) => (
                <div key={g.title} className="specmap-group">
                  <div className="specmap-group__title">{g.title}</div>
                  {g.modules.map((m) => (
                    <div
                      key={`${g.title}/${m.name}`}
                      className={`specmap-mod${isHot(m.name) ? " specmap-mod--hot" : ""}`}
                    >
                      <span className="specmap-mod__name">{m.nameCell}</span>
                      <span className="specmap-mod__role" title={plain(m.role)}>{plain(m.role)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
