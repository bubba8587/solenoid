import { useSyncExternalStore } from "react";
import { noticeStore, dismissNotice } from "../noticeStore";
import "./noticeToasts.css";

/**
 * Renders the stack of active notices (see noticeStore) bottom-right of the
 * canvas. Mounted once near the canvas root, alongside ConfirmDialog. Each
 * toast is click-to-dismiss; most auto-expire, sticky ones (load/save failures)
 * stay until dismissed.
 */
export function NoticeToasts() {
  const notices = useSyncExternalStore(noticeStore.subscribe, noticeStore.get);
  if (notices.length === 0) return null;

  return (
    <div className="solenoid-notices">
      {notices.map((n) => (
        <div
          key={n.id}
          className={`solenoid-notice solenoid-notice--${n.tone}`}
          role="status"
          onPointerDown={() => dismissNotice(n.id)}
          title="Dismiss"
        >
          <span className="solenoid-notice__msg">{n.message}</span>
          <button
            type="button"
            className="solenoid-notice__close"
            aria-label="Dismiss"
            onPointerDown={(e) => {
              e.stopPropagation();
              dismissNotice(n.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
