import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ClassicPreset } from "rete";
import { inspectorStore } from "../inspectorStore";
import { reportStore } from "../reportStore";
import { getActiveEditor } from "../activeGraph";
import { describeNode, nodeName, catalogTypeOf } from "../catalogUtils";
import { buildFunctionReference, type FnRefRow } from "../functionReference";
import { SolenoidSocket, SOCKET_TYPE_LABELS } from "../sockets";
import { socketDocFor } from "../socketDocs";
import { frameHintFor } from "../frameHint";
import { SocketComponent } from "./SocketComponent";
import { FrameHintTable } from "./FrameHintLayer";
import { CloseIcon } from "./CloseIcon";
import "./InspectorPanel.css";

// The node Inspector: a right-docked panel (the pinned Report's chrome pattern
// — fixed column between the measured chrome envelopes, canvas squeezed by
// `html.sol-inspector-docked`) reading the ACTIVE surface's selected node.
// STATIC reference for the selected node and its current configuration, by
// author call (2026-08-17): the Function Reference derivation plus the node's
// socket roster described in plain English (SOCKET_TYPE_LABELS) — never live
// values (the card and its popups) and never live connections (the canvas and
// the Cable inspector). Selection has no push store (same as
// SelectionActionsBar), so a light poll tracks it.

const POLL_MS = 150;

// The Function Reference's generated rows, indexed by catalog type — the
// Inspector READS the same derivation the Reference overlay renders (catalog +
// nodeExcel merged in buildCatalog), never a second copy. Built lazily once.
let _frByType: Map<string, FnRefRow[]> | null = null;
function frRowsFor(catalogType: string | null): FnRefRow[] {
  if (!catalogType) return [];
  if (!_frByType) {
    _frByType = new Map();
    for (const row of buildFunctionReference()) {
      if (!row.catalogType) continue;
      _frByType.set(row.catalogType, [...(_frByType.get(row.catalogType) ?? []), row]);
    }
  }
  return _frByType.get(catalogType) ?? [];
}

type AnyNode = ClassicPreset.Node & {
  label?: string;
  selected?: boolean;
};

function socketRow(node: AnyNode, key: string, port: { label?: string; socket?: ClassicPreset.Socket } | undefined): ReactNode {
  const t = port?.socket instanceof SolenoidSocket ? port.socket.dataType : null;
  const doc = socketDocFor(node, key);
  const hint = frameHintFor(node, key);
  return (
    <div key={key}>
      <div className="inspector-row">
        {/* The REAL socket glyph (shape encodes type alongside color). */}
        <span className="inspector-sock">{port?.socket && <SocketComponent data={port.socket} />}</span>
        <span className="inspector-row__key">{port?.label ?? key}</span>
        <span className="inspector-row__meta">{t ? SOCKET_TYPE_LABELS[t] : ""}</span>
      </div>
      {doc && <div className="inspector-row__doc">{doc}</div>}
      {hint && (
        <div className="solenoid-frame-hint solenoid-frame-hint--inline">
          <FrameHintTable hint={hint} />
        </div>
      )}
    </div>
  );
}

function selectedNode(): AnyNode | null {
  const editor = getActiveEditor();
  if (!editor) return null;
  const sel = editor.getNodes().filter((n) => (n as AnyNode).selected === true);
  return (sel[0] as AnyNode | undefined) ?? null;
}

export function InspectorPanel() {
  const open = useSyncExternalStore(inspectorStore.subscribe, inspectorStore.get);
  const reportDocked = useSyncExternalStore(reportStore.subscribe, reportStore.isDocked);
  const [, setTick] = useState(0);
  const [node, setNode] = useState<AnyNode | null>(null);

  // The two right-side docks are exclusive; the report dock wins when it opens.
  useEffect(() => {
    if (open && reportDocked) inspectorStore.close();
  }, [open, reportDocked]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      const sel = selectedNode();
      setNode((prev) => (prev === sel ? prev : sel));
      setTick((n) => n + 1); // labels/wiring have no push store either
    }, POLL_MS);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;

  const label = node ? (node.label || nodeName(node) || node.constructor.name) : null;
  const catalogLabel = node ? nodeName(node) : null;
  const description = node ? describeNode(node) : null;
  const catalogType = node ? catalogTypeOf(node) : null;
  const frRows = frRowsFor(catalogType);
  const excel = frRows.filter((r) => r.excel !== null);
  const location = frRows[0]?.location ?? [];
  const packs = frRows[0]?.packs ?? [];

  return (
    <div className="inspector-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="inspector-head">
        <span className="inspector-head__title">Inspector</span>
        <button className="inspector-close" onClick={() => inspectorStore.close()} title="Close" aria-label="Close">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="inspector-body">
        {!node ? (
          <p className="inspector-note">Select a node.</p>
        ) : (
          <>
            <div className="inspector-name">{label}</div>
            <div className="inspector-type">
              {catalogLabel ?? node.constructor.name.replace(/Node$/, "")}
            </div>
            {location.length > 0 && (
              <div className="inspector-crumb">
                {location.join(" \u25b8 ")}{packs.length > 0 ? ` \u00b7 ${packs.join(", ")} pack` : ""}
              </div>
            )}
            {description && <p className="inspector-desc">{description}</p>}

            {excel.length > 0 && <div className="inspector-label">Excel</div>}
            {excel.map((eq) => (
              <div key={eq.excel} className="inspector-excel">
                <code className="inspector-excel__syntax">{eq.syntax}</code>
                {eq.note ? (
                  <div className="inspector-excel__note">{eq.note}</div>
                ) : !eq.parity ? (
                  <div className="inspector-excel__note">Differs from Excel.</div>
                ) : null}
              </div>
            ))}

            {Object.keys(node.inputs).length > 0 && <div className="inspector-label">Inputs</div>}
            {Object.entries(node.inputs).map(([key, input]) => socketRow(node, key, input))}

            {Object.keys(node.outputs).length > 0 && <div className="inspector-label">Outputs</div>}
            {Object.entries(node.outputs).map(([key, output]) => socketRow(node, key, output))}
          </>
        )}
      </div>
    </div>
  );
}
