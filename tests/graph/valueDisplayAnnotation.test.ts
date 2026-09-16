import { describe, it, expect, beforeEach } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { NodeEditor as Ed } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { formatAnnotationStore, type FormatAnnotation } from "../../src/graph/formatAnnotationStore";
import { resolveDisplayAnnotation, formatListCell, annotationForValue } from "../../src/graph/components/valueDisplayFormat";
import { formatTableCell } from "../../src/graph/components/TableDisplay";
import { solError } from "../../src/graph/errorValue";
import { fromUnit } from "../../src/graph/unitValue";
import { UNITS } from "../../src/graph/dimension";
import { formatScalar } from "../../src/graph/components/format";

// resolveDisplayAnnotation is the ONE question every value surface asks (nodeKit's
// ValueDisplay + output rows, DisplayNode, TableDisplay, the pins, the cable
// inspector, collapsed group readouts). Its three steps are pinned here; the walk
// itself belongs to unitFlowAnnotation.test.ts.

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;
const sock = new (class extends ClassicPreset.Socket {})("any");

const usd: FormatAnnotation = { format: "decimal", decimalDigits: 2, decimalMode: "places", unit: "usd" };
const eur: FormatAnnotation = { ...usd, unit: "eur" };
const deg: FormatAnnotation = { format: "auto", unit: "deg" };

function node(label: string, extra: Record<string, unknown> = {}) {
  const n = new ClassicPreset.Node(label) as ClassicPreset.Node & Record<string, unknown>;
  n.addInput("in", new ClassicPreset.Input(sock, "In"));
  n.addOutput("out", new ClassicPreset.Output(sock, "Out"));
  Object.assign(n, extra);
  return n;
}
function passthrough(label: string) {
  const n = node(label);
  n.passthrough = () => [{ output: "out", inputs: ["in"], combine: "single", pure: true }];
  return n;
}
const connect = (e: AnyEditor, s: ClassicPreset.Node, t: ClassicPreset.Node) =>
  e.addConnection(new ClassicPreset.Connection(s as never, "out", t as never, "in") as never);

/** A fresh editor registered as the MAIN graph, which getOwningEditor resolves to. */
function newEditor(): AnyEditor {
  const editor = new NodeEditor() as unknown as AnyEditor;
  setEditorRefs(editor as unknown as Ed<Schemes>, {} as never, {} as never);
  return editor;
}

beforeEach(() => formatAnnotationStore.clearNodes());

describe("resolveDisplayAnnotation — direct, then carried, then downstream", () => {
  it("a DIRECT annotation wins over the one carried onto the output", async () => {
    const editor = newEditor();
    const fc = node("FC", { annotation: () => usd });
    const disp = passthrough("Display");
    for (const n of [fc, disp]) await editor.addNode(n as never);
    await connect(editor, fc, disp);
    formatAnnotationStore.set(disp.id, "out", eur);
    expect(resolveDisplayAnnotation(disp.id)?.unit).toBe("eur");
    formatAnnotationStore.clearNodes();
    expect(resolveDisplayAnnotation(disp.id)?.unit).toBe("usd"); // carried, once the direct one goes
  });

  it("a passthrough chain carries the upstream FC's lock", async () => {
    const editor = newEditor();
    const fc = node("FC", { annotation: () => usd });
    const d1 = passthrough("Disp1");
    const d2 = passthrough("Disp2");
    for (const n of [fc, d1, d2]) await editor.addNode(n as never);
    await connect(editor, fc, d1);
    await connect(editor, d1, d2);
    expect(resolveDisplayAnnotation(d2.id)?.unit).toBe("usd");
  });

  it("an ORDINARY card resolves an FC docked DOWNSTREAM through passthroughs", async () => {
    const editor = newEditor();
    const num = node("Number");          // a source: neither FC nor passthrough
    const d1 = passthrough("Disp1");
    const fc = node("FC", { annotation: () => usd });
    for (const n of [num, d1, fc]) await editor.addNode(n as never);
    await connect(editor, num, d1);
    await connect(editor, d1, fc);
    expect(resolveDisplayAnnotation(num.id)?.unit).toBe("usd");
  });

  it("an unwired node resolves nothing", async () => {
    const editor = newEditor();
    const num = node("Number");
    await editor.addNode(num as never);
    expect(resolveDisplayAnnotation(num.id)).toBeUndefined();
    expect(resolveDisplayAnnotation(null)).toBeUndefined();
  });

  it("`socketKey` keeps a multi-output card's boxes apart", async () => {
    const editor = newEditor();
    const tri = new ClassicPreset.Node("Tri") as ClassicPreset.Node & Record<string, unknown>;
    for (const k of ["a", "A"]) tri.addOutput(k, new ClassicPreset.Output(sock, k));
    tri.annotationFor = (outKey: string) => (outKey === "A" ? deg : undefined);
    await editor.addNode(tri as never);
    expect(resolveDisplayAnnotation(tri.id, "A")?.unit).toBe("deg");
    expect(resolveDisplayAnnotation(tri.id, "a")).toBeUndefined();
    // Socket-less, the card asks every output in turn and takes the first answer.
    expect(resolveDisplayAnnotation(tri.id)?.unit).toBe("deg");
  });
});

