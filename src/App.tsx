// [[C43]] oneFlowSurface, [[C99]] chromeEnvelopeVars
import { lazy, Suspense, useEffect } from "react";
import { FlowCanvas } from "./graph/flow/FlowCanvas";
import { FlowCompositeOverlay } from "./graph/flow/FlowCompositeOverlay";
import { HelpDialogs } from "./graph/components/HelpDialogs";
import { autoShowWhatsNewOnce } from "./graph/helpDialogStore";
import { Header } from "./graph/Header";
import { NavMenu } from "./graph/NavMenu";
import { OutlinePanel } from "./graph/OutlinePanel";
import { StatusBar } from "./graph/StatusBar";
import { MobileControls } from "./graph/MobileControls";
import { FunctionReference } from "./graph/components/FunctionReference";
import { ReportOverlay } from "./graph/components/ReportOverlay";
import { InspectorPanel } from "./graph/components/InspectorPanel";
import { PresentationOverlay } from "./graph/components/PresentationOverlay";
import { ConnectionDialog } from "./graph/components/ConnectionDialog";
import { FormulaPopup } from "./graph/components/FormulaPopup";
import { ScriptPopup } from "./graph/components/ScriptPopup";
import { TablePopup } from "./graph/components/TablePopup";
import { CubePopup } from "./graph/components/CubePopup";
import { ChartPopup } from "./graph/components/ChartPopup";
import { ElementPicker } from "./graph/components/ElementPicker";
import { PivotEditorPopup } from "./graph/components/PivotEditorPopup";
import { ShortcutsOverlay } from "./graph/ShortcutsOverlay";
import { Settings } from "./graph/Settings";
import { DocumentProperties } from "./graph/components/DocumentProperties";
import { PaletteEditorModal } from "./graph/components/PaletteEditor";
import { HudStack } from "./graph/components/HudStack";
import { FrameHintLayer } from "./graph/components/FrameHintLayer";
import { SelectionActionsBar } from "./graph/components/SelectionActionsBar";
import { WebDemoBanner } from "./graph/WebDemoBanner";
import { installExternalLinkGuard } from "./graph/externalLinks";
import { armMidnightRollover } from "./graph/volatileDates";
import { getEditor, requestRecalc } from "./graph/process";
import "./App.css";
import "./graph/StatusBar.css";
import "./mobile.css";

// URL routes are read once at module load, so entering or leaving one is a reload.
const SHOWCASE_TYPE = new URLSearchParams(window.location.search).get("showcase");
const NodeShowcase = lazy(() => import("./graph/showcase/NodeShowcase"));

const IS_LANDING = new URLSearchParams(window.location.search).has("landing");
const LandingPage = lazy(() => import("./graph/landing/LandingPage"));

// Every path rewrites to index.html on Vercel, so the site's pathname routes are read here.
const SITE_PATH = window.location.pathname.replace(/\/+$/, "");
const IS_OBSIDIAN = SITE_PATH === "/obsidian";
const ObsidianPage = lazy(() => import("./graph/landing/ObsidianPage"));
const IS_DOWNLOAD = SITE_PATH === "/download";
const DownloadPage = lazy(() => import("./graph/landing/DownloadPage"));
const IS_EXAMPLES = SITE_PATH === "/examples";
const ExamplesPage = lazy(() => import("./graph/landing/ExamplesPage"));
const IS_PACKS = SITE_PATH === "/packs";
const PacksPage = lazy(() => import("./graph/landing/PacksPage"));

function App() {
  if (IS_OBSIDIAN) {
    return (
      <Suspense fallback={null}>
        <ObsidianPage />
      </Suspense>
    );
  }
  if (IS_DOWNLOAD) {
    return (
      <Suspense fallback={null}>
        <DownloadPage />
      </Suspense>
    );
  }
  if (IS_EXAMPLES) {
    return (
      <Suspense fallback={null}>
        <ExamplesPage />
      </Suspense>
    );
  }
  if (IS_PACKS) {
    return (
      <Suspense fallback={null}>
        <PacksPage />
      </Suspense>
    );
  }
  if (IS_LANDING) {
    return (
      <Suspense fallback={null}>
        <LandingPage />
      </Suspense>
    );
  }
  if (SHOWCASE_TYPE !== null) {
    return (
      <Suspense fallback={null}>
        <NodeShowcase initialType={SHOWCASE_TYPE} />
      </Suspense>
    );
  }
  return <MainApp />;
}

function MainApp() {
  // Deferred so it lands after the load reveal.
  useEffect(() => {
    const t = setTimeout(autoShowWhatsNewOnce, 1400);
    return () => clearTimeout(t);
  }, []);
  useEffect(installExternalLinkGuard, []);
  // TODAY / NOW / relative Date Inputs recompute once at each local midnight (R5).
  useEffect(() => armMidnightRollover(() => getEditor()?.getNodes() ?? [], () => { void requestRecalc(); }), []);

  return (
    <div className="solenoid-app">
      <FlowCanvas />
      <Header />
      <NavMenu />
      <OutlinePanel />
      <StatusBar />
      <FunctionReference />
      <ReportOverlay />
      <InspectorPanel />
      <FlowCompositeOverlay />
      <PresentationOverlay />
      <ConnectionDialog />
      <FormulaPopup />
      <ScriptPopup />
      <CubePopup />
      <TablePopup />
      <ChartPopup />
      <ElementPicker />
      <PivotEditorPopup />
      <ShortcutsOverlay />
      <HelpDialogs />
      <Settings />
      <DocumentProperties />
      <PaletteEditorModal />
      <HudStack />
      <FrameHintLayer />
      <SelectionActionsBar />
      <WebDemoBanner />
      <MobileControls />
    </div>
  );
}

export default App;
