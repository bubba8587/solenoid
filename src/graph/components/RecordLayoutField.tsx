// [[B11]] maximalMerge, [[C95]] commitOnEnter
import { useLayoutEffect, useRef, useState } from "react";
import { usePendingDraft } from "../draftFlush";
import { FieldResizeGrip } from "./FieldResizeGrip";

/** Commits on blur, not Enter, because Enter must insert a newline; Escape reverts. Commit semantics stay with the caller. */
export function RecordLayoutField({ value, wired, onCommit }: {
  value: string;
  wired?: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const canceled = useRef(false);
  useLayoutEffect(() => { setDraft(value); }, [value]);
  usePendingDraft(!wired && draft !== value, () => onCommit(draft));
  if (wired) return <div className="solenoid-record-layout solenoid-record-layout--wired">connected</div>;
  return (
    <div className="solenoid-field-resizable">
      <textarea
        ref={ref}
        className="solenoid-record-layout"
        value={draft}
        placeholder="Layout"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { canceled.current = true; e.currentTarget.blur(); } }}
        onBlur={() => {
          if (canceled.current) { canceled.current = false; setDraft(value); return; }
          if (draft !== value) onCommit(draft);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <FieldResizeGrip targetRef={ref} />
    </div>
  );
}
