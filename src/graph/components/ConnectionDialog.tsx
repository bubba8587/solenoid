import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ClassicPreset } from "rete";
import { connectionDialog } from "../connectionDialogStore";
import { listEndpoints, findEndpoint, type Endpoint } from "../nodeNames";
import { fuzzyScore } from "../fuzzy";
import { canConnect, type SocketDataType } from "../sockets";
import { getEditor, processGraph } from "../process";
import { IS_COARSE } from "../coarse";
import type { SolenoidConnection } from "../schemes";
import { useFocusTrap } from "./useFocusTrap";
import { useEscapeToClose } from "./useEscapeToClose";
import "./connectionDialog.css";

const TYPE_LABEL: Record<SocketDataType, string> = {
  number: "Number", numlist: "Number/List", list: "List", string: "Text",
  strlist: "Text list", strcombo: "Text/List", date: "Date", datelist: "Date list",
  datecombo: "Date/List", complex: "Complex", complexlist: "Complex list",
  complexcombo: "Complex/List", complextable: "Complex matrix",
  logical: "Boolean", logicallist: "Boolean list", logicalcombo: "Boolean/List", logicaltable: "Boolean matrix",
  table: "Matrix", strtable: "Text matrix",
  datetable: "Date matrix", anytable: "Matrix (any)", anylist: "List (any)", anycombo: "Any value or list", anydata: "Any value, list or matrix", frame: "Frame", cube: "Cube",
  lambda: "Lambda", chart: "Chart", document: "Document", any: "Any value", trueany: "Anything",
};
const typeName = (t?: SocketDataType) => (t ? TYPE_LABEL[t] : "—");

// ─── Endpoint combobox ────────────────────────────────────────────────────────
// Conduit lanes are plumbing, not destinations — 8 declared lanes per block
// swamp the list, so they're hidden unless the user opts in. Matched by
// constructor name, not instanceof (see the FormulaPopup precedent).
const isPlumbing = (nodeId: string) => {
  const name = (getEditor()?.getNode(nodeId) as { constructor?: { name?: string } } | undefined)
    ?.constructor?.name;
  return name === "ConduitNode";
};

