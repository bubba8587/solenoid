import { MenuBar } from "./MenuBar";
import { TopBar } from "./TopBar";
import "./Header.css";

/**
 * App header: the menu bar stacked above the toolbar, pinned full-width to the
 * top edge. The two rows together are the "app bar"; the bottom accent
 * highlight lives on the toolbar (TopBar).
 */
export function Header() {
  return (
    <div className="solenoid-header">
      <MenuBar />
      <TopBar />
    </div>
  );
}
