import { useSyncExternalStore, useState, useRef, useEffect } from "react";
import { IS_MOBILE } from "../coarse";
import { commentStore, commentAuthorStore, commentsPanelUi, type Comment } from "../commentStore";
import { registerChrome } from "../chromeToggle";
import { flyToNodeAndFlash } from "../flyToNode";
import { getEditor } from "../process";
import { nodeDisplayName } from "../catalogUtils";
import "./commentsPanel.css";
import { CloseIcon } from "./CloseIcon";

// Lucide "message-square".
const CommentSvg = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

function ComposeRow({ nodeId, onAdded }: { nodeId: string; onAdded: () => void }) {
  const [text, setText] = useState("");
  const author = useSyncExternalStore(commentAuthorStore.subscribe, commentAuthorStore.get);

  function submit() {
    if (text.trim() === "") return;
    commentStore.add(nodeId, author, text.trim());
    setText("");
    onAdded();
  }

  return (
    <div className="solenoid-comment-compose">
      <textarea
        className="solenoid-comment-compose__input"
        value={text}
        placeholder="Add a comment…"
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <button type="button" className="solenoid-comment-compose__btn" onClick={submit} disabled={text.trim() === ""}>
        Post
      </button>
    </div>
  );
}

/** The Comments HUD panel — node-anchored threads; like the other HUD layers it
 *  owns its state and its own registerChrome("comments") call. */
export function CommentsPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [composeFor, setComposeFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!IS_MOBILE || collapsed) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setCollapsed(true);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [collapsed]);

  useSyncExternalStore(commentStore.subscribe, commentStore.version);
  const author = useSyncExternalStore(commentAuthorStore.subscribe, commentAuthorStore.get);
  const forcedOpen = useSyncExternalStore(commentsPanelUi.subscribe, commentsPanelUi.isOpen);
  useEffect(() => {
    if (!forcedOpen) return;
    setCollapsed(false);
    const focusId = commentsPanelUi.consumeFocusNode();
    if (focusId) setComposeFor(focusId);
    commentsPanelUi.setOpen(false);
  }, [forcedOpen]);

  const all = commentStore.list();
  const unresolvedCount = all.filter((c) => !c.resolved).length;

  useEffect(() => {
    if (all.length === 0 && !composeFor) return;
    return registerChrome("comments", { isOpen: () => !collapsed, setOpen: (o) => setCollapsed(!o) });
  }, [collapsed, all.length, composeFor]);
  if (all.length === 0 && !composeFor) return null;

  const editor = getEditor();
  const nodeLabel = (nodeId: string) => {
    const node = editor?.getNode(nodeId);
    return node ? nodeDisplayName(node) : "(deleted node)";
  };

  const trigger = (
    <button
      type="button"
      className="solenoid-comments-layer__trigger"
      title={collapsed ? `Show ${all.length} comment${all.length !== 1 ? "s" : ""}` : "Collapse comments"}
      onClick={() => setCollapsed((c) => !c)}
    >
      <CommentSvg />
      {collapsed && all.length > 0 && <span className="solenoid-comments-layer__count">{unresolvedCount || all.length}</span>}
    </button>
  );

  const row = (c: Comment) => (
    <div key={c.id} className={`solenoid-comment${c.resolved ? " solenoid-comment--resolved" : ""}`}>
      <div className="solenoid-comment__head" onClick={() => flyToNodeAndFlash(c.nodeId)}>
        <span className="solenoid-comment__node">{nodeLabel(c.nodeId)}</span>
        <span className="solenoid-comment__author">{c.author}</span>
      </div>
      <div className="solenoid-comment__text">{c.text}</div>
      <div className="solenoid-comment__actions">
        <button type="button" className="solenoid-comment__resolve" onClick={() => commentStore.update(c.id, { resolved: !c.resolved })}>
          {c.resolved ? "Reopen" : "Resolve"}
        </button>
        <button type="button" className="solenoid-comment__remove" aria-label="Delete" title="Delete" onClick={() => commentStore.remove(c.id)}>
          <CloseIcon size={12} />
        </button>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={`solenoid-comments-layer${collapsed ? " solenoid-comments-layer--collapsed" : ""}`}>
      {trigger}
      {!collapsed && (
        <div className="solenoid-comments-layer__author">
          <input
            type="text"
            placeholder="Your name"
            value={author}
            onChange={(e) => commentAuthorStore.set(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {!collapsed && composeFor && (
        <div className="solenoid-comment solenoid-comment--compose-target">
          <div className="solenoid-comment__head">
            <span className="solenoid-comment__node">{nodeLabel(composeFor)}</span>
          </div>
          <ComposeRow nodeId={composeFor} onAdded={() => setComposeFor(null)} />
        </div>
      )}
      {!collapsed && all.map(row)}
    </div>
  );
}
