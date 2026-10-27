import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MermaidNode as MermaidNodeType } from "../nodeClasses";
import { LazySelect } from "./LazySelect";
import { NodeShell, type NodeProps } from "./nodeKit";
import { collapseStore } from "../collapseStore";
import { DiagramChip } from "./DiagramChip";
import { NodeSocket } from "./NodeSocket";
import { useConnectedInputs, InlineInputs } from "./inlineInput";
import { MermaidView } from "./MermaidView";
import { processGraph } from "../process";
import { FieldResizeGrip } from "./FieldResizeGrip";

const MERMAID_TEMPLATES: ReadonlyArray<{ label: string; source: string }> = [
  { label: "Agent flow", source: "agentflow-beta LR\n  A([User]) --> B[Planner]\n  B --> C{Need data?}\n  C -->|Yes| D[(Search)]\n  C -->|No| E[Writer]\n  D --> E" },
  { label: "Architecture", source: "architecture-beta\n  group app(cloud)[App]\n  service web(internet)[Web] in app\n  service api(server)[API] in app\n  service db(database)[Database] in app\n  web:R --> L:api\n  api:R --> L:db" },
  { label: "Block", source: "block-beta\n  columns 3\n  A[\"Input\"] B[\"Process\"] C[\"Output\"]\n  A --> B\n  B --> C" },
  { label: "C4 context", source: "C4Context\n  title Online shop\n  Person(customer, \"Customer\")\n  System(shop, \"Shop\", \"Sells things\")\n  System_Ext(pay, \"Payments\")\n  Rel(customer, shop, \"Buys from\")\n  Rel(shop, pay, \"Charges via\")" },
  { label: "Class", source: "classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  Animal <|-- Dog\n  Animal <|-- Cat" },
  { label: "Cynefin", source: "cynefin-beta\n  title Incidents\n  clear\n    \"Password reset\"\n  complicated\n    \"Slow queries\"\n  complex\n    \"New market\"\n  chaotic\n    \"Outage\"" },
  { label: "Entity relationship", source: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains" },
  { label: "Event model", source: "eventmodeling\n  tf 01 cmd PlaceOrder\n  tf 02 evt OrderPlaced\n  tf 03 rmo OrderList" },
  { label: "Flowchart", source: "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do this]\n  B -->|No| D[Do that]" },
  { label: "Gantt", source: "gantt\n  title Schedule\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Design :a1, 2026-01-01, 20d\n  Build  :after a1, 30d" },
  { label: "Git graph", source: "gitGraph\n  commit\n  branch dev\n  checkout dev\n  commit\n  checkout main\n  merge dev" },
  { label: "Ishikawa", source: "ishikawa-beta\n  Late delivery\n    People\n      Short-staffed\n    Process\n      Manual picking\n    Tools\n      Old scanners" },
  { label: "Kanban", source: "kanban\n  todo[To do]\n    t1[Write spec]\n  doing[Doing]\n    t2[Build it]\n  done[Done]\n    t3[Plan]" },
  { label: "Mindmap", source: "mindmap\n  root((Idea))\n    Branch A\n      Leaf 1\n      Leaf 2\n    Branch B" },
  { label: "Packet", source: "packet-beta\n  0-15: \"Source port\"\n  16-31: \"Destination port\"\n  32-63: \"Sequence number\"" },
  { label: "Pie", source: "pie showData\n  title Share\n  \"A\" : 45\n  \"B\" : 30\n  \"C\" : 25" },
  { label: "Quadrant", source: "quadrantChart\n  title Effort vs impact\n  x-axis Low effort --> High effort\n  y-axis Low impact --> High impact\n  quadrant-1 Plan\n  quadrant-2 Do now\n  quadrant-3 Skip\n  quadrant-4 Delegate\n  Task A: [0.2, 0.8]\n  Task B: [0.7, 0.6]\n  Task C: [0.4, 0.2]" },
  { label: "Radar", source: "radar-beta\n  title Skills\n  axis a[\"Speed\"], b[\"Power\"], c[\"Range\"], d[\"Cost\"]\n  curve x[\"Model X\"]{4, 3, 5, 2}\n  curve y[\"Model Y\"]{2, 5, 3, 4}\n  max 5" },
  { label: "Railroad", source: "railroad-ebnf-beta\n  number = digit, { digit }, [ \".\", digit, { digit } ] ;\n  digit = \"0\" | \"1\" | \"2\" ;" },
  { label: "Requirement", source: "requirementDiagram\n  requirement fast {\n    id: 1\n    text: Loads in a second\n    risk: medium\n    verifymethod: test\n  }\n  element page {\n    type: web page\n  }\n  page - satisfies -> fast" },
  { label: "Sankey", source: "sankey-beta\nSolar,Grid,60\nWind,Grid,40\nGrid,Homes,70\nGrid,Industry,30" },
  { label: "Sequence", source: "sequenceDiagram\n  Alice->>Bob: Request\n  Bob-->>Alice: Response\n  Alice->>Bob: Ack" },
  { label: "State", source: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: stop\n  Running --> [*]" },
  { label: "Swimlane", source: "swimlane-beta LR\n  subgraph Customer\n    A[Order]\n  end\n  subgraph Shop\n    B[Pack] --> C[Ship]\n  end\n  A --> B" },
  { label: "Timeline", source: "timeline\n  title Launch\n  2024 : Idea\n  2025 : Prototype : Beta\n  2026 : Release" },
  { label: "Tree view", source: "treeView-beta\n  project\n    src\n      main.rs\n      lib.rs\n    Cargo.toml\n    README.md" },
  { label: "Treemap", source: "treemap-beta\n\"Budget\"\n    \"Rent\": 1200\n    \"Food\": 500\n    \"Fun\"\n        \"Games\": 300\n        \"Films\": 200" },
  { label: "Use case", source: "usecase-beta\n  actor Customer\n  Customer --> order(Place order)\n  order --> pay(Pay)" },
  { label: "User journey", source: "journey\n  title My day\n  section Morning\n    Wake up: 3: Me\n    Coffee: 5: Me\n  section Work\n    Code: 4: Me" },
  { label: "Venn", source: "venn-beta\n  title Pets\n  set A[\"Cats\"]\n  set B[\"Dogs\"]\n  set C[\"Birds\"]\n  union A,B[\"Furry\"]\n  union B,C\n  union A,C" },
  { label: "Wardley map", source: "wardley-beta\n  title Tea shop\n  anchor Customer [0.95, 0.63]\n  component Cup of tea [0.79, 0.61]\n  component Tea [0.63, 0.81]\n  component Hot water [0.52, 0.80]\n  component Kettle [0.43, 0.35]\n  Customer -> Cup of tea\n  Cup of tea -> Tea\n  Cup of tea -> Hot water\n  Hot water -> Kettle" },
  { label: "XY chart", source: "xychart-beta\n  title Sales\n  x-axis [Jan, Feb, Mar, Apr]\n  y-axis Units 0 --> 100\n  bar [30, 55, 70, 90]\n  line [30, 55, 70, 90]" },
];

export function MermaidComponent({ data, emit }: NodeProps<MermaidNodeType>) {
  const connected = useConnectedInputs(data.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const sourceWired = connected.has("source");
  const source = sourceWired ? data.cachedSource : (data.stringLiterals.source ?? "");

  function applyTemplate(src: string) {
    data.stringLiterals.source = src;
    setDraft(src);
    data.edited(); void processGraph();
  }

  // Enter must insert a newline in a diagram, so this can't use the Enter-commits helper.
  const [draft, setDraft] = useState(data.stringLiterals.source ?? "");
  useLayoutEffect(() => { setDraft(data.stringLiterals.source ?? ""); }, [data.stringLiterals.source]);
  function commit() {
    if (draft === (data.stringLiterals.source ?? "")) return;
    data.stringLiterals.source = draft;
    data.edited(); void processGraph();
  }

  const feedRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
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
      leading={!collapsed && sourcePort && top !== undefined
        ? <NodeSocket side="input" socketKey="source" nodeId={data.id} emit={emit} payload={sourcePort.socket} top={top} />
        : null}
    >
      {!sourceWired && (
        <LazySelect
          className="solenoid-node__select solenoid-mermaid-template"
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
          <div className="solenoid-field-resizable">
            <textarea
              ref={sourceRef}
              className="solenoid-mermaid-source"
              value={draft}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <FieldResizeGrip targetRef={sourceRef} />
          </div>
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      <MermaidView source={source} className="solenoid-mermaid--card" />
      {/* Collapsed, the leading socket is gone, so the pill's input dot comes from the collapsed InlineInputs. */}
      {collapsed && <InlineInputs node={data} emit={emit} keys={["source"]} />}
      <div className="solenoid-node__collapsed-only solenoid-node__display-value solenoid-node__display-value--chip">
        <DiagramChip value={{ __mermaid: true, source, title: data.label }} pinNodeId={data.id} />
      </div>
    </NodeShell>
  );
}
