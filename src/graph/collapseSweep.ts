// [[C88]] collapsedGroupCard. Console-only probe (driven by scripts/collapse-sweep.mjs): mounts one card per catalog type,
// measures every socket expanded and collapsed against the collapsed-card rules (tree/specs/floors/components.md
// § Collapsed), and against the handle bounds React Flow draws cables from, then removes the card again.
import { FLAT_CATALOG } from "./catalogUtils";
import { getEditor, getView, processGraph } from "./process";
import { collapseStore } from "./collapseStore";
import { devRfStores } from "./flow/devRfStores";
import { ClassicPreset } from "rete";
import { SolenoidSocket, canConnect } from "./sockets";

const frames = (n: number) =>
  new Promise<void>((r) => {
    const step = (left: number) => (left <= 0 ? r() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

type Box = { x: number; y: number; w: number; h: number };
const boxOf = (r: DOMRect): Box => ({ x: r.x, y: r.y, w: r.width, h: r.height });
const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;
const inside = (x: number, y: number, b: Box, slop: number) => x >= b.x - slop && x <= b.x + b.w + slop && y >= b.y - slop && y <= b.y + b.h + slop;

export interface SweepRow {
  type: string;
  inputs: number;
  outputs: number;
  expanded: string[];
  collapsed: string[];
  /** The collapsed card's height, for comparing a CSS change across every card. */
  collapsedH: number;
  /** Collapsed again with a cable into every input that some source card can feed. */
  wired: string[];
  /** What the collapsed body shows besides its sockets and pill: empty when the card says nothing about itself. */
  shows: string;
}

const SOURCES = ["number-input", "text-input", "boolean-input", "date-input", "list-input", "table-input", "frame-input", "cube-input", "lambda-make"];

/** How visible an element is: 0 when it or an ancestor inside the card is hidden. */
function shown(el: Element, stop: Element): number {
  let alpha = 1;
  for (let e: Element | null = el; e && e !== stop.parentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden") return 0;
    alpha *= Number(cs.opacity);
  }
  return alpha;
}

function rfBounds(nodeId: string): { zoom: number; source: Map<string, Box>; target: Map<string, Box> } | null {
  for (const store of devRfStores) {
    const st = store.getState();
    const n = st.nodeLookup.get(nodeId);
    if (!n) continue;
    const toMap = (list: { id?: string | null; x: number; y: number; width: number; height: number }[] | null | undefined) =>
      new Map((list ?? []).map((b) => [b.id ?? "", { x: b.x, y: b.y, w: b.width, h: b.height }]));
    return { zoom: st.transform[2], source: toMap(n.internals.handleBounds?.source), target: toMap(n.internals.handleBounds?.target) };
  }
  return null;
}

/** The keys that have a socket on screen now, by side. */
function presentKeys(nodeId: string): Set<string> {
  const wrap = getView()?.nodeElement(nodeId);
  const out = new Set<string>();
  for (const h of wrap?.querySelectorAll<HTMLElement>(".react-flow__handle") ?? []) {
    const b = h.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) out.add(`${h.classList.contains("source") ? "output" : "input"}:${h.dataset.handleid}`);
  }
  return out;
}

/** The collapsed body's visible content, sockets and pills aside: its text, or the kinds of element it draws. */
function collapsedContent(nodeId: string): string {
  const wrap = getView()?.nodeElement(nodeId);
  const card = wrap?.querySelector<HTMLElement>(".solenoid-node");
  const body = card?.querySelector<HTMLElement>(".solenoid-node__body");
  if (!card || !body) return "?";
  const parts: string[] = [];
  const walk = (el: Element) => {
    if (el.matches(".react-flow__handle, [data-socket-side], .solenoid-node__input-pill, .solenoid-node__output-pill")) return;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0 || shown(el, card) < 0.05) return;
    if (el.matches("svg, canvas, img, input, select, button, textarea")) {
      const tag = el.tagName.toLowerCase();
      const v = tag === "input" ? (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder : tag === "select" ? (el as HTMLSelectElement).value : "";
      const cls = el.getAttribute("class")?.split(" ")[0] ?? "";
      parts.push(v ? `${tag}:${v.slice(0, 16)}` : cls ? `${tag}.${cls}` : tag);
      return;
    }
    for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim()) parts.push((n.textContent ?? "").trim().slice(0, 20));
    for (const c of el.children) walk(c);
  };
  for (const c of body.children) walk(c);
  return parts.join(" | ");
}

function measure(nodeId: string, ports: { inputs: string[]; outputs: string[] }, collapsed: boolean): string[] {
  const view = getView();
  const wrap = view?.nodeElement(nodeId);
  if (!wrap) return ["no element"];
  const card = (wrap.querySelector(".solenoid-node, .solenoid-note, .solenoid-conduit") as HTMLElement | null) ?? (wrap.firstElementChild as HTMLElement);
  const cardBox = boxOf(card.getBoundingClientRect());
  const wrapBox = boxOf(wrap.getBoundingClientRect());
  const rf = rfBounds(nodeId);
  const out: string[] = [];
  const handles = [...wrap.querySelectorAll<HTMLElement>(".react-flow__handle")];
  const byKey = (side: "source" | "target", key: string) => handles.filter((h) => h.dataset.handleid === key && h.classList.contains(side));
  const pills = [...wrap.querySelectorAll<HTMLElement>(".solenoid-node__input-pill")].filter((p) => shown(p, card) > 0.05 && p.getBoundingClientRect().width > 0);

  const check = (side: "input" | "output", key: string) => {
    const rfSide = side === "input" ? "target" : "source";
    const found = byKey(rfSide, key);
    if (found.length === 0) { if (collapsed) out.push(`${side} ${key}: no socket`); return; }
    if (found.length > 1) out.push(`${side} ${key}: ${found.length} sockets`);
    const h = found[0];
    const b = boxOf(h.getBoundingClientRect());
    if (b.w === 0 || b.h === 0) { out.push(`${side} ${key}: zero size (hidden by display)`); return; }
    const x = cx(b), y = cy(b);
    // Cables end at React Flow's cached bounds, relative to the node wrapper in flow units.
    const cached = rf?.[rfSide].get(key);
    if (!cached) out.push(`${side} ${key}: React Flow has no bounds`);
    else if (rf) {
      const fx = wrapBox.x + (cached.x + cached.w / 2) * rf.zoom;
      const fy = wrapBox.y + (cached.y + cached.h / 2) * rf.zoom;
      const d = Math.hypot(fx - x, fy - y);
      if (d > 3) out.push(`${side} ${key}: cable end ${Math.round(d)}px off the socket`);
    }
    if (y < cardBox.y - 2 || y > cardBox.y + cardBox.h + 2) out.push(`${side} ${key}: outside the card vertically (${Math.round(y - cardBox.y)} of ${Math.round(cardBox.h)})`);
    const edge = side === "input" ? cardBox.x : cardBox.x + cardBox.w;
    const onPill = h.closest(".solenoid-node__pill-socket") || h.parentElement?.classList.contains("solenoid-node__pill-socket");
    if (!collapsed) {
      if (Math.abs(x - edge) > 10) out.push(`${side} ${key}: ${Math.round(x - edge)}px off its edge`);
      return;
    }
    if (side === "output") {
      if (shown(h, card) < 0.05) out.push(`output ${key}: invisible`);
      if (Math.abs(x - edge) > 10) out.push(`output ${key}: ${Math.round(x - edge)}px off the right edge`);
      return;
    }
    if (ports.inputs.length >= 2) {
      if (pills.length === 0) out.push(`input ${key}: no pill for ${ports.inputs.length} inputs`);
      else if (!pills.some((p) => inside(x, y, boxOf(p.getBoundingClientRect()), 4))) out.push(`input ${key}: not under the pill${onPill ? "" : " (not a pill socket)"}`);
    } else {
      if (shown(h, card) < 0.05) out.push(`input ${key}: invisible`);
      if (Math.abs(x - edge) > 10) out.push(`input ${key}: ${Math.round(x - edge)}px off the left edge`);
    }
  };
  for (const k of ports.inputs) check("input", k);
  for (const k of ports.outputs) check("output", k);
  if (collapsed && pills.length > 1) out.push(`${pills.length} input pills`);
  // A pill must sit wholly within the card's height, straddling its left edge like a socket dot.
  for (const p of pills) {
    const b = boxOf(p.getBoundingClientRect());
    const above = cardBox.y - b.y, below = b.y + b.h - (cardBox.y + cardBox.h);
    if (above > 1) out.push(`pill sticks ${Math.round(above)}px above the card (pill ${Math.round(b.h)}px, card ${Math.round(cardBox.h)}px)`);
    if (below > 1) out.push(`pill sticks ${Math.round(below)}px below the card (pill ${Math.round(b.h)}px, card ${Math.round(cardBox.h)}px)`);
    if (Math.abs(cx(b) - cardBox.x) > 3) out.push(`pill ${Math.round(cx(b) - cardBox.x)}px off the left edge`);
  }
  if (collapsed) {
    const ys = ports.outputs.map((k) => byKey("source", k)[0]).filter(Boolean).map((h) => cy(boxOf(h.getBoundingClientRect())));
    for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) {
      if (Math.abs(ys[i] - ys[j]) < 6) out.push(`outputs ${ports.outputs[i]} and ${ports.outputs[j]} overlap`);
    }
  }
  return out;
}

