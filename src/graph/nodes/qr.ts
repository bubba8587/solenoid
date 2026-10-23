// [[C100]] chartIsAValue
import { ClassicPreset } from "rete";
import { chartOut, strIn, readInput } from "./shared";
import { type ImageValue } from "../imageValue";
import { buildQrPayload, qrModulesToSvg, svgDataUrl, type QrTemplate, type QrFields } from "../qrCode";

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

  private fields(textFromInput: string): Partial<QrFields> {
    const sl = this.stringLiterals;
    return {
      text: textFromInput,
      ssid: sl.ssid ?? "", wifiPass: sl.wifiPass ?? "", wifiAuth: sl.wifiAuth || "WPA",
      wifiHidden: sl.wifiHidden === "true",
      vcName: sl.vcName ?? "", vcPhone: sl.vcPhone ?? "", vcEmail: sl.vcEmail ?? "",
      vcOrg: sl.vcOrg ?? "", vcUrl: sl.vcUrl ?? "",
    };
  }

  async data(inputs: { text?: string[] }): Promise<{ chart: ImageValue | null }> {
    const wired = this.qrTemplate === "text" ? readInput(inputs.text, this.stringLiterals.text ?? "") : "";
    const payload = buildQrPayload(this.qrTemplate, this.fields(typeof wired === "string" ? wired : ""));
    if (payload === "") {
      this.cachedResult = null;
      return { chart: null };
    }
    const mod = await import("qrcode");
    const QRCode: typeof import("qrcode") = (mod as { default?: typeof import("qrcode") }).default ?? mod;
    const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
    const svg = qrModulesToSvg(qr.modules.size, qr.modules.data);
    const value: ImageValue = { __image: true, src: svgDataUrl(svg), height: this.height, alt: this.label, title: this.label };
    this.cachedResult = value;
    return { chart: value };
  }
}
