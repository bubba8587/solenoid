// [[C63]] oneRecordNode, [[C95]] commitOnEnter
import { useLayoutEffect, useRef, useState } from "react";
import { FieldResizeGrip } from "./FieldResizeGrip";

/** Commits on blur, not Enter, because Enter must insert a newline. Commit semantics stay with the caller. */
export function RecordLayoutField({ value, wired, onCommit }: {
  value: string;
  wired?: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { setDraft(value); }, [value]);
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
        onBlur={() => { if (draft !== value) onCommit(draft); }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <FieldResizeGrip targetRef={ref} />
    </div>
  );
}
