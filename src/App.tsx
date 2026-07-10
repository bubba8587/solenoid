import { lazy, Suspense, useEffect } from "react";
import { Canvas } from "./graph/Canvas";
import { HelpDialogs } from "./graph/components/HelpDialogs";
import { autoShowWhatsNewOnce } from "./graph/helpDialogStore";
import { Header } from "./graph/Header";
import { NavMenu } from "./graph/NavMenu";
import { OutlinePanel } from "./graph/OutlinePanel";
import { StatusBar } from "./graph/StatusBar";
import { MobileControls } from "./graph/MobileControls";
import { FunctionReference } from "./graph/components/FunctionReference";
import { ReportOverlay } from "./graph/components/ReportOverlay";
import { CompositeEditorOverlay } from "./graph/components/CompositeEditorOverlay";
import { PresentationOverlay } from "./graph/components/PresentationOverlay";
import { ConnectionDialog } from "./graph/components/ConnectionDialog";
import { FormulaPopup } from "./graph/components/FormulaPopup";
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
import { SelectionActionsBar } from "./graph/components/SelectionActionsBar";
import { RendererSpike } from "./graph/components/RendererSpike";
import { WebDemoBanner } from "./graph/WebDemoBanner";
import "./App.css";
import "./graph/StatusBar.css";
import "./mobile.css";

// ?showcase[=<catalog type>] swaps the whole app for the node-showcase harness —
// one real node on a static stage, for node-level UI audits (see showcase/
// NodeShowcase.tsx). Read once at module load; entering/leaving is a reload.
const SHOWCASE_TYPE = new URLSearchParams(window.location.search).get("showcase");
const NodeShowcase = lazy(() => import("./graph/showcase/NodeShowcase"));

function App() {
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
  // Show the What's New slides once per release (returning users; first-ever visitors
  // are recorded silently). Deferred so it lands after the cinematic load reveal.
  useEffect(() => {
    const t = setTimeout(autoShowWhatsNewOnce, 1400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="solenoid-app">
      <Canvas />
      <Header />
      <NavMenu />
      <OutlinePanel />
      <StatusBar />
      <FunctionReference />
      <ReportOverlay />
      <CompositeEditorOverlay />
      <PresentationOverlay />
      <ConnectionDialog />
      <FormulaPopup />
      {/* The cube popup is a self-contained nested-data viewer (every nested
          container drills in place via its breadcrumb), so it never opens a second
          overlay alongside the table popup. */}
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
      <SelectionActionsBar />
      <RendererSpike />
      <WebDemoBanner />
      <MobileControls />
    </div>
  );
}

export default App;
