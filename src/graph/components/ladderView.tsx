// [[C122]] choiceLadder, [[C100]] chartIsAValue
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LadderPayload, LadderRung, LadderStruck } from "../chartValue";
import { formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatScalar } from "./format";
import { stopDragStart } from "../coarse";
import { useSeriesColors } from "./chartCore";
import { layoutLadder, metricsFor } from "./ladderLayout";
import "./ladderView.css";

const fmt3 = (x: number) => (Math.round(x * 1000) / 1000).toFixed(3);
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
            : `would crowd out ${listJoin((x.pushedOut ?? []).map(nm))} for ${fmt3(x.cost ?? 0)} less`}
        </li>
      ))}
    </ul>
  );
}

interface CardProps { p: LadderPayload; r: LadderRung; on: boolean; colors: string[] }

function ClearCard({ p, r, on, colors }: CardProps) {
  const o = p.options[r.pick!], s = r.sturdy;
  return (
    <div className={`sol-ladder__card${on ? " is-on" : ""}`}>
      <div className="sol-ladder__head"><span>Rung {r.rung + 1}</span><span className="sol-ladder__badge">Clear</span></div>
      <div className="sol-ladder__pick"><span className="sol-ladder__name">{o.name}</span><span className="sol-ladder__mono">{fmt3(o.score)}</span></div>
      <Amounts p={p} values={o.costs} colors={colors} />
      <Struck p={p} list={r.struck} />
      <div className="sol-ladder__note">
        {s ? <>Next best without it: <b>{p.options[s.rival].name}</b>. {s.flipsAt == null || s.flipsAt >= 1 ? "Holds at any weights." : `Holds unless weights are off by ${pct(s.flipsAt)}.`}</> : "Nothing else could take its place."}
      </div>
    </div>
  );
}

function TossCard({ p, r, on, colors }: CardProps) {
  const d = r.duel!, A = p.options[r.pick!], B = p.options[r.rival!];
  const maxPull = Math.max(1e-9, ...d.pulls.map(Math.abs));
  const lead = d.margin >= 0 ? A : B;
  return (
    <div className={`sol-ladder__card sol-ladder__toss${on ? " is-on" : ""}`}>
      <div className="sol-ladder__head"><span>Rung {r.rung + 1} · main</span><span className="sol-ladder__badge is-fork">Toss-up</span></div>
      <div className="sol-ladder__pick"><span className="sol-ladder__name">{A.name}</span><span className="sol-ladder__mono">{fmt3(A.score)}</span></div>
      <Amounts p={p} values={A.costs} colors={colors} />
      {d.aBrings.length > 0 && <div className="sol-ladder__note">Brings {listJoin(d.aBrings.map((i) => p.options[i].name))}.</div>}
      <Struck p={p} list={r.struck} />
      <div className="sol-ladder__pulls">
        <div className="sol-ladder__pullhead"><span>{A.name}</span><span>{B.name}</span></div>
        {d.pulls.map((v, j) => Math.abs(v) < 1e-6 ? null : (
          <div key={j} className="sol-ladder__pullrow">
            <div className="sol-ladder__bar is-a" style={{ width: v > 0 ? pct(Math.abs(v) / maxPull) : 0 }} />
            <span>{p.criteria[j]}</span>
            <div className="sol-ladder__bar is-b" style={{ width: v < 0 ? pct(Math.abs(v) / maxPull) : 0 }} />
          </div>
        ))}
      </div>
      <div className="sol-ladder__note"><b>{lead.name}</b>'s side leads, {fmt3(Math.max(d.planA, d.planB))} to {fmt3(Math.min(d.planA, d.planB))}. Weights off by {pct(d.flipsAt)} would swap them.</div>
    </div>
  );
}

function AltCard({ p, r, on, colors }: CardProps) {
  const d = r.duel!, B = p.options[r.rival!];
  return (
    <div className={`sol-ladder__card sol-ladder__alt${on ? " is-on" : ""}`}>
      <div className="sol-ladder__head"><span>Rung {r.rung + 1} · alternative</span><span className="sol-ladder__badge is-fork">Toss-up</span></div>
      <div className="sol-ladder__pick"><span className="sol-ladder__name">{B.name}</span><span className="sol-ladder__mono">{fmt3(B.score)}</span></div>
      <Amounts p={p} values={B.costs} colors={colors} />
      {d.bBrings.length > 0 && <div className="sol-ladder__note">Brings {listJoin(d.bBrings.map((i) => p.options[i].name))}.</div>}
      <div className="sol-ladder__note">Instead of {p.options[r.pick!].name}: the same budget, spent this way.</div>
    </div>
  );
}

function PlanCard({ p, r, on, colors, selected, onPick }: CardProps & { selected: boolean; onPick: (id: number) => void }) {
  const best = p.rungs.find((x) => x.id === p.best)!;
  const gap = best.total - r.total;
  const anyLeft = r.left.some((v) => v > 1e-9);
  return (
    <button type="button" className={`sol-ladder__card sol-ladder__plan${on ? " is-on" : ""}${selected ? " is-sel" : ""}`} aria-pressed={selected} onClick={() => onPick(r.id)} onPointerDown={stopDragStart}>
      <div className="sol-ladder__head"><span>Plan · {r.rung} {r.rung === 1 ? "pick" : "picks"}</span>{gap < 1e-9 ? <span className="sol-ladder__badge is-best">Best</span> : <span className="sol-ladder__mono">−{fmt3(gap)}</span>}</div>
      <div className="sol-ladder__total">{fmt3(r.total)}</div>
      {p.resources.length > 0 && (anyLeft
        ? <div className="sol-ladder__note">Left over: <Amounts p={p} values={r.left} colors={colors} zero={false} /></div>
        : <div className="sol-ladder__note">Nothing left over.</div>)}
    </button>
  );
}

