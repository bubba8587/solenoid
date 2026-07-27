import { useLayoutEffect, useRef, useState } from "react";
import type { MermaidNode as MermaidNodeType } from "../rete-nodes";
import { LazySelect } from "./LazySelect";
import { NodeShell, type NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { useConnectedInputs } from "./inlineInput";
import { MermaidView } from "./MermaidView";
import { processGraph } from "../process";

// Starter diagrams — picking one drops a minimal, valid example of that mermaid
// type into the source so the user has a working shape to edit, instead of a
// blank page + a syntax-error hunt. Kept small; the point is the skeleton.
const MERMAID_TEMPLATES: ReadonlyArray<{ label: string; source: string }> = [
  { label: "Flowchart", source: "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do this]\n  B -->|No| D[Do that]" },
  { label: "Sequence", source: "sequenceDiagram\n  Alice->>Bob: Request\n  Bob-->>Alice: Response\n  Alice->>Bob: Ack" },
  { label: "Class", source: "classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  Animal <|-- Dog\n  Animal <|-- Cat" },
  { label: "State", source: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: stop\n  Running --> [*]" },
  { label: "Entity relationship", source: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains" },
  { label: "Gantt", source: "gantt\n  title Schedule\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Design :a1, 2026-01-01, 20d\n  Build  :after a1, 30d" },
  { label: "Pie", source: "pie showData\n  title Share\n  \"A\" : 45\n  \"B\" : 30\n  \"C\" : 25" },
  { label: "Mindmap", source: "mindmap\n  root((Idea))\n    Branch A\n      Leaf 1\n      Leaf 2\n    Branch B" },
  { label: "User journey", source: "journey\n  title My day\n  section Morning\n    Wake up: 3: Me\n    Coffee: 5: Me\n  section Work\n    Code: 4: Me" },
  { label: "Git graph", source: "gitGraph\n  commit\n  branch dev\n  checkout dev\n  commit\n  checkout main\n  merge dev" },
];

export function MermaidComponent({ data, emit }: NodeProps<MermaidNodeType>) {
  const connected = useConnectedInputs(data.id);
  const sourceWired = connected.has("source");
  const source = sourceWired ? data.cachedSource : (data.stringLiterals.source ?? "");

  function applyTemplate(src: string) {
    data.stringLiterals.source = src;
    setDraft(src);
    void processGraph();
  }

  // Local draft while typing; commit to the node + recompute on blur only (Enter
  // must insert a newline in a diagram, so this can't use the Enter-commits helper).
  const [draft, setDraft] = useState(data.stringLiterals.source ?? "");
  useLayoutEffect(() => { setDraft(data.stringLiterals.source ?? ""); }, [data.stringLiterals.source]);
  function commit() {
    if (draft === (data.stringLiterals.source ?? "")) return;
    data.stringLiterals.source = draft;
    void processGraph();
  }

  // The source socket sits centered on the editor (its main feed), measured against
  // the card so it lines up with the textarea / preview block.
  const feedRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const t = el.offsetTop + el.offsetHeight / 2 - 6;
    setTop((prev) => (prev === t ? prev : t));
  });
  const sourcePort = data.inputs.source;

  return (
    <NodeShell
      node={data}
      emit={emit}
      collapsible={false}
      leading={sourcePort && top !== undefined
        ? <NodeSocket side="input" socketKey="source" nodeId={data.id} emit={emit} payload={sourcePort.socket} top={top} />
        : null}
    >
      {!sourceWired && (
        <LazySelect
          className="solenoid-node__op-select solenoid-mermaid-template"
          value=""
          title="Insert a starter diagram"
          onChange={(e) => { const t = MERMAID_TEMPLATES[Number(e.target.value)]; if (t) applyTemplate(t.source); }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <option value="" disabled>Template…</option>
          {MERMAID_TEMPLATES.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
        </LazySelect>
      )}
      <div ref={feedRef} style={{ position: "relative" }}>
        {sourceWired ? (
          <div className="solenoid-mermaid-source solenoid-mermaid-source--wired">connected</div>
        ) : (
          <textarea
            className="solenoid-mermaid-source"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      <MermaidView source={source} className="solenoid-mermaid--card" />
    </NodeShell>
  );
}
