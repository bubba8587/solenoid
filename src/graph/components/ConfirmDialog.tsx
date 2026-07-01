import { useEffect, useSyncExternalStore } from "react";
import { confirmStore, answerConfirm } from "../confirmStore";
import "./confirmDialog.css";

/**
 * Renders the in-app confirmation modal whenever a confirm is pending
 * (see confirmStore). Mounted once near the canvas root. Enter confirms,
 * Escape / overlay-click cancels.
 */
export function ConfirmDialog() {
  const pending = useSyncExternalStore(confirmStore.subscribe, confirmStore.get);

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); answerConfirm(false); }
      if (e.key === "Enter")  { e.preventDefault(); answerConfirm(true); }
    }
    // Capture so it wins over the canvas's global shortcut handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending]);

  if (!pending) return null;

  return (
    <div className="solenoid-confirm__overlay" onPointerDown={() => answerConfirm(false)}>
      <div className="solenoid-confirm__dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="solenoid-confirm__message">{pending.message}</div>
        <div className="solenoid-confirm__buttons">
          <button
            type="button"
            className="solenoid-confirm__btn"
            onClick={() => answerConfirm(false)}
          >
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className="solenoid-confirm__btn solenoid-confirm__btn--primary"
            onClick={() => answerConfirm(true)}
            autoFocus
          >
            {pending.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
