// [[C42]] htmlInCanvasRenderer

import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import type { View } from "./view";
import { parseColor } from "./cssColor";
import { cableAngleStore } from "./cableAngleStore";
import { socketFlipStore } from "./socketFlipStore";
import { SOCKET_COLORS } from "./sockets";
import { socketGlyphKind, COMBO_PAIRS, type GlyphKind } from "./hicSocketGlyph";

interface SnapSocket {
  key: string; side: "input" | "output"; x: number; y: number;
  kind: GlyphKind; color: number; color2: number | null;
}
export interface SnapCable {
  id: string;
  source: string; sourceOutput: string;
  target: string; targetInput: string;
  sx: number; sy: number; ex: number; ey: number;
  sourceAngleDeg: number | null;
  targetAngleDeg: number | null;
  sourceFlipped: boolean;
  targetFlipped: boolean;
  color: number;
}

function hexToNum(hex: string): number {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return Number.isFinite(n) ? n : 0x7a8296;
}
function rgbaToNum(css: string | null | undefined): number | null {
  if (!css) return null;
  const c = parseColor(css);
  return c ? ((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255) : null;
}
const _sockColorCache = new Map<string, number>();
function cssToNum(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return s.startsWith("#") ? hexToNum(s) : rgbaToNum(s);
}
function resolveSockColor(dataType: string | undefined): number {
  if (!dataType) return 0x7a8296;
  const expr = (SOCKET_COLORS as Record<string, string>)[dataType];
  if (!expr) return 0x7a8296;
  const m = /var\((--[^),]+)\)/.exec(expr);
  if (!m) return cssToNum(expr) ?? 0x7a8296;
  const name = m[1];
  const cached = _sockColorCache.get(name);
  if (cached !== undefined) return cached;
  let n = 0x7a8296;
  try { n = cssToNum(getComputedStyle(document.documentElement).getPropertyValue(name)) ?? 0x7a8296; } catch { /* default */ }
  _sockColorCache.set(name, n);
  return n;
}

export function snapshotCables(editor: NodeEditor<Schemes> | null, view: View | null): SnapCable[] | null {
  if (!view || !editor) return null;
  const t = view.transform ?? { k: 1, x: 0, y: 0 };
  const k = t.k > 0 ? t.k : 1;

  _sockColorCache.clear();
  const lookup = new Map<string, { input: Map<string, SnapSocket>; output: Map<string, SnapSocket> }>();

  for (const node of editor.getNodes()) {
    try {
      const pos = view.position(node.id);
      const el = view.nodeElement(node.id);
      if (!pos || !el) continue;
      if (el.querySelector(".solenoid-group") || el.classList.contains("solenoid-group")) continue;

      const ROOT_SEL = ".solenoid-node, .solenoid-note, .solenoid-conduit";
      const card = el.querySelector<HTMLElement>(ROOT_SEL)
        ?? (el.matches(ROOT_SEL) ? el : null);
      if (!card) continue;
      if (getComputedStyle(card).visibility === "hidden") continue;
      if (card.offsetWidth <= 0 || card.offsetHeight <= 0) continue;

      const elRect = el.getBoundingClientRect();
      const inputs = (node as { inputs?: Record<string, { socket?: { dataType?: string } }> }).inputs ?? {};
      const outputs = (node as { outputs?: Record<string, { socket?: { dataType?: string } }> }).outputs ?? {};
      const sockEls = el.querySelectorAll<HTMLElement>("[data-socket-key][data-socket-side]");
      const sockets: SnapSocket[] = [];
      const byKey = { input: new Map<string, SnapSocket>(), output: new Map<string, SnapSocket>() };
      for (const se of sockEls) {
        const key = se.getAttribute("data-socket-key");
        const sideAttr = se.getAttribute("data-socket-side");
        if (!key || (sideAttr !== "input" && sideAttr !== "output")) continue;
        const r = (se.querySelector<HTMLElement>(".react-flow__handle") ?? se).getBoundingClientRect();
        const onRight = (sideAttr === "output") !== socketFlipStore.get(node.id);
        const cx = onRight ? r.right : r.left, cy = r.top + r.height / 2;
        const dataType = (sideAttr === "input" ? inputs[key]?.socket : outputs[key]?.socket)?.dataType;
        const kind = socketGlyphKind(dataType);
        let color = resolveSockColor(dataType), color2: number | null = null;
        if (kind === "split" && dataType && COMBO_PAIRS[dataType]) {
          color = resolveSockColor(COMBO_PAIRS[dataType][0]);
          color2 = resolveSockColor(COMBO_PAIRS[dataType][1]);
        }
        const s: SnapSocket = {
          key,
          side: sideAttr,
          x: pos.x + (cx - elRect.left) / k,
          y: pos.y + (cy - elRect.top) / k,
          kind, color, color2,
        };
        sockets.push(s);
        byKey[sideAttr].set(key, s);
      }
      lookup.set(node.id, byKey);
    } catch { /* skip a node that won't read; keep the rest */ }
  }

  const cables: SnapCable[] = [];
  try {
    for (const conn of editor.getConnections()) {
      const src = lookup.get(conn.source)?.output.get(conn.sourceOutput);
      const tgt = lookup.get(conn.target)?.input.get(conn.targetInput);
      if (!src || !tgt) continue;
      cables.push({
        id: conn.id,
        source: conn.source, sourceOutput: conn.sourceOutput,
        target: conn.target, targetInput: conn.targetInput,
        sx: src.x, sy: src.y, ex: tgt.x, ey: tgt.y,
        sourceAngleDeg: cableAngleStore.get(conn.source, conn.sourceOutput),
        targetAngleDeg: cableAngleStore.get(conn.target, conn.targetInput),
        sourceFlipped: socketFlipStore.get(conn.source),
        targetFlipped: socketFlipStore.get(conn.target),
        color: src.color,
      });
    }
  } catch { /* connections unavailable — render nodes only */ }

  return cables;
}
