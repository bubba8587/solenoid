// [[C100]] chartIsAValue
import { ClassicPreset } from "rete";
import { chartOut, strIn } from "./shared";
import { type ImageValue } from "../imageValue";
import { nodeOnCore } from "../nodeOnCore";

export type QrTemplate = "text" | "wifi" | "vcard";

export class QrCodeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    text: "The text or URL to encode.",
    chart: "The QR image.",
  };
  label: string;
  qrTemplate: QrTemplate;
  stringLiterals: Record<string, string> = { wifiAuth: "WPA" };
  height = 200;
  width = 240;
  cachedResult: ImageValue | null = null;
  /** The image is drawn at the card's height, a layout field the call's saved fields leave out. */
  static coreFields = ["imageHeight"];
  get imageHeight(): number { return this.height; }

  constructor(init?: { label?: string; qrTemplate?: QrTemplate }) {
    super("QrCode");
    this.label = init?.label ?? "QR Code";
    this.qrTemplate = init?.qrTemplate ?? "text";
    this.addInput("text", strIn("Text"));
    this.addOutput("chart", chartOut("QR"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ImageValue | null } {
    return nodeOnCore(this, inputs) as { chart: ImageValue | null };
  }
}
