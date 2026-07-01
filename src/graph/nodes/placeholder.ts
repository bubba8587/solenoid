import { ClassicPreset } from "rete";
import { anySocket } from "../sockets";
import { solError } from "../errorValue";

// A stand-in for a saved node whose `type` isn't registered in this build — a
// node from a pack that's turned off, or a since-renamed type in an old save.
// Rather than DROP the node (and its cables) on load, persistence builds a
// PlaceholderNode that keeps the original type name + its serialized init /
// literals, and synthesizes `any` sockets matching the saved connections so the
// wiring survives. On save it re-emits as the ORIGINAL type (see serializeGraph),
// so reopening in a build that HAS the type restores the real node losslessly.
//
// It can't compute, so every output carries a #REF! — downstream reads the break
// loudly (the tagged-error story) instead of silently using nulls. It is NOT in
// the Add-menu catalog: only the loader ever constructs one.
export class PlaceholderNode extends ClassicPreset.Node {
  label: string;
  /** The unregistered class name this stands in for. */
  readonly missingType: string;
  /** The original `init` / inline literals, kept verbatim for a lossless re-save. */
  readonly savedInit: Record<string, unknown>;
  readonly savedLiterals?: Record<string, number>;
  readonly savedStringLiterals?: Record<string, string>;
  width = 200;
  height = 110;

  constructor(init: {
    missingType: string;
    savedInit?: Record<string, unknown>;
    savedLiterals?: Record<string, number>;
    savedStringLiterals?: Record<string, string>;
    inputKeys?: string[];
    outputKeys?: string[];
    label?: string;
  }) {
    super("Missing node");
    this.missingType = init.missingType;
    this.label = init.label ?? init.missingType;
    this.savedInit = init.savedInit ?? {};
    this.savedLiterals = init.savedLiterals;
    this.savedStringLiterals = init.savedStringLiterals;
    for (const k of init.inputKeys ?? []) this.addInput(k, new ClassicPreset.Input(anySocket, k));
    for (const k of init.outputKeys ?? []) this.addOutput(k, new ClassicPreset.Output(anySocket, k));
    const rows = Math.max(init.inputKeys?.length ?? 0, init.outputKeys?.length ?? 0);
    this.height = 104 + rows * 24;
  }

  data(): Record<string, unknown> {
    const err = solError(
      "#REF!",
      `This node ("${this.missingType}") isn't available here — turn its pack on, or open in a build that has it, to restore it.`,
    );
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(this.outputs)) out[k] = err;
    return out;
  }
}
