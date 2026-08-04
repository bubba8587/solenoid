import { useSyncExternalStore } from "react";
import { noticeStore, dismissNotice } from "../noticeStore";
import "./noticeToasts.css";

/** The active-notice stack, mounted once near the canvas root. */
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
