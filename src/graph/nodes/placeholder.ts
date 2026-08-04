import { ClassicPreset } from "rete";
import { AdoptiveSocket, trueAnySocket } from "../sockets";
import { solError } from "../errorValue";

// A stand-in for a saved node whose `type` isn't registered in this build: wiring survives
// on synthesized `any` sockets and it re-saves as the ORIGINAL type, so the round trip is
// lossless. NOT in the Add-menu catalog — only the loader constructs one.
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
    for (const k of init.inputKeys ?? []) this.addInput(k, new ClassicPreset.Input(new AdoptiveSocket(), k));
    for (const k of init.outputKeys ?? []) this.addOutput(k, new ClassicPreset.Output(trueAnySocket, k));
    const rows = Math.max(init.inputKeys?.length ?? 0, init.outputKeys?.length ?? 0);
    this.height = 104 + rows * 24;
  }

  data(): Record<string, unknown> {
    const err = solError(
      "#REF!",
      `This node ("${this.missingType}") isn't available here. Turn its pack on, or open in a build that has it, to restore it.`,
    );
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(this.outputs)) out[k] = err;
    return out;
  }
}
