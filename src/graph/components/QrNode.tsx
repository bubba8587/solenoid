import type React from "react";
import { useEffect, useState } from "react";
import type { QrCodeNode as QrCodeNodeType } from "../rete-nodes";
import type { QrTemplate } from "../qrCode";
import { processGraph } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { LazySelect } from "./LazySelect";
import { stopDragStart } from "../coarse";
import "./ConnectionNodes.css";

const stopDrag = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
};

// A card text field bound to one stringLiterals key; commits on blur/Enter, never per
// keystroke, so a QR isn't re-encoded mid-type.
function LiteralField({ node, field, placeholder }: { node: QrCodeNodeType; field: string; placeholder: string }) {
  const [val, setVal] = useState(node.stringLiterals[field] ?? "");
  useEffect(() => { setVal(node.stringLiterals[field] ?? ""); }, [node.stringLiterals[field]]);
  function commit() {
    if (val !== (node.stringLiterals[field] ?? "")) { node.stringLiterals[field] = val; void processGraph(); }
  }
  return (
    <input
      className="sol-conn__url" type="text" value={val} placeholder={placeholder} spellCheck={false}
      onChange={(e) => setVal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

export function QrCodeComponent({ data, emit }: NodeProps<QrCodeNodeType>) {
  const [template, setTemplate] = useState<QrTemplate>(data.qrTemplate);
  useEffect(() => { setTemplate(data.qrTemplate); }, [data.qrTemplate]);

  function pickTemplate(next: QrTemplate) {
    setTemplate(next);
    data.qrTemplate = next;
    void processGraph();
  }

  const img = data.cachedResult;
  return (
    <NodeShell node={data} emit={emit}>
      <div className="sol-conn">
        <LazySelect
          className="sol-conn__select" value={template} title="What the QR encodes"
          onChange={(e) => pickTemplate(e.target.value as QrTemplate)} {...stopDrag}
        >
          <option value="text">Text / URL</option>
          <option value="wifi">Wi-Fi</option>
          <option value="vcard">Contact (vCard)</option>
        </LazySelect>
      </div>
      {template === "text" && <InlineInputs node={data} emit={emit} keys={["text"]} />}
      {template === "wifi" && (
        <div className="sol-conn">
          <LiteralField node={data} field="ssid" placeholder="Network name (SSID)" />
          <LiteralField node={data} field="wifiPass" placeholder="Password" />
          <LazySelect
            className="sol-conn__select" value={data.stringLiterals.wifiAuth || "WPA"} title="Security"
            onChange={(e) => { data.stringLiterals.wifiAuth = e.target.value; void processGraph(); }} {...stopDrag}
          >
            <option value="WPA">WPA / WPA2</option>
            <option value="WEP">WEP</option>
            <option value="nopass">No password</option>
          </LazySelect>
          <label className="sol-conn__field" title="The network doesn't broadcast its name">
            <input
              type="checkbox" checked={data.stringLiterals.wifiHidden === "true"}
              onChange={(e) => { data.stringLiterals.wifiHidden = e.target.checked ? "true" : ""; void processGraph(); }}
              onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
            />
            Hidden network
          </label>
        </div>
      )}
      {template === "vcard" && (
        <div className="sol-conn">
          <LiteralField node={data} field="vcName" placeholder="Name" />
          <LiteralField node={data} field="vcPhone" placeholder="Phone" />
          <LiteralField node={data} field="vcEmail" placeholder="Email" />
          <LiteralField node={data} field="vcOrg" placeholder="Organization" />
          <LiteralField node={data} field="vcUrl" placeholder="Website" />
        </div>
      )}
      {img && (
        <div className="sol-conn__qr-preview">
          <img src={img.src} alt={img.alt ?? "QR code"} draggable={false} />
        </div>
      )}
    </NodeShell>
  );
}
