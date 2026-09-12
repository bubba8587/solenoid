import { ClassicPreset } from "rete";
import { chartOut, strIn, readInput } from "./shared";
import { type ImageValue } from "../imageValue";
import { buildQrPayload, qrModulesToSvg, svgDataUrl, type QrTemplate, type QrFields } from "../qrCode";

// ─── QR CODE ──────────────────────────────────────────────────────────────────
// Text → a QR image out the green `chart` socket, so it embeds in a Report and prints.
// A template shapes the payload (plain text/URL, Wi-Fi join, vCard). The `qrcode`
// encoder is imported lazily in data() so it stays out of the initial bundle; the SVG
// build itself is the pure qrCode.ts. Async data() re-uses the encoder's cached module.

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
  /** Read by the component's preview; never persisted. */
  cachedResult: ImageValue | null = null;
  private _cache: { key: string; value: ImageValue | null } | null = null;

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
    if (this._cache && this._cache.key === payload) {
      this.cachedResult = this._cache.value;
      return { chart: this._cache.value };
    }
    if (payload === "") {
      this._cache = { key: payload, value: null };
      this.cachedResult = null;
      return { chart: null };
    }
    // Lazy import keeps the encoder out of the initial bundle; the module caches after
    // first use, so later passes only re-run the (fast) matrix build.
    const mod = await import("qrcode");
    const QRCode: typeof import("qrcode") = (mod as { default?: typeof import("qrcode") }).default ?? mod;
    const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
    const svg = qrModulesToSvg(qr.modules.size, qr.modules.data);
    const value: ImageValue = { __image: true, src: svgDataUrl(svg), height: this.height, alt: this.label, title: this.label };
    this._cache = { key: payload, value };
    this.cachedResult = value;
    return { chart: value };
  }
}
