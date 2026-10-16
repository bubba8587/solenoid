// [[C122]] choiceLadder, [[C100]] chartIsAValue
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LadderPayload, LadderRung, LadderStruck } from "../chartValue";
import { formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatScalar } from "./format";
import { stopDragStart } from "../coarse";
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
const costsText = (p: LadderPayload, costs: number[]) => costs.map((c, k) => resourceText(p, k, c)).join(" · ");
const leftText = (p: LadderPayload, left: number[]) => left.length ? `${left.map((v, k) => resourceText(p, k, v)).join(" · ")} left` : "";

interface Laid { laneX: Map<number, number>; laneR: Map<number, number>; lanes: number; kids: Map<number, LadderRung[]> }

function laneLayout(rungs: LadderRung[]): Laid {
  const kids = new Map<number, LadderRung[]>(rungs.map((r) => [r.id, []]));
  for (const r of rungs) if (r.parent != null) kids.get(r.parent)!.push(r);
  for (const list of kids.values()) list.sort((a, b) => (a.branch ?? 0) - (b.branch ?? 0));
  const laneX = new Map<number, number>(), laneR = new Map<number, number>();
  let next = 0;
  const walk = (r: LadderRung) => {
    const ks = kids.get(r.id)!;
    if (!ks.length) { laneX.set(r.id, next); laneR.set(r.id, next); next++; return; }
    ks.forEach(walk);
    laneX.set(r.id, laneX.get(ks[0].id)!);
    laneR.set(r.id, laneX.get(ks[ks.length - 1].id)!);
  };
  const root = rungs.find((r) => r.parent == null);
  if (root) walk(root);
  return { laneX, laneR, lanes: next, kids };
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

function RungCard({ p, r, onPath, selected, onPick }: { p: LadderPayload; r: LadderRung; onPath: boolean; selected: boolean; onPick: (id: number) => void }) {
  const cls = `sol-ladder__card${onPath ? " is-on" : ""}`;
  if (r.kind === "plan") {
    const best = p.rungs.find((x) => x.id === p.best)!;
    const gap = best.total - r.total;
    return (
      <button type="button" className={`${cls} sol-ladder__plan${selected ? " is-sel" : ""}`} aria-pressed={selected} onClick={() => onPick(r.id)} onPointerDown={stopDragStart}>
        <div className="sol-ladder__head"><span>Plan · {r.rung} {r.rung === 1 ? "pick" : "picks"}</span>{gap < 1e-9 ? <span className="sol-ladder__badge is-best">Best</span> : <span className="sol-ladder__mono">−{fmt3(gap)}</span>}</div>
        <div className="sol-ladder__total">{fmt3(r.total)}</div>
        <div className="sol-ladder__costs">{leftText(p, r.left)}</div>
      </button>
    );
  }
  const head = (badge: ReactNode) => <div className="sol-ladder__head"><span>Rung {r.rung + 1}</span>{badge}</div>;
  if (r.kind === "clear") {
    const o = p.options[r.pick!];
    const s = r.sturdy;
    return (
      <div className={cls}>
        {head(<span className="sol-ladder__badge">Clear</span>)}
        <Struck p={p} list={r.struck} />
        <div className="sol-ladder__pick"><span className="sol-ladder__name">{o.name}</span><span className="sol-ladder__mono">{fmt3(o.score)}</span></div>
        <div className="sol-ladder__costs">{costsText(p, o.costs)}</div>
        <div className="sol-ladder__note">
          {s ? <>vs <b>{p.options[s.rival].name}</b> · {s.flipsAt == null || s.flipsAt >= 1 ? "holds at any weights" : `holds to ±${pct(s.flipsAt)}`}</> : "Nothing else could take its place"}
        </div>
      </div>
    );
  }
  const d = r.duel!, A = p.options[r.pick!], B = p.options[r.rival!];
  const maxPull = Math.max(1e-9, ...d.pulls.map(Math.abs));
  const lead = d.margin >= 0 ? A : B;
  const side = (o: typeof A, brings: number[], plan: number, k: "a" | "b") => (
    <div className={`sol-ladder__side is-${k}`}>
      <span className="sol-ladder__tag">{k === "a" ? "Main" : "Alternative"}</span>
      <span className="sol-ladder__name">{o.name}</span>
      <span className="sol-ladder__costs">{costsText(p, o.costs)}</span>
      {brings.length > 0 && <span className="sol-ladder__note">brings {listJoin(brings.map((i) => p.options[i].name))}</span>}
      <span className="sol-ladder__mono">plan {fmt3(plan)}</span>
    </div>
  );
  return (
    <div className={`${cls} sol-ladder__tossup`}>
      {head(<span className="sol-ladder__badge is-fork">Toss-up</span>)}
      <Struck p={p} list={r.struck} />
      <div className="sol-ladder__duel">{side(A, d.aBrings, d.planA, "a")}{side(B, d.bBrings, d.planB, "b")}</div>
      <div className="sol-ladder__pulls">
        {d.pulls.map((v, j) => Math.abs(v) < 1e-6 ? null : (
          <div key={j} className="sol-ladder__pullrow">
            <div className="sol-ladder__bar is-a" style={{ width: v > 0 ? pct(Math.abs(v) / maxPull) : 0 }} />
            <span>{p.criteria[j]}</span>
            <div className="sol-ladder__bar is-b" style={{ width: v < 0 ? pct(Math.abs(v) / maxPull) : 0 }} />
          </div>
        ))}
      </div>
      <div className="sol-ladder__note"><b>{lead.name}</b>'s side leads by {fmt3(Math.abs(d.margin))}. Weights off by {pct(d.flipsAt)} would swap them.</div>
    </div>
  );
}

/** The Choice Ladder figure: rungs top to bottom, one lane per plan, ribbons as wide as the first limit's remainder. */
export function LadderView({ payload: p, width, height, fscale = 1 }: { payload: LadderPayload; width: number; height: number; fscale?: number }) {
  const gid = useId().replace(/:/g, "");
  const [picked, setPicked] = useState<number | null>(null);
  const laid = useMemo(() => laneLayout(p.rungs), [p]);
  const byId = useMemo(() => new Map(p.rungs.map((r) => [r.id, r])), [p]);
  const sel = picked != null && byId.get(picked)?.kind === "plan" ? picked : p.best;
  const onPath = new Set<number>();
  for (let r = byId.get(sel); r; r = r.parent != null ? byId.get(r.parent) : undefined) onPath.add(r.id);

  const CW = Math.round(226 * fscale), LW = CW + Math.round(24 * fscale), GAP = Math.round(46 * fscale), TOP = Math.round(30 * fscale);
  const cardRefs = useRef(new Map<number, HTMLElement>());
  const [heights, setHeights] = useState<Map<number, number> | null>(null);
  useLayoutEffect(() => {
    const next = new Map<number, number>();
    for (const [id, el] of cardRefs.current) if (byId.has(id)) next.set(id, el.offsetHeight);
    const same = heights && heights.size === next.size && [...next].every(([k, v]) => heights.get(k) === v);
    if (!same) setHeights(next);
  });

  const depth = Math.max(0, ...p.rungs.filter((r) => r.kind !== "plan").map((r) => r.rung + 1));
  const rowOf = (r: LadderRung) => (r.kind === "plan" ? depth : r.rung);
  const rowH = new Array(depth + 1).fill(0);
  if (heights) for (const r of p.rungs) rowH[rowOf(r)] = Math.max(rowH[rowOf(r)], heights.get(r.id) ?? 0);
  const rowY: number[] = [];
  let y = TOP;
  for (let k = 0; k <= depth; k++) { rowY[k] = y; y += rowH[k] + GAP; }
  const W = Math.max(CW, (laid.lanes - 1) * LW + CW), H = y - GAP;

  const lim = Math.max(1e-9, p.resources[0]?.limit ?? 0);
  const MAXW = 36 * fscale;
  const wOf = (left: number[]) => (p.resources.length ? Math.max(2, (Math.max(0, left[0]) / lim) * MAXW) : 6);
  const cx = (lane: number) => lane * LW + CW / 2;
  const ribbons: ReactNode[] = [], labels: ReactNode[] = [];
  // One line per resource, so a label stays inside its lane.
  const ribLabel = (key: string, x: number, y0: number, left: number[], on: boolean) => (
    <text key={key} x={x} y={y0} className={`sol-ladder__riblabel${on ? " is-on" : ""}`}>
      {left.map((v, j) => <tspan key={j} x={x} dy={j ? 11 * fscale : 0}>{resourceText(p, j, v)}</tspan>)}
    </text>
  );
  if (heights) {
    const root = p.rungs.find((r) => r.parent == null);
    if (root) {
      const w = wOf(root.left);
      ribbons.push(<rect key="in" x={cx(laid.laneX.get(root.id)!) - w / 2} y={0} width={w} height={rowY[0]} className="sol-ladder__rib is-on" />);
      labels.push(ribLabel("in", cx(laid.laneX.get(root.id)!) + w / 2 + 6, 10 * fscale, root.left, true));
    }
    for (const b of p.rungs) {
      if (b.parent == null) continue;
      const a = byId.get(b.parent)!;
      const on = onPath.has(a.id) && onPath.has(b.id);
      const x = cx(laid.laneX.get(b.id)!), y1 = rowY[rowOf(a)] + (heights.get(a.id) ?? 0), y2 = rowY[rowOf(b)];
      const w = wOf(b.left);
      const k = on ? " is-on" : "";
      ribbons.push(<rect key={`r${b.id}`} x={x - w / 2} y={y1} width={w} height={Math.max(0, y2 - y1)} className={`sol-ladder__rib${k}`} />);
      labels.push(ribLabel(`l${b.id}`, x + w / 2 + 6, y1 + 13 * fscale, b.left, on));
      const spent = wOf(a.left) - w;
      if (spent > 0.5) {
        const sx = x - w / 2, sy = y1 + 1, tail = Math.min(spent, 18) * 0.5;
        ribbons.push(<path key={`s${b.id}`} fill={`url(#${gid}${on ? "on" : "off"})`}
          d={`M${sx} ${sy} C ${sx - 4} ${sy + 10}, ${sx - 14} ${sy + 18}, ${sx - 26} ${sy + 22} L ${sx - 26} ${sy + 22 - tail} C ${sx - 16} ${sy + 12}, ${sx - spent - 2} ${sy + 6}, ${sx - spent} ${sy} Z`} />);
      }
    }
  }

  const forks = p.rungs.filter((r) => r.kind === "tossup").length;
  const plans = p.rungs.filter((r) => r.kind === "plan").length;
  const best = byId.get(p.best)!;
  const gain = best.total - p.rankingTotal;

  return (
    <div className="sol-ladder" style={{ width, height, ["--chart-fscale" as string]: fscale }}>
      <div className="sol-ladder__summary">
        <span><b>Best plan {fmt3(best.total)}</b> · {best.rung} {best.rung === 1 ? "pick" : "picks"}{p.resources.length ? ` · ${leftText(p, best.left)}` : ""}</span>
        <span>Ranking alone {fmt3(p.rankingTotal)}{gain > 1e-9 ? ` (${fmt3(gain)} less)` : ""}</span>
        <span>{forks} {forks === 1 ? "toss-up" : "toss-ups"} at ±{pct(p.wiggle)} · {plans} {plans === 1 ? "plan" : "plans"}</span>
      </div>
      <div className="sol-ladder__scroll" onWheel={(e) => e.stopPropagation()}>
        <div className="sol-ladder__stage" style={{ width: W, height: heights ? H : undefined, visibility: heights ? "visible" : "hidden" }}>
          <svg className="sol-ladder__svg" width={W} height={heights ? H : 0} aria-hidden="true">
            <defs>
              <linearGradient id={`${gid}off`} x1="1" y1="0" x2="0" y2="1"><stop offset="0" className="sol-ladder__stop" /><stop offset="1" className="sol-ladder__stop is-end" /></linearGradient>
              <linearGradient id={`${gid}on`} x1="1" y1="0" x2="0" y2="1"><stop offset="0" className="sol-ladder__stop is-on" /><stop offset="1" className="sol-ladder__stop is-on is-end" /></linearGradient>
            </defs>
            {ribbons}{labels}
          </svg>
          {p.rungs.map((r) => {
            const span = r.kind === "tossup" ? laid.laneR.get(r.id)! - laid.laneX.get(r.id)! : 0;
            return (
              <div key={r.id} ref={(el) => { if (el) cardRefs.current.set(r.id, el); else cardRefs.current.delete(r.id); }}
                className="sol-ladder__slot"
                style={{ left: laid.laneX.get(r.id)! * LW, top: heights ? rowY[rowOf(r)] : 0, width: CW + span * LW }}>
                <RungCard p={p} r={r} onPath={onPath.has(r.id)} selected={r.id === sel} onPick={setPicked} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
