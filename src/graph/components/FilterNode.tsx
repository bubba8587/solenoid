import type { FilterNode as FilterNodeType, ComparisonOp, FilterCombine } from "../rete-nodes";
import { InlineInputs, useConnectedInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { TableDisplay } from "./TableDisplay";
import { type SolError } from "../errorValue";

const OPS: { value: ComparisonOp; label: string }[] = [
  { value: "gt",  label: "keep where x > value" },
  { value: "gte", label: "keep where x ≥ value" },
  { value: "lt",  label: "keep where x < value" },
  { value: "lte", label: "keep where x ≤ value" },
  { value: "eq",  label: "keep where x = value" },
  { value: "neq", label: "keep where x ≠ value" },
];

// Second-predicate ops phrase against "value 2".
const OPS2: { value: ComparisonOp; label: string }[] = OPS.map((o) => ({
  value: o.value,
  label: o.label.replace("value", "value 2"),
}));

const COMBINE: { value: FilterCombine; label: string }[] = [
  { value: "none", label: "single condition" },
  { value: "and",  label: "AND second condition" },
  { value: "or",   label: "OR second condition" },
];

// A filtered list reads back as a 1×N (or N×1) matrix; show those as a flat list
// so the classic list-filter still looks like a list, and genuine 2-D as a grid.
function isVector(m: (number | null)[][] | SolError | null): m is (number | null)[][] {
  return Array.isArray(m) && (m.length === 1 || m.every((r) => r.length === 1));
}
function flatten(m: (number | null)[][]): (number | null)[] {
  return m.length === 1 ? m[0] : m.map((r) => r[0]);
}

export function FilterComponent({ data, emit }: NodeProps<FilterNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [op2, setOp2] = useNodeField(data, "op2");
  const [combine, setCombine] = useNodeField(data, "combine");

  // A wired mask (Excel's `include`) replaces the comparison predicate, so the
  // op/threshold UI only shows when no mask is present.
  const masked = useConnectedInputs(data.id).has("mask");
  const predicateMode = !masked;

  const keys = ["list", "mask"];
  if (predicateMode) {
    keys.push("threshold");
    if (combine !== "none") keys.push("threshold2");
  }

  const res = data.cachedResult;
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={keys} />
      {predicateMode && (
        <>
          <OpSelect value={op} onChange={setOp} options={OPS} />
          <OpSelect value={combine} onChange={setCombine} options={COMBINE} />
          {combine !== "none" && <OpSelect value={op2} onChange={setOp2} options={OPS2} />}
        </>
      )}
      {/* A dimension mismatch lands in cachedResult as a #SHAPE! error, which
          TableDisplay renders as the red badge — same path as every other error. */}
      {isVector(res) ? (
        <ValueDisplay value={flatten(res)} />
      ) : (
        <TableDisplay table={res} label={data.label} />
      )}
    </NodeShell>
  );
}