function SourceCard({ p, colors }: { p: LadderPayload; colors: string[] }) {
  return (
    <div className="sol-ladder__card sol-ladder__source is-on">
      <div className="sol-ladder__head"><span>Limits</span></div>
      {p.resources.length
        ? <Amounts p={p} values={p.resources.map((r) => r.limit)} colors={colors} />
        : <div className="sol-ladder__note">No limits: everything fits.</div>}
    </div>
  );
}

/** The Choice Ladder figure: a flowchart of rungs, one lane per plan, with each limit flowing down as a band that turns
 *  into every card for what it spends. Layout and geometry are `ladderLayout.ts`. */
export function LadderView({ payload: p, width, height, fscale = 1 }: { payload: LadderPayload; width: number; height: number; fscale?: number }) {
  const colors = useSeriesColors();
  const [picked, setPicked] = useState<number | null>(null);
  const byId = useMemo(() => new Map(p.rungs.map((r) => [r.id, r])), [p]);
  const sel = picked != null && byId.get(picked)?.kind === "plan" ? picked : p.best;
  const m = metricsFor(fscale);

  const refs = useRef(new Map<string, HTMLElement>());
  const [heights, setHeights] = useState<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const [k, el] of refs.current) next.set(k, el.offsetHeight);
    const same = heights && heights.size === next.size && [...next].every(([k, v]) => heights.get(k) === v);
    if (!same) setHeights(next);
  });

  const L = layoutLadder(p, heights ?? new Map(), m, sel);
  const slot = (key: string, node: ReactNode) => {
    const b = L.boxes.get(key)!;
    return (
      <div key={key} ref={(el) => { if (el) refs.current.set(key, el); else refs.current.delete(key); }}
        className="sol-ladder__slot" style={{ left: b.x, top: b.y, width: b.w }}>{node}</div>
    );
  };
  const cards: ReactNode[] = [slot("source", <SourceCard p={p} colors={colors} />)];
  for (const r of p.rungs) {
    const on = L.boxes.get(`r${r.id}`)!.on;
    if (r.kind === "plan") cards.push(slot(`r${r.id}`, <PlanCard p={p} r={r} on={on} colors={colors} selected={r.id === sel} onPick={setPicked} />));
    else if (r.kind === "clear") cards.push(slot(`r${r.id}`, <ClearCard p={p} r={r} on={on} colors={colors} />));
    else {
      cards.push(slot(`r${r.id}`, <TossCard p={p} r={r} on={on} colors={colors} />));
      cards.push(slot(`a${r.id}`, <AltCard p={p} r={r} on={L.boxes.get(`a${r.id}`)!.on} colors={colors} />));
    }
  }

  const forks = p.rungs.filter((r) => r.kind === "tossup").length;
  const plans = p.rungs.filter((r) => r.kind === "plan").length;
  const best = byId.get(p.best)!;
  const gain = best.total - p.rankingTotal;
  const band = (k: number | null) => (k == null ? undefined : colors[k % colors.length]);

  return (
    <div className="sol-ladder" style={{ width, height, ["--chart-fscale" as string]: fscale }}>
      <div className="sol-ladder__summary">
        <span><b>Best plan {fmt3(best.total)}</b> with {best.rung} {best.rung === 1 ? "pick" : "picks"}</span>
        <span>Ranking alone {fmt3(p.rankingTotal)}{gain > 1e-9 ? `, ${fmt3(gain)} less` : ""}</span>
        <span>{forks} {forks === 1 ? "toss-up" : "toss-ups"} at ±{pct(p.wiggle)}, {plans} {plans === 1 ? "plan" : "plans"}</span>
      </div>
      <div className="sol-ladder__scroll" onWheel={(e) => e.stopPropagation()}>
        <div className="sol-ladder__stage" style={{ width: L.width, height: heights ? L.height : undefined, visibility: heights ? "visible" : "hidden" }}>
          <svg className="sol-ladder__svg" width={L.width} height={heights ? L.height : 0} aria-hidden="true">
            {L.pieces.filter((x) => x.kind === "line").map((x, i) => (
              <path key={`l${i}`} d={x.d} className={`sol-ladder__line${x.on ? " is-on" : ""}${x.ghost ? " is-ghost" : ""}`} />
            ))}
            {L.pieces.filter((x) => x.kind !== "line").map((x, i) => (
              <path key={`b${i}`} d={x.d}
                className={`sol-ladder__band${x.on ? " is-on" : ""}${x.ghost ? " is-ghost" : ""}`}
                style={{ fill: band(x.band), stroke: x.ghost ? band(x.band) : undefined }} />
            ))}
          </svg>
          {cards}
        </div>
      </div>
    </div>
  );
}
