import { ClassicPreset } from "rete";
import { frameIn, frameOut } from "./shared";
import { frameFromInputText, type FrameValue } from "../frame";

// The Architecture map's card: a named group of source modules, carried as a
// frame (module, role, imports). Cables INTO `deps` are import-dependency
// edges, so the input is data-inert by design — the wiring is the information.
// The architecture-map seed (scripts/gen-arch-seed.mjs) authors these.

export class SubsystemNode extends ClassicPreset.Node {
  label: string;
  frameText: string;
  cachedResult: FrameValue | null = null;
  private _builtFrom: string | undefined;
  width = 240; height = 200;

  constructor(init?: { label?: string; frameText?: string }) {
    super("Subsystem");
    this.label = init?.label ?? "Subsystem";
    this.frameText = init?.frameText ?? "module, role, imports";
    const deps = frameIn("Imports");
    deps.multipleConnections = true;
    this.addInput("deps", deps);
    this.addOutput("modules", frameOut("Modules"));
  }

  data(): { modules: FrameValue } {
    if (!this.cachedResult || this._builtFrom !== this.frameText) {
      this.cachedResult = frameFromInputText(this.frameText);
      this._builtFrom = this.frameText;
    }
    return { modules: this.cachedResult };
  }
}
