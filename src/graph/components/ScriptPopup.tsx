import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { scriptPopup } from "../scriptPopupStore";
import { getOwningEditor } from "../activeGraph";
import { nodeKindOf, NODE_KIND_ACCENTS } from "../rete-nodes";
import type { ScriptNode } from "../rete-nodes";
import { appThemeStore } from "../appTheme";
import { groupMembershipStore } from "../groupMembership";
import { themeAccent, contrastInk, darkenAccent } from "../palette";
import { applyScriptChange } from "./expressionEdit";
import { JsEditor } from "./JsEditor";
import { PopupShell } from "./PopupShell";
import { nodeDisplayName } from "../catalogUtils";
import "./ScriptPopup.css";

function scriptNodeOf(nodeId: string | null): ScriptNode | null {
  if (!nodeId) return null;
  const n = getOwningEditor(nodeId)?.getNode(nodeId);
  // Constructor NAME, never instanceof — Vite hot swaps replace the class objects.
  return n?.constructor.name === "ScriptNode" ? (n as ScriptNode) : null;
}

/** The Script editor popup, mounted once in App and opened from the Script card.
 *  The source is written ONCE on exit, never per keystroke — a commit re-derives the
 *  parameter sockets, and a half-typed parameter list would prune live cables. */
export function ScriptPopup() {
  const nodeId = useSyncExternalStore(scriptPopup.subscribe, scriptPopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  useSyncExternalStore(groupMembershipStore.subscribe, groupMembershipStore.version);

  const [text, setText] = useState("");
  const initedFor = useRef<string | null>(null);
  const textRef = useRef("");
  const committedRef = useRef("");

  function commit(id: string | null) {
    const node = scriptNodeOf(id);
    if (!node) return;
    if (textRef.current === committedRef.current) return;
    committedRef.current = textRef.current;
    void applyScriptChange(node, textRef.current);
  }

  function commitAndClose() {
    commit(initedFor.current);
    scriptPopup.close();
  }

  // Commit the previously-open node first: a direct A→B open must not drop A's edit.
  useEffect(() => {
    if (!nodeId) { commit(initedFor.current); initedFor.current = null; return; }
    if (initedFor.current === nodeId) return;
    commit(initedFor.current);
    initedFor.current = nodeId;
    const seed = scriptNodeOf(nodeId)?.expr ?? "";
    setText(seed);
    textRef.current = seed;
    committedRef.current = seed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const node = scriptNodeOf(nodeId);
  if (!node) return null;

  // Mirror NodeCard's accent + group-color CSS vars so the chrome matches the node.
  const mode = appThemeStore.getMode();
  const rawAccent = NODE_KIND_ACCENTS[nodeKindOf(node)];
  const groupColor = groupMembershipStore.color(node.id);
  const style: CSSProperties = {};
  const cssVars = style as Record<string, string>;
  if (rawAccent) {
    const accent = themeAccent(rawAccent, mode);
    cssVars["--node-accent"] = accent;
    cssVars["--node-accent-ink"] = contrastInk(accent);
    cssVars["--node-accent-dark"] = darkenAccent(rawAccent);
  }
  if (groupColor) { cssVars["--group-color"] = themeAccent(groupColor, mode); cssVars["--group-color-dark"] = darkenAccent(groupColor); }

  return (
    <PopupShell
      title={nodeDisplayName(node)}
      onClose={() => commitAndClose()}
      cardClassName="script-popup"
      grouped={!!groupColor}
      cardStyle={style}
      pinNodeId={node.id}
    >
      <div className="script-popup__body">
        <JsEditor
          value={text}
          onChange={(next) => { setText(next); textRef.current = next; }}
          placeholder="(x) => x * 2"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitAndClose(); }
          }}
        />
        {node.cachedError && <div className="script-popup__error">{node.cachedError}</div>}
      </div>
    </PopupShell>
  );
}
