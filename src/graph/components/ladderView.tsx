// [[C122]] choiceLadder, [[C100]] chartIsAValue
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LadderPayload, LadderRung, LadderStruck, LadderSwitch } from "../chartValue";
import { formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatScalar } from "./format";
import { stopDragStart } from "../coarse";
import { useSeriesColors } from "./chartCore";
import { layoutLadder, metricsFor } from "./ladderLayout";
import "./ladderView.css";

import type { LadderAction } from "../nodes/ladderOps";

const fmt3 = (x: number) => (Math.round(x * 1000) / 1000).toFixed(3);
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${fmt3(Math.abs(x))}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const listJoin = (a: string[]) => a.length <= 1 ? a.join("") : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

function resourceText(p: LadderPayload, k: number, v: number): string {
  const r = p.resources[k];
  const n = Math.round(v * 1e4) / 1e4;
  const unit = n === 1 ? r.name.toLowerCase().replace(/s$/, "") : r.name.toLowerCase();
  if (r.format) {
    const s = formatNumberWithAnnotation(v, r.format);
    return /currency|accounting/.test(r.format.format) ? s : `${s} ${unit}`;
  }
  return `${formatScalar(n)} ${unit}`;
}

/** Amounts per resource, each with its band's swatch. */
function Amounts({ p, values, colors, zero = true }: { p: LadderPayload; values: number[]; colors: string[]; zero?: boolean }) {
  return (
    <span className="sol-ladder__amounts">
      {values.map((v, k) => (!zero && Math.abs(v) < 1e-9 ? null : (
        <span key={k}><i style={{ background: colors[k % colors.length] }} />{resourceText(p, k, v)}</span>
      )))}
    </span>
  );
}

function Struck({ p, list }: { p: LadderPayload; list?: LadderStruck[] }) {
  if (!list?.length) return null;
  const nm = (i: number) => p.options[i].name;
  return (
    <ul className="sol-ladder__struck">
      {list.map((x) => (
        <li key={x.option}>
          <s>{nm(x.option)}</s>{" "}
          {x.why === "fit"
            ? `doesn't fit: ${(x.over ?? []).map((v, k) => (v > 0 ? `${resourceText(p, k, v)} over` : "")).filter(Boolean).join(" and ")}`
            : x.why === "picks" ? "doesn't fit alongside your picks"
            : `would crowd out ${listJoin((x.pushedOut ?? []).map(nm))} for ${fmt3(x.cost ?? 0)} less`}
        </li>
      ))}
    </ul>
  );
}

const Btn = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" className="sol-ladder__btn" onClick={onClick} onPointerDown={stopDragStart}>{children}</button>
);

/** The other way at a rung: what it brings and drops, its plan score and how close the weights hold it. */
function SwitchBox({ p, sw, pick, title, action }: { p: LadderPayload; sw: LadderSwitch; pick: number; title: ReactNode; action?: ReactNode }) {
  const nm = (i: number) => p.options[i].name;
  const maxPull = Math.max(1e-9, ...sw.pulls.map(Math.abs));
  const changes = [
    sw.brings.length ? `brings ${listJoin(sw.brings.map(nm))}` : "",
    sw.drops.length ? `drops ${listJoin(sw.drops.map(nm))}` : "",
  ].filter(Boolean).join("; ");
  const showPulls = sw.option !== pick && sw.pulls.some((v) => Math.abs(v) > 1e-6);
  return (
    <div className="sol-ladder__switch">
      <div className="sol-ladder__switchhead">{title}<span className="sol-ladder__mono">plan {fmt3(sw.plan)} ({signed(sw.margin)})</span></div>
      {changes && <div className="sol-ladder__note">{changes[0].toUpperCase() + changes.slice(1)}.</div>}
      {showPulls && (
        <div className="sol-ladder__pulls">
          <div className="sol-ladder__pullhead"><span>{nm(pick)}</span><span>{nm(sw.option)}</span></div>
          {sw.pulls.map((v, j) => Math.abs(v) < 1e-6 ? null : (
            <div key={j} className="sol-ladder__pullrow">
              <div className="sol-ladder__bar is-a" style={{ width: v < 0 ? pct(Math.abs(v) / maxPull) : 0 }} />
              <span>{p.criteria[j]}</span>
              <div className="sol-ladder__bar is-b" style={{ width: v > 0 ? pct(Math.abs(v) / maxPull) : 0 }} />
            </div>
          ))}
        </div>
      )}
      {showPulls && <div className="sol-ladder__note">Weights off by {pct(sw.flipsAt)} would swap them.</div>}
      {action}
    </div>
  );
}