describe("formatTableCell — one annotation across a matrix, per cell", () => {
  const places3: FormatAnnotation = { format: "decimal", decimalDigits: 3, decimalMode: "places", unit: "none" };

  it("blanks and error cells short-circuit ahead of any annotation", () => {
    expect(formatTableCell(null, false, places3)).toBe("");
    expect(formatTableCell(solError("#DIV/0!", "divide by zero"), false, places3)).toBe("#DIV/0!");
  });

  it("numeric cells take the annotation's precision, and its date style", () => {
    expect(formatTableCell(1.5, false, places3)).toBe("1.500");
    expect(formatTableCell(1.5, false)).toBe("1.5"); // unannotated keeps the compact form
    expect(formatTableCell(45000, true, { format: "date_dmy", unit: "none" })).toContain("2023");
  });

  it("a date matrix still formats its serials with no annotation", () => {
    expect(formatTableCell(45000, true)).toMatch(/^\d{2}-[A-Za-z]{3}-\d{4}$/);
    expect(formatTableCell(45000, false)).toBe("45000");
  });

  it("logical cells take the show-as, text cells the case", () => {
    expect(formatTableCell(true, false, { ...places3, logicalStyle: "yesno" })).toBe("Yes");
    expect(formatTableCell(false, false)).toBe("FALSE");
    expect(formatTableCell("ab", false, { ...places3, textCase: "upper" })).toBe("AB");
    expect(formatTableCell("ab", false)).toBe("ab");
  });
});

describe("formatListCell — the same annotation reaches every list cell", () => {
  const places1: FormatAnnotation = { format: "decimal", decimalDigits: 1, decimalMode: "places", unit: "none" };

  it("logical, text and united cells all honour the annotation", () => {
    expect(formatListCell(true, formatScalar, { ...places1, logicalStyle: "check" })).toBe("✓");
    expect(formatListCell(true, formatScalar)).toBe("TRUE");
    expect(formatListCell("ab", formatScalar, { ...places1, textCase: "upper" })).toBe("AB");
    // A dimensioned cell renders in its display unit at the annotation's precision.
    expect(formatListCell(fromUnit(5000, UNITS.m, "km"), formatScalar, { ...places1, unit: "km" })).toBe("5.0 km");
  });

  it("a CARRIED format (unit stripped) leaves the cell's own unit standing", () => {
    // A format crossing a transform arrives with unit "none" (formatFlowsDownstream);
    // the unit rides the VALUE, so the $ must survive — only the style is the ann's.
    const carried: FormatAnnotation = { format: "decimal", decimalDigits: 2, decimalMode: "places", unit: "none", customUnit: "" };
    const dollars = fromUnit(1000, UNITS["¤"], "usd");
    expect(annotationForValue(dollars, carried)?.unit).toBe("usd");
    expect(formatListCell(dollars, formatScalar, carried)).toBe("$1,000.00");
    // A list is read from its first dimensioned cell, and a unitless value is untouched.
    expect(annotationForValue([dollars], carried)?.unit).toBe("usd");
    expect(annotationForValue(5, carried)?.unit).toBe("none");
    // An annotation that DOES name a unit stays exactly as authored.
    expect(annotationForValue(dollars, { ...carried, unit: "eur" })?.unit).toBe("eur");
  });

  it("blanks and errors keep their literal cell form", () => {
    expect(formatListCell(null, formatScalar, places1)).toBe("null");
    expect(formatListCell(solError("#VALUE!", "bad value"), formatScalar, places1)).toBe("#VALUE!");
  });
});
