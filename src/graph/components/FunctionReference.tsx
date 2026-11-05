// [[C51]] formulaNaming
import { useSyncExternalStore } from "react";
import { frStore, type FrTab } from "../frStore";
import { Markdown } from "./Markdown";
import { SocketLegendRows, DimensionalityFlow } from "./SocketLegend";
import { CardReference } from "./CardReference";
import { ExcelCoverage } from "./ExcelCoverage";
import helpMd from "../help/help.md?raw";
import knapMd from "../help/knap.md?raw";
import notesMd from "../help/notes.md?raw";
import dataTypesMd from "../help/data-types.md?raw";
import dataModelMd from "../help/data-model.md?raw";
import "./FunctionReference.css";
import "../AddNodeMenu.css";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";

const TABS: { key: FrTab; label: string }[] = [
  { key: "reference", label: "Reference" },
  { key: "excel", label: "Excel Coverage" },
  { key: "sockets", label: "Socket Types" },
  { key: "help", label: "Help" },
  { key: "knap", label: "Knap" },
  { key: "notes", label: "Notes" },
];

export function FunctionReference() {
  const open = useSyncExternalStore(frStore.subscribe, frStore.get);
  const tab = useSyncExternalStore(frStore.subscribe, frStore.tab);

  useEscapeToClose(() => frStore.close(), open);

  if (!open) return null;

  return (
    <div className="fr-backdrop" onPointerDown={() => frStore.close()}>
      <div className="fr-panel" onPointerDown={(e) => e.stopPropagation()}>

        <div className="fr-tabs">
          <div className="fr-tabs__scroll">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`fr-tab${tab === t.key ? " fr-tab--active" : ""}`}
                onClick={() => frStore.setTab(t.key)}
              >{t.label}</button>
            ))}
          </div>
          <button className="fr-close" onClick={() => frStore.close()} title="Close (Esc)" aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        {tab === "reference" ? <CardReference />
          : tab === "excel" ? <ExcelCoverage />
          : tab === "sockets" ? (
            <div className="fr-doc-scroll">
              <div className="fr-sockets">
                <SocketLegendRows />
                <Markdown md={dataTypesMd} />
                <DimensionalityFlow />
                <Markdown md={dataModelMd} />
              </div>
            </div>
          ) : (
            <div className="fr-doc-scroll">
              <Markdown md={tab === "help" ? helpMd : tab === "knap" ? knapMd : notesMd} />
            </div>
          )}
      </div>
    </div>
  );
}
