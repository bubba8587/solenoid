// [[C98]] paletteMirrorsMenubar
import type { ReactNode } from "react";
import { CableShapeSelector } from "./CableShapeSelector";
import type { Menu, MenuIcon, MenuItem } from "./menuModel";
import { SaveIcon } from "./components/SaveIcon";
import "./MobileMenuSheet.css";

type Option = Exclude<MenuItem, { sep: true }>;
type Group = { label?: string; items: Option[] };

const Lucide = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const Line16 = ({ d }: { d: string[] }) => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
);

/** Open, Save and Save As wear the top bar's file-group glyphs. */
const ICONS: Record<MenuIcon, ReactNode> = {
  new: <Lucide><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M9 15h6" /><path d="M12 18v-6" /></Lucide>,
  open: <Line16 d={["M8 10.5 V3", "M5 6 8 3 11 6", "M3 12.5 h10"]} />,
  save: <SaveIcon size={18} />,
  saveAs: <Line16 d={["M8 2.5 V10", "M5 7 8 10 11 7", "M3 12.5 h10"]} />,
  copy: <Lucide><rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Lucide>,
  paste: <Lucide><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></Lucide>,
  toFront: <Lucide><path d="M5 3h14" /><path d="m18 13-6-6-6 6" /><path d="M12 7v14" /></Lucide>,
  forward: <Lucide><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></Lucide>,
  backward: <Lucide><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Lucide>,
  toBack: <Lucide><path d="M19 21H5" /><path d="m18 11-6 6-6-6" /><path d="M12 17V3" /></Lucide>,
};

const isTile = (it: Option) => !!(it.icon && it.short);

/** Separator-bounded groups, minus what the phone hides; neighbouring tile groups join into one strip. */
function groupsOf(items: MenuItem[]): Group[] {
  const groups: Group[] = [{ items: [] }];
  for (const it of items) {
    if ("sep" in it) groups.push({ label: it.label, items: [] });
    else if (!it.hideOnPhone) groups[groups.length - 1].items.push(it);
  }
  const out: Group[] = [];
  for (const g of groups) {
    if (g.items.length === 0) continue;
    const prev = out[out.length - 1];
    if (prev && prev.items.every(isTile) && g.items.every(isTile)) prev.items.push(...g.items);
    else out.push(g);
  }
  return out;
}

/** The phone's ⋮ menu: one section per menu, its commands as rows. A group whose items
 *  all carry an icon and a short name is tiles; a captioned icon group, or a choice
 *  between checked items, is one row with its controls at the right; a lone checked
 *  item is a switch row. */
export function MobileMenuSheet({ menus, run }: { menus: Menu[]; run: (it: Option, keepOpen?: boolean) => void }) {
  const press = (it: Option) => run(it, it.checked !== undefined);
  const row = (it: Option) =>
    it.checked !== undefined ? (
      <button key={it.label} type="button" role="switch" aria-checked={it.checked} className="sol-msheet__row" disabled={it.disabled} onClick={() => press(it)}>
        {it.label}
        <span className={`sol-msheet__switch${it.checked ? " sol-msheet__switch--on" : ""}`}><span className="sol-msheet__knob" /></span>
      </button>
    ) : (
      <button key={it.label} type="button" className="sol-msheet__row" disabled={it.disabled} onClick={() => press(it)}>
        {it.label}
      </button>
    );

  const group = (g: Group, key: number) => {
    if (g.items.every(isTile)) {
      return (
        <div key={key} className="sol-msheet__tiles">
          {g.items.map((it) => (
            <button key={it.label} type="button" className="sol-msheet__tile" aria-label={it.label} disabled={it.disabled} onClick={() => press(it)}>
              {ICONS[it.icon!]}
              <span>{it.short}</span>
            </button>
          ))}
        </div>
      );
    }
    if (g.label && g.items.length > 1 && g.items.every((it) => it.checked !== undefined)) {
      return (
        <div key={key} className="sol-msheet__ctlrow">
          <span>{g.label}</span>
          <div className="sol-msheet__seg" role="radiogroup" aria-label={g.label}>
            {g.items.map((it) => (
              <button key={it.label} type="button" role="radio" aria-checked={!!it.checked} className={`sol-msheet__segbtn${it.checked ? " sol-msheet__segbtn--on" : ""}`} disabled={it.disabled} onClick={() => press(it)}>
                {it.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (g.label && g.items.every((it) => it.icon)) {
      return (
        <div key={key} className="sol-msheet__ctlrow" role="group" aria-label={g.label}>
          <span>{g.label}</span>
          <div className="sol-msheet__icons">
            {g.items.map((it) => (
              <button key={it.label} type="button" className="sol-msheet__icon" aria-label={it.label} title={it.label} disabled={it.disabled} onClick={() => press(it)}>
                {ICONS[it.icon!]}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return g.items.map(row);
  };

  return (
    <div className="sol-msheet">
      {menus.map((menu) => (
        <section key={menu.label} className="sol-msheet__section">
          <div className="sol-msheet__heading">{menu.label}</div>
          {/* The top bar's cable controls are hidden on touch, so View carries them here. */}
          {menu.label === "View" && (
            <div className="sol-msheet__ctlrow">
              <span>Cables</span>
              <CableShapeSelector />
            </div>
          )}
          {groupsOf(menu.items).map(group)}
        </section>
      ))}
    </div>
  );
}
