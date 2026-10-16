// [[C122]] choiceLadder, [[C100]] chartIsAValue
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LadderPayload, LadderEdge } from "../chartValue";
import type { LadderAction } from "../nodes/ladderOps";
import { formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatScalar } from "./format";
import { stopDragStart } from "../coarse";
import { useSeriesColors } from "./chartCore";
import { layoutLadder, metricsFor } from "./ladderLayout";
import "./ladderView.css";

/** How far each piece of the flow spills over its neighbors, so no hairline shows where they meet. */
const SEAM = 0.8;
const fmt3 = (x: number) => (Math.round(x * 1000) / 1000).toFixed(3);

function amount(p: LadderPayload, k: number, v: number): string {
  const f = p.resources[k].format;
  return f ? formatNumberWithAnnotation(v, f) : formatScalar(Math.round(v * 1e4) / 1e4);
}

/** What an option serves, by criterion, against the most any option serves. */
function ValueBar({ p, i, colors }: { p: LadderPayload; i: number; colors: string[] }) {
  const most = Math.max(1e-9, ...p.options.map((o) => o.value.reduce((s, v) => s + Math.max(0, v), 0)));
  return (
    <div className="sol-ladder__bar">
      {p.options[i].value.map((v, j) => <i key={j} style={{ width: `${(Math.max(0, v) / most) * 100}%`, background: colors[j % colors.length] }} />)}
    </div>
  );
}

/** An option's costs as a person reads them: each named, a yes/no one only when yes, and none the options all share. */
function costText(p: LadderPayload, i: number): string {
  return p.resources.map((r, k) => {
    const c = p.options[i].costs[k];
    if (p.options.every((o) => o.costs[k] === c)) return null;
    if (r.logical) return c ? r.name : null;
    return `${r.name} ${amount(p, k, c)}`;
  }).filter((x): x is string => x != null).join(" · ");
}

function RungCard({ p, e, colors, act }: { p: LadderPayload; e: LadderEdge; colors: string[]; act?: (a: LadderAction) => void }) {
  const o = p.options[e.pick];
  const pickable = act && (e.kind === "close" || e.kind === "chosen" || e.kind === "passed");
  const instead = p.edges.find((x) => x.from === e.from && x.kind === "chosen");
  const onClick = !pickable ? undefined
    : e.kind === "chosen" ? () => act!({ remove: o.name })
    : () => act!({ add: o.name, instead: instead && p.options[instead.pick].name });
  const costs = costText(p, e.pick);
  const body = (
    <>
      <div className="sol-ladder__pick"><span className="sol-ladder__name">{o.name}</span><span className="sol-ladder__mono">{fmt3(o.score)}</span></div>
      {costs && <div className="sol-ladder__mono">{costs}</div>}
      <ValueBar p={p} i={e.pick} colors={colors} />
      {e.struck.length > 0 && <div className="sol-ladder__struck"><span>Rules out</span>{e.struck.map((i) => <s key={i}>{p.options[i].name}</s>)}</div>}
    </>
  );
  const cls = `sol-ladder__card is-${e.kind}`;
  return pickable
    ? <button type="button" className={cls} aria-pressed={e.kind === "chosen"} onClick={onClick} onPointerDown={stopDragStart}>{body}</button>
    : <div className={cls}>{body}</div>;
}

function SourceCard({ p, colors }: { p: LadderPayload; colors: string[] }) {
  return (
    <div className="sol-ladder__card sol-ladder__source">
      <div className="sol-ladder__key">
        {p.criteria.map((c, j) => <span key={c}><i style={{ background: colors[j % colors.length] }} />{c}</span>)}
      </div>
      {p.resources.length > 0 && (
        <div className="sol-ladder__key sol-ladder__mono">
          {p.resources.map((r) => <span key={r.name}>{r.name}{r.floor != null ? ` ≥${formatScalar(r.floor)}` : ""}{r.limit != null ? ` ≤${formatScalar(r.limit)}` : ""}</span>)}
        </div>
      )}
      {p.ruledOut.length > 0 && <div className="sol-ladder__struck"><span>Ruled out</span>{p.ruledOut.map((n) => <s key={n}>{n}</s>)}</div>}
    </div>
  );
}

/** The Choice Ladder figure: value flows down and each card takes what its option serves. Forks split the flow by score
 *  and rejoin where the paths meet again; the plan's own path is drawn stronger. With `onAction` a fork's card takes that
 *  option. */
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
    const b = L.boxes.get(key);
    if (!b) return null;
    return (
      <div key={key} ref={(el) => { if (el) refs.current.set(key, el); else refs.current.delete(key); }}
        className="sol-ladder__slot" style={{ left: b.x, top: b.y, width: b.w, minHeight: L.minHeight.get(key) }}>{node}</div>
    );
  };

  return (
    <div className="sol-ladder" style={{ width, height, ["--chart-fscale" as string]: fscale }}>
      <div className="sol-ladder__scroll" onWheel={(e) => e.stopPropagation()}>
        <div className="sol-ladder__stage" style={{ width: L.width, height: heights ? L.height : undefined, visibility: heights ? "visible" : "hidden" }}>
          <svg className="sol-ladder__svg" width={L.width} height={heights ? L.height : 0} aria-hidden="true">
            {[false, true].map((onMain) => (
              <g key={String(onMain)} className={`sol-ladder__flow${onMain ? " is-main" : ""}`} strokeWidth={SEAM}>
                {L.pieces.map((x, i) => x.kind === "need" || L.onMain(x) !== onMain ? null : x.kind === "link"
                  ? <path key={i} d={x.d} className="sol-ladder__link" strokeWidth={x.width + SEAM} />
                  : <path key={i} d={x.d} />)}
              </g>
            ))}
            {L.pieces.map((x, i) => x.kind === "need" && <path key={i} d={x.d} className="sol-ladder__need" />)}
          </svg>
          {slot("source", <SourceCard p={p} colors={colors} />)}
          {p.edges.map((e, i) => slot(`e${i}`, <RungCard p={p} e={e} colors={colors} act={onAction} />))}
        </div>
      </div>
    </div>
  );
}
