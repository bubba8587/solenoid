import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ClassicPreset } from "rete";
import { inspectorStore } from "../inspectorStore";
import { reportStore } from "../reportStore";
import { getActiveEditor } from "../activeGraph";
import { compositePassStore } from "../compositeEditorStore";
import { describeNode, nodeName, catalogTypeOf } from "../catalogUtils";
import { NODE_EXCEL } from "../nodeExcel";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";
import { cableValueStore } from "../cableValueStore";
import { isSolError } from "../errorValue";
import { valueChipFor } from "./ValueChip";
import { ErrorChip } from "./ErrorChip";
import { CloseIcon } from "./CloseIcon";
import "./InspectorPanel.css";

// The node Inspector: a right-docked panel (the pinned Report's chrome pattern
// — fixed column between the measured chrome envelopes, canvas squeezed by
// `html.sol-inspector-docked`) reading the ACTIVE surface's selected node.
// Selection has no push store (same as SelectionActionsBar), so a light poll
// tracks it; values refresh on compositePassStore's per-pass tick.

const POLL_MS = 150;

type AnyNode = ClassicPreset.Node & {
  label?: string;
  selected?: boolean;
  cachedResult?: unknown;
  cachedValue?: unknown;
  cachedString?: unknown;
  cachedList?: unknown;
};

function selectedNode(): AnyNode | null {
  const editor = getActiveEditor();
  if (!editor) return null;
  const sel = editor.getNodes().filter((n) => (n as AnyNode).selected === true);
  return (sel[0] as AnyNode | undefined) ?? null;
}

function outputValue(node: AnyNode, key: string): unknown {
  const live = cableValueStore.get(node.id, key);
  if (live !== undefined && live !== null) return live;
  return node.cachedResult ?? node.cachedValue ?? node.cachedString ?? node.cachedList;
}

function socketDot(socket: ClassicPreset.Socket | undefined): ReactNode {
  const t = socket instanceof SolenoidSocket ? socket.dataType : null;
  return (
    <span
      className="inspector-sockdot"
      style={{ background: t ? SOCKET_COLORS[t] : "var(--sock-any)" }}
      title={t ?? undefined}
    />
  );
}

function renderValue(v: unknown): ReactNode {
  if (v === undefined || v === null) return <span className="inspector-empty">—</span>;
  if (isSolError(v)) return <ErrorChip err={v} />;
  const chip = valueChipFor(v, { size: "sm" });
  if (chip) return chip;
  if (Array.isArray(v)) {
    const flat = v.flat().slice(0, 6).map(String).join(", ");
    return <code className="inspector-value">[{flat}{v.flat().length > 6 ? ", …" : ""}]</code>;
  }
  if (typeof v === "object") return <span className="inspector-empty">object</span>;
  return <code className="inspector-value">{String(v)}</code>;
}

export function InspectorPanel() {
  const open = useSyncExternalStore(inspectorStore.subscribe, inspectorStore.get);
  useSyncExternalStore(compositePassStore.subscribe, compositePassStore.version);
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

  const editor = getActiveEditor();
  const conns = editor?.getConnections() ?? [];
  const label = node ? (node.label || nodeName(node) || node.constructor.name) : null;
  const catalogLabel = node ? nodeName(node) : null;
  const description = node ? describeNode(node) : null;
  const catalogType = node ? catalogTypeOf(node) : null;
  const excel = catalogType ? NODE_EXCEL[catalogType] ?? [] : [];

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
            {description && <p className="inspector-desc">{description}</p>}

            {excel.length > 0 && <div className="inspector-label">Excel</div>}
            {excel.map((eq) => (
              <div key={eq.excel} className="inspector-excel">
                <code className="inspector-excel__syntax">{eq.syntax}</code>
                {eq.note && <div className="inspector-excel__note">{eq.note}</div>}
              </div>
            ))}

            {Object.keys(node.inputs).length > 0 && <div className="inspector-label">Inputs</div>}
            {Object.entries(node.inputs).map(([key, input]) => {
              const sources = conns
                .filter((c) => c.target === node.id && c.targetInput === key)
                .map((c) => {
                  const src = editor?.getNode(c.source) as AnyNode | undefined;
                  return src ? (src.label || nodeName(src) || src.constructor.name) : c.source;
                });
              return (
                <div key={key} className="inspector-row">
                  {socketDot(input?.socket)}
                  <span className="inspector-row__key">{input?.label ?? key}</span>
                  <span className="inspector-row__meta">
                    {sources.length ? `← ${sources.join(", ")}` : "unwired"}
                  </span>
                </div>
              );
            })}

            {Object.keys(node.outputs).length > 0 && <div className="inspector-label">Outputs</div>}
            {Object.entries(node.outputs).map(([key, output]) => (
              <div key={key} className="inspector-row">
                {socketDot(output?.socket)}
                <span className="inspector-row__key">{output?.label ?? key}</span>
                <span className="inspector-row__value">{renderValue(outputValue(node, key))}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