/** Wires every input a source card can feed, expanded (so sections open as they would in use), then collapses and measures. */
async function measureWired(node: { id: string; inputs: Record<string, unknown> }, ports: { inputs: string[]; outputs: string[] }): Promise<string[]> {
  const editor = getEditor();
  if (!editor || ports.inputs.length === 0) return [];
  const added: string[] = [];
  let wiredCount = 0;
  try {
    collapseStore.set(node.id, false);
    for (const key of ports.inputs) {
      const want = (node.inputs[key] as { socket?: unknown } | undefined)?.socket;
      if (!(want instanceof SolenoidSocket)) continue;
      for (const srcType of SOURCES) {
        const src = (FLAT_CATALOG.get(srcType) as { create?: () => object } | undefined)?.create?.() as
          { id: string; outputs: Record<string, { socket: unknown } | undefined> } | undefined;
        if (!src) continue;
        const outKey = Object.keys(src.outputs).find((k) => {
          const so = src.outputs[k]?.socket;
          return so instanceof SolenoidSocket && canConnect(so.dataType, want.dataType);
        });
        if (!outKey) continue;
        await editor.addNode(src as never);
        added.push(src.id);
        try {
          await editor.addConnection(new ClassicPreset.Connection(src as never, outKey as never, node as never, key as never) as never);
          wiredCount++;
        } catch { /* refused */ }
        break;
      }
    }
    if (wiredCount === 0) return [];
    await Promise.race([processGraph().catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
    await frames(4);
    collapseStore.set(node.id, true);
    await frames(6);
    return measure(node.id, ports, true).map((m) => `${m} [${wiredCount} wired]`);
  } finally {
    for (const c of editor.getConnections().filter((c) => added.includes(c.source))) {
      try { await editor.removeConnection(c.id); } catch { /* gone */ }
    }
    for (const id of added) { try { await editor.removeNode(id); } catch { /* gone */ } }
  }
}

async function sweepOne(type: string, create: () => object): Promise<SweepRow | null> {
  const editor = getEditor();
  if (!editor || !getView()) throw new Error("editor/view not ready");
  type SweepNode = { id: string; inputs: Record<string, unknown>; outputs: Record<string, unknown> };
  let node: SweepNode | null = null;
  try {
    node = create() as unknown as SweepNode;
    await editor.addNode(node as never);
    // Computed first, so value boxes, chips and figures take the size they have in use.
    await Promise.race([processGraph(node!.id).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
    await frames(4);
    const ports = { inputs: Object.keys(node!.inputs).filter((k) => node!.inputs[k]), outputs: Object.keys(node!.outputs).filter((k) => node!.outputs[k]) };
    const expanded = measure(node!.id, ports, false);
    // A mode shows only the sockets it reads; collapsed, the card owes exactly the ones it showed expanded.
    const shownKeys = presentKeys(node!.id);
    ports.inputs = ports.inputs.filter((k) => shownKeys.has(`input:${k}`));
    ports.outputs = ports.outputs.filter((k) => shownKeys.has(`output:${k}`));
    // `collapsible={false}` cards never collapse (selectionOps isCollapsible), so there is nothing to measure.
    if (getView()?.nodeElement(node!.id)?.querySelector(".solenoid-node--no-chevron")) return null;
    collapseStore.set(node!.id, true);
    await frames(6);
    const collapsed = measure(node!.id, ports, true);
    const collapsedH = Math.round(getView()?.nodeElement(node!.id)?.getBoundingClientRect().height ?? 0);
    const shows = collapsedContent(node!.id);
    const wired = (window as { __sweepWired?: boolean }).__sweepWired ? await measureWired(node!, ports) : [];
    return { type, inputs: ports.inputs.length, outputs: ports.outputs.length, expanded, collapsed, collapsedH, wired, shows };
  } catch (e) {
    return { type, inputs: 0, outputs: 0, expanded: [`threw: ${(e as Error).message}`], collapsed: [], collapsedH: 0, wired: [], shows: "?" };
  } finally {
    if (node) {
      collapseStore.set(node.id, false);
      try { await editor.removeNode(node.id); } catch { /* already gone */ }
    }
  }
}

async function sweep(only?: string[]): Promise<SweepRow[]> {
  const rows: SweepRow[] = [];
  for (const [type, entry] of FLAT_CATALOG) {
    if (only && !only.includes(type)) continue;
    const create = (entry as { create?: () => object }).create;
    if (typeof create !== "function") continue;
    const row = await sweepOne(type, create);
    if (row) rows.push(row);
  }
  return rows;
}

/** Leaves the given cards on the canvas, collapsed, in a row, for a screenshot. */
async function show(types: string[], expanded = false): Promise<void> {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  let x = 0;
  for (const type of types) {
    const create = (FLAT_CATALOG.get(type) as { create?: () => object } | undefined)?.create;
    if (!create) continue;
    const node = create() as unknown as { id: string };
    await editor.addNode(node as never);
    await view.moveNode(node.id, { x, y: 0 });
    await Promise.race([processGraph(node.id).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
    if (!expanded) collapseStore.set(node.id, true);
    x += expanded ? 340 : 260;
  }
  await frames(6);
}

declare global {
  interface Window {
    __solenoidCollapseSweep?: (only?: string[]) => Promise<SweepRow[]>;
    __solenoidCollapseShow?: (types: string[], expanded?: boolean) => Promise<void>;
  }
}
window.__solenoidCollapseSweep = sweep;
window.__solenoidCollapseShow = show;
