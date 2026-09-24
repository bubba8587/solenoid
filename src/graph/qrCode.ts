// [[B2]] webTryDesktopFull (the qrcode package is a lazy import too)
// QR payload assembly and SVG rendering, pure. The `qrcode` encoder is imported lazily by the node, never here.

export type QrTemplate = "text" | "wifi" | "vcard";

export interface QrFields {
  text: string;
  ssid: string;
  wifiPass: string;
  /** WPA | WEP | nopass. */
  wifiAuth: string;
  wifiHidden: boolean;
  vcName: string;
  vcPhone: string;
  vcEmail: string;
  vcOrg: string;
  vcUrl: string;
}

// The Wi-Fi MECARD-style grammar escapes \ ; , : and ".
function escWifi(s: string): string {
  return s.replace(/([\\;,:"])/g, "\\$1");
}

/** An empty essential field gives "" (no code). */
export function buildQrPayload(template: QrTemplate, f: Partial<QrFields>): string {
  if (template === "wifi") {
    const ssid = (f.ssid ?? "").trim();
    if (ssid === "") return "";
    const auth = f.wifiAuth || "WPA";
    const hidden = f.wifiHidden ? "H:true;" : "";
    if (auth === "nopass") return `WIFI:T:nopass;S:${escWifi(ssid)};;${hidden}`;
    return `WIFI:T:${auth};S:${escWifi(ssid)};P:${escWifi(f.wifiPass ?? "")};${hidden};`;
  }
  if (template === "vcard") {
    const lines = [
      ["FN", f.vcName], ["TEL", f.vcPhone], ["EMAIL", f.vcEmail], ["ORG", f.vcOrg], ["URL", f.vcUrl],
    ].filter(([, v]) => (v ?? "").trim() !== "");
    if (lines.length === 0) return "";
    return ["BEGIN:VCARD", "VERSION:3.0", ...lines.map(([k, v]) => `${k}:${(v ?? "").trim()}`), "END:VCARD"].join("\n");
  }
  return (f.text ?? "").trim();
}

/** `data[i] & 1` is a dark module (the `qrcode` BitMatrix layout); `margin` is the quiet zone in modules. */
export function qrModulesToSvg(size: number, data: Uint8Array, margin = 4): string {
  const dim = size + margin * 2;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (data[r * size + c] & 1) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`
    + `<rect width="${dim}" height="${dim}" fill="#ffffff"/>`
    + `<path d="${path}" fill="#000000"/></svg>`;
}

/** utf8, not base64: smaller for markup. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