function EndpointCombo({
  side, value, onChange, placeholder, autoFocus, openOnly, showConduits,
}: {
  side: "output" | "input";
  value: Endpoint | null;
  onChange: (e: Endpoint | null) => void;
  placeholder: string;
  autoFocus?: boolean;
  openOnly: boolean;
  showConduits: boolean;
}) {
  const all = useMemo(() => {
    let eps = listEndpoints(side);
    const sel = value ? `${value.nodeId} ${value.socketKey}` : "";
    // Conduit lanes hidden unless opted in; the selected endpoint survives
    // every filter (same rule as the open-only one below).
    if (!showConduits) {
      eps = eps.filter((e) => `${e.nodeId} ${e.socketKey}` === sel || !isPlumbing(e.nodeId));
    }
    if (!openOnly) return eps;
    // "Open" = no existing cable on that socket. The currently-selected one is
    // always kept (so an edit prefill / current pick doesn't vanish).
    const used = new Set<string>();
    for (const c of getEditor()?.getConnections() ?? []) {
      used.add(side === "input" ? `${c.target}\u0000${c.targetInput}` : `${c.source}\u0000${c.sourceOutput}`);
    }
    return eps.filter((e) => {
      const k = `${e.nodeId}\u0000${e.socketKey}`;
      return k === sel || !used.has(k);
    });
  }, [side, openOnly, showConduits, value]);
  const [query, setQuery] = useState(value?.text ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Sync the field text only when a value is actually set (prefill / pick) — not
  // when typing clears the selection to null, which would wipe what was typed.
  useEffect(() => { if (value) setQuery(value.text); }, [value]);

  const results = useMemo(() => {
    const q = query.trim();
    // Selected and the box still shows its text → list everything (browse).
    if (!q || (value && q === value.text)) return all;
    return all
      .map((e) => ({ e, s: fuzzyScore(q, e.text) }))
      .filter((x): x is { e: Endpoint; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e);
  }, [all, query, value]);

  const pick = (e: Endpoint) => { onChange(e); setQuery(e.text); setOpen(false); };

  return (
    <div className="conn-dialog__combo">
      <input
        className="conn-dialog__input"
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => { setQuery(e.target.value); onChange(null); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && results[active]) { e.preventDefault(); pick(results[active]); }
        }}
        spellCheck={false}
      />
      {open && results.length > 0 && (
        <div className="conn-dialog__menu">
          {results.slice(0, 60).map((e, i) => (
            <button
              type="button"
              key={`${e.nodeId}:${e.socketKey}`}
              className={`conn-dialog__opt${i === active ? " conn-dialog__opt--active" : ""}`}
              // mousedown (not click) so it fires before the input's blur.
              onMouseDown={(ev) => { ev.preventDefault(); pick(e); }}
            >
              <span className="conn-dialog__opt-node">{e.nodeName}</span>
              <span className="conn-dialog__opt-sep">:</span>
              <span className="conn-dialog__opt-sock">{e.socketLabel}</span>
              <span className="conn-dialog__opt-type">{typeName(e.dataType)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────────────
export function ConnectionDialog() {
  const req = useSyncExternalStore(connectionDialog.subscribe, connectionDialog.get);
  const [src, setSrc] = useState<Endpoint | null>(null);
  const [tgt, setTgt] = useState<Endpoint | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  // Conduit lanes are noise for most wiring tasks — hidden by default.
  const [showConduits, setShowConduits] = useState(false);
  const initedFor = useRef<ConnDialogReqRef>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(!!req, dialogRef);

  // Initialize from the request (edit prefill, or socket prefill, or blank).
  useEffect(() => {
    if (!req) { initedFor.current = null; return; }
    if (initedFor.current === req) return;
    initedFor.current = req;
    let s: Endpoint | null = null, t: Endpoint | null = null;
    if (req.editId) {
      const c = getEditor()?.getConnections().find((x) => x.id === req.editId);
      if (c) {
        s = findEndpoint("output", c.source, c.sourceOutput) ?? null;
        t = findEndpoint("input", c.target, c.targetInput) ?? null;
      }
    }
    if (req.src) s = findEndpoint("output", req.src.nodeId, req.src.socketKey) ?? s;
    if (req.tgt) t = findEndpoint("input", req.tgt.nodeId, req.tgt.socketKey) ?? t;
    setSrc(s);
    setTgt(t);
  }, [req]);

  const error = useMemo(() => {
    if (!src || !tgt) return null;
    if (src.nodeId === tgt.nodeId) return "A node can't wire to itself.";
    if (src.dataType && tgt.dataType && !canConnect(src.dataType, tgt.dataType)) {
      return `Incompatible types: ${typeName(src.dataType)} → ${typeName(tgt.dataType)}.`;
    }
    const dup = getEditor()?.getConnections().some(
      (c) => c.source === src.nodeId && c.sourceOutput === src.socketKey &&
             c.target === tgt.nodeId && c.targetInput === tgt.socketKey &&
             c.id !== req?.editId,
    );
    if (dup) return "These are already connected.";
    return null;
  }, [src, tgt, req]);

  useEscapeToClose(() => connectionDialog.close(), !!req, { capture: true });

  if (!req) return null;

  async function connect() {
    const editor = getEditor();
    if (!editor || !src || !tgt || error) return;
    const srcNode = editor.getNode(src.nodeId);
    const tgtNode = editor.getNode(tgt.nodeId);
    if (!srcNode || !tgtNode) return;
    // Editing re-wires: drop the old cable first.
    if (req?.editId) { try { await editor.removeConnection(req.editId); } catch { /* gone */ } }
    // Single-connection inputs: replace whatever's already on the target.
    for (const c of editor.getConnections().filter((c) => c.target === tgt.nodeId && c.targetInput === tgt.socketKey)) {
      try { await editor.removeConnection(c.id); } catch { /* gone */ }
    }
    try {
      await editor.addConnection(
        new ClassicPreset.Connection(srcNode, src.socketKey, tgtNode, tgt.socketKey) as unknown as SolenoidConnection,
      );
      await processGraph();
    } catch { /* the connectioncreate pipe vetoed it */ }
    connectionDialog.close();
  }

  return (
    <div className="conn-dialog__overlay" onPointerDown={() => connectionDialog.close()}>
      <div ref={dialogRef} className="conn-dialog" role="dialog" aria-modal="true" aria-label={req.editId ? "Edit connection" : "Add connection"} onPointerDown={(e) => e.stopPropagation()}>
        <div className="conn-dialog__header">
          <div className="conn-dialog__title">{req.editId ? "Edit connection" : "Add connection"}</div>
          <label className="conn-dialog__check">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open sockets only
          </label>
          <label className="conn-dialog__check" title="Conduit lane sockets are hidden from the lists unless enabled">
            <input type="checkbox" checked={showConduits} onChange={(e) => setShowConduits(e.target.checked)} />
            Show Conduits
          </label>
        </div>

        <label className="conn-dialog__label">From (output)</label>
        {/* No autofocus on touch — the keyboard would cover the dialog. */}
        <EndpointCombo side="output" value={src} onChange={setSrc} placeholder="Search a node's output…" autoFocus={!IS_COARSE} openOnly={openOnly} showConduits={showConduits} />

        <div className="conn-dialog__arrow" aria-hidden="true">↓</div>

        <label className="conn-dialog__label">To (input)</label>
        <EndpointCombo side="input" value={tgt} onChange={setTgt} placeholder="Search a node's input…" openOnly={openOnly} showConduits={showConduits} />

        <div className="conn-dialog__error">{error ?? " "}</div>

        <div className="conn-dialog__buttons">
          <button type="button" className="conn-dialog__btn" onClick={() => connectionDialog.close()}>Cancel</button>
          <button
            type="button"
            className="conn-dialog__btn conn-dialog__btn--primary"
            disabled={!src || !tgt || !!error}
            onClick={() => void connect()}
          >
            {req.editId ? "Re-wire" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Identity tag for the init guard (the request object reference).
type ConnDialogReqRef = ReturnType<typeof connectionDialog.get>;
