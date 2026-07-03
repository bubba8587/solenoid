import { Canvas } from "./graph/Canvas";
import { Header } from "./graph/Header";
import { NavMenu } from "./graph/NavMenu";
import { OutlinePanel } from "./graph/OutlinePanel";
import { StatusBar } from "./graph/StatusBar";
import { MobileControls } from "./graph/MobileControls";
import { FunctionReference } from "./graph/components/FunctionReference";
import { ReportOverlay } from "./graph/components/ReportOverlay";
import { ConnectionDialog } from "./graph/components/ConnectionDialog";
import { FormulaPopup } from "./graph/components/FormulaPopup";
import { TablePopup } from "./graph/components/TablePopup";
import { CubePopup } from "./graph/components/CubePopup";
import { ChartPopup } from "./graph/components/ChartPopup";
import { PivotEditorPopup } from "./graph/components/PivotEditorPopup";
import { ShortcutsOverlay } from "./graph/ShortcutsOverlay";
import { Settings } from "./graph/Settings";
import { HudStack } from "./graph/components/HudStack";
import { RendererSpike } from "./graph/components/RendererSpike";
import { HtmlCanvasSpike } from "./graph/components/HtmlCanvasSpike";
import { WebDemoBanner } from "./graph/WebDemoBanner";
import "./App.css";
import "./graph/StatusBar.css";
import "./mobile.css";

function App() {
  return (
    <div className="solenoid-app">
      <Canvas />
      <Header />
      <NavMenu />
      <OutlinePanel />
      <StatusBar />
      <FunctionReference />
      <ReportOverlay />
      <ConnectionDialog />
      <FormulaPopup />
      {/* The cube popup is a self-contained nested-data viewer (every nested
          container drills in place via its breadcrumb), so it never opens a second
          overlay alongside the table popup. */}
      <CubePopup />
      <TablePopup />
      <ChartPopup />
      <PivotEditorPopup />
      <ShortcutsOverlay />
      <Settings />
      <HudStack />
      <RendererSpike />
      <HtmlCanvasSpike />
      <WebDemoBanner />
      <MobileControls />
    </div>
  );
}

export default App;
