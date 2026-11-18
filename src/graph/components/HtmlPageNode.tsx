// [[reports-and-notes#HTML pages]], [[B19]] spreadsheetHabits
import { useEffect, useState, useSyncExternalStore } from "react";
import type { HtmlPageNode as HtmlPageNodeType } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { CardOpenButton } from "./CardOpenButton";
import { DocumentChip } from "./DocumentChip";
import { ReportRefRow } from "./ReportNode";
import { PickField } from "./PickField";
import { ErrorChip } from "./ErrorChip";
import { chooseFile } from "../chooseFile";
import { collapseStore } from "../collapseStore";
import { cableValueStore } from "../cableValueStore";
import { settingsStore } from "../settingsStore";
import { htmlPageStore } from "../htmlPageStore";
import { getCsvFolder, isDemoVaultPath } from "../demoVault";
import { hasFs, listLocalFiles, readFileHead, writeNewFileIn } from "../fileBridge";
import { STARTER_CSS, STARTER_HTML, starterName } from "../htmlPageText";
import { processEdited } from "../process";
import "./ReportNode.css";

function FilePick({ folder, value, kind, onPick }: { folder: string; value: string; kind: "html" | "css"; onPick: (rel: string) => void }) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    listLocalFiles(folder, [kind]).then((fs) => { if (alive) setFiles(fs); }).catch(() => { if (alive) setFiles([]); });
    return () => { alive = false; };
  }, [folder, kind]);
  return (
    <PickField
      value={value}
      placeholder={kind === "html" ? "Pick a page…" : "No stylesheet"}
      example
      missing={value !== "" && files.length > 0 && !files.includes(value)}
      title={kind === "html" ? "The page's HTML file, in the data folder" : "Its CSS file, in the data folder"}
      onPick={(from) => void chooseFile({
        from,
        title: kind === "html" ? "Choose a page" : "Choose a stylesheet",
        root: folder,
        extensions: [kind],
        current: value || undefined,
        list: () => listLocalFiles(folder, [kind]),
        readHead: (rel, chars) => readFileHead(folder, rel, chars),
        rootLabel: "Data folder",
        recentKey: `html-page-${kind}`,
        empty: kind === "html" ? "No HTML files in the data folder" : "No CSS files in the data folder",
      }).then((rel) => { if (rel) onPick(rel); })}
    />
  );
}

export function HtmlPageComponent({ data, emit }: NodeProps<HtmlPageNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  const folder = useSyncExternalStore(settingsStore.subscribe, getCsvFolder);
  const refKeys = data.refKeys();
  const open = () => htmlPageStore.open(data.id);
  const set = (key: "fileName" | "styleFile", rel: string) => {
    if (data[key] === rel) return;
    data[key] = rel;
    void processEdited(data.id);
  };
  const readable = hasFs() || isDemoVaultPath(folder);
  const [making, setMaking] = useState(false);
  // A starter page and stylesheet in the data folder, so a first page begins from one that works.
  const newPage = async () => {
    setMaking(true);
    try {
      const base = starterName(await listLocalFiles(folder, ["html", "css"]));
      if (await writeNewFileIn(folder, `${base}.html`, STARTER_HTML) && await writeNewFileIn(folder, `${base}.css`, STARTER_CSS)) {
        data.fileName = `${base}.html`;
        data.styleFile = `${base}.css`;
        void processEdited(data.id);
      }
    } finally {
      setMaking(false);
    }
  };

  return (
    <NodeShell node={data} emit={emit}>
      {collapsed ? (
        <>
          <CollapsedInputPill node={data} emit={emit} keys={refKeys} />
          <div className="solenoid-node__display-value solenoid-node__display-value--chip">
            {data.error ? <ErrorChip err={data.error} /> : <DocumentChip size="sm" label="Page" onOpen={open} />}
          </div>
        </>
      ) : (
        <>
          <CardOpenButton label="Open Page" onOpen={open} />
          {!readable ? (
            <div className="sol-conn__note">Local files are read in the desktop app. Turn on the demo vault in Settings ▸ Data to try the sample pages.</div>
          ) : !folder ? (
            <div className="sol-conn__note">No data folder set. Open Settings ▸ Data to choose one.</div>
          ) : (
            <>
              <div className="solenoid-node__io-row"><span className="solenoid-node__io-label">Page</span><FilePick folder={folder} value={data.fileName} kind="html" onPick={(rel) => set("fileName", rel)} /></div>
              <div className="solenoid-node__io-row"><span className="solenoid-node__io-label">Style</span><FilePick folder={folder} value={data.styleFile} kind="css" onPick={(rel) => set("styleFile", rel)} /></div>
              {!data.fileName && hasFs() && (
                <button type="button" className="solenoid-node__recalc-btn" disabled={making} onClick={() => void newPage()}
                  title="Write a starter page and stylesheet into the data folder's pages folder, to edit in any text editor">
                  New page
                </button>
              )}
            </>
          )}
          {data.error && <ErrorChip err={data.error} />}
          {data.missingAssets.length > 0 && (
            <div className="sol-conn__note" title={data.missingAssets.join("\n")}>
              {data.missingAssets.length === 1 ? data.missingAssets[0] : `${data.missingAssets.length} pictures or fonts aren't in the data folder: ${data.missingAssets[0]}…`}
            </div>
          )}
          {refKeys.length > 0 && <div className="solenoid-node__section-divider" />}
          {refKeys.map((key) => (
            <ReportRefRow key={key} data={data} emit={emit} refKey={key} label={key} value={data.refValue(key)} />
          ))}
        </>
      )}
    </NodeShell>
  );
}