function RungCard({ p, r, colors, act }: { p: LadderPayload; r: LadderRung; colors: string[]; act?: (a: LadderAction) => void }) {
  if (r.kind === "plan") {
    const gap = p.bestTotal - r.total;
    const anyLeft = r.left.some((v) => v > 1e-9);
    return (
      <div className="sol-ladder__card sol-ladder__plan">
        <div className="sol-ladder__head"><span>Plan · {r.rung} {r.rung === 1 ? "pick" : "picks"}</span>
          {gap < 1e-9 ? <span className="sol-ladder__badge is-best">Best possible</span> : <span className="sol-ladder__mono">best possible {fmt3(p.bestTotal)}</span>}</div>
        <div className="sol-ladder__total">{fmt3(r.total)}</div>
        {p.resources.length > 0 && (anyLeft
          ? <div className="sol-ladder__note">Left over: <Amounts p={p} values={r.left} colors={colors} zero={false} /></div>
          : <div className="sol-ladder__note">Nothing left over.</div>)}
      </div>
    );
  }
  const o = p.options[r.pick!];
  const badge = r.kind === "tossup" ? <span className="sol-ladder__badge is-fork">Toss-up</span>
    : r.kind === "chosen" ? <span className="sol-ladder__badge is-pick">Your pick</span>
    : <span className="sol-ladder__badge">Clear</span>;
  const s = r.sturdy;
  return (
    <div className={`sol-ladder__card${r.kind === "chosen" ? " is-pick" : ""}`}>
      <div className="sol-ladder__head"><span>Rung {r.rung + 1}</span>{badge}</div>
      <div className="sol-ladder__pick"><span className="sol-ladder__name">{o.name}</span><span className="sol-ladder__mono">{fmt3(o.score)}</span></div>
      <Amounts p={p} values={o.costs} colors={colors} />
      <Struck p={p} list={r.struck} />
      {r.kind === "clear" && (
        <div className="sol-ladder__note">
          {s ? <>Nearest rival: <b>{p.options[s.rival].name}</b>. {s.flipsAt == null || s.flipsAt >= 1 ? "Holds at any weights." : `Holds unless weights are off by ${pct(s.flipsAt)}.`}</> : "Nothing else could take its place."}
        </div>
      )}
      {r.kind === "tossup" && r.alt && (
        <SwitchBox p={p} sw={r.alt} pick={r.pick!}
          title={<span>Or <b>{p.options[r.alt.option].name}</b></span>}
          action={act && <Btn onClick={() => act({ add: p.options[r.alt!.option].name })}>Take {p.options[r.alt.option].name} instead</Btn>} />
      )}
      {r.kind === "chosen" && r.alt && (
        <SwitchBox p={p} sw={r.alt} pick={r.pick!}
          title={r.alt.option === r.pick ? <span>The best plan takes it anyway</span> : <span>Without it: <b>{p.options[r.alt.option].name}</b></span>}
          action={act && <Btn onClick={() => act({ remove: o.name })}>Undo this pick</Btn>} />
      )}
    </div>
  );
}

function SourceCard({ p, colors, act }: { p: LadderPayload; colors: string[]; act?: (a: LadderAction) => void }) {
  return (
    <div className="sol-ladder__card sol-ladder__source">
      <div className="sol-ladder__head"><span>Limits</span>{act && (p.choices.length > 0 || p.dropped.length > 0) && <Btn onClick={() => act({ reset: true })}>Back to the best plan</Btn>}</div>
      {p.resources.length
        ? <Amounts p={p} values={p.resources.map((r) => r.limit)} colors={colors} />
        : <div className="sol-ladder__note">No limits: everything fits.</div>}
      {p.choices.length > 0 && <div className="sol-ladder__note">Your picks: {listJoin(p.choices)}.</div>}
      {p.dropped.length > 0 && <div className="sol-ladder__note is-warn">No longer fits with your other picks: {listJoin(p.dropped)}.</div>}
    </div>
  );
}

/** The Choice Ladder figure: the plan's rungs top to bottom, each limit flowing down as a band that turns into every card
 *  for what it spends. A toss-up offers its other way; with `onAction` the figure can change the node's choices. */
export function LadderView({ payload: p, width, height, fscale = 1, onAction }: { payload: LadderPayload; width: number; height: number; fscale?: number; onAction?: (a: LadderAction) => void }) {
  const colors = useSeriesColors();
  const m = metricsFor(fscale);
  const refs = useRef(new Map<string, HTMLElement>());
  const [heights, setHeights] = useState<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const [k, el] of refs.current) next.set(k, el.offsetHeight);
    const same = heights && heights.size === next.size && [...next].every(([k, v]) => heights.get(k) === v);
    if (!same) setHeights(next);
  });

  const L = layoutLadder(p, heights ?? new Map(), m);
  const slot = (key: string, node: ReactNode) => {
    const b = L.boxes.get(key)!;
    return (
      <div key={key} ref={(el) => { if (el) refs.current.set(key, el); else refs.current.delete(key); }}
        className="sol-ladder__slot" style={{ left: b.x, top: b.y, width: b.w }}>{node}</div>
    );
  };
  const plan = p.rungs[p.rungs.length - 1];
  const forks = p.rungs.filter((r) => r.kind === "tossup").length;
  const gain = plan.total - p.rankingTotal;

  return (
    <div className="sol-ladder" style={{ width, height, ["--chart-fscale" as string]: fscale }}>
      <div className="sol-ladder__summary">
        <span><b>Plan {fmt3(plan.total)}</b>{plan.total < p.bestTotal - 1e-9 ? ` (best possible ${fmt3(p.bestTotal)})` : ", the best possible"}</span>
        <span>Ranking alone {fmt3(p.rankingTotal)}{gain > 1e-9 ? `, ${fmt3(gain)} less` : ""}</span>
        <span>{forks} {forks === 1 ? "toss-up" : "toss-ups"} at ±{pct(p.wiggle)}</span>
      </div>
      <div className="sol-ladder__scroll" onWheel={(e) => e.stopPropagation()}>
        <div className="sol-ladder__stage" style={{ width: L.width, height: heights ? L.height : undefined, visibility: heights ? "visible" : "hidden" }}>
          <svg className="sol-ladder__svg" width={L.width} height={heights ? L.height : 0} aria-hidden="true">
            {L.pieces.map((x, i) => x.kind === "line"
              ? <path key={i} d={x.d} className="sol-ladder__line" />
              : <path key={i} d={x.d} className="sol-ladder__band" style={{ fill: colors[(x.band ?? 0) % colors.length] }} />)}
          </svg>
          {slot("source", <SourceCard p={p} colors={colors} act={onAction} />)}
          {p.rungs.map((r, k) => slot(`r${k}`, <RungCard p={p} r={r} colors={colors} act={onAction} />))}
        </div>
      </div>
    </div>
  );
}
