// [[C98]] paletteMirrorsMenubar
import type { ReactNode } from "react";
import { CableShapeSelector } from "./CableShapeSelector";
import type { Menu, MenuIcon, MenuItem } from "./menuModel";
import { SaveIcon } from "./components/SaveIcon";
import { RefreshIcon } from "./components/RefreshIcon";
import { RecalcGlyph } from "./components/RecalcButton";
import { InfoIcon, SearchIcon, TriangleAlertIcon } from "./components/Icons";
import "./phonePanel.css";
import "./MobileMenuSheet.css";

type Option = Exclude<MenuItem, { sep: true }>;
type Group = { label?: string; items: Option[] };

const Lucide = ({ size, children }: { size: number; children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const Line16 = ({ size, d }: { size: number; d: string[] }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
);

/** Each wears the glyph its command already has elsewhere: Open, Save and Save As the top bar's file group,
 *  Recalculate the card button's, Inspector and the reference Row B's, the model check the Problems panel's. */
const ICONS: Record<MenuIcon, (size: number) => ReactNode> = {
  new: (n) => <Lucide size={n}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M9 15h6" /><path d="M12 18v-6" /></Lucide>,
  open: (n) => <Line16 size={n} d={["M8 10.5 V3", "M5 6 8 3 11 6", "M3 12.5 h10"]} />,
  save: (n) => <SaveIcon size={n} />,
  saveAs: (n) => <Line16 size={n} d={["M8 2.5 V10", "M5 7 8 10 11 7", "M3 12.5 h10"]} />,
  copy: (n) => <Lucide size={n}><rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Lucide>,
  paste: (n) => <Lucide size={n}><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></Lucide>,
  toFront: (n) => <Lucide size={n}><path d="M5 3h14" /><path d="m18 13-6-6-6 6" /><path d="M12 7v14" /></Lucide>,
  forward: (n) => <Lucide size={n}><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></Lucide>,
  backward: (n) => <Lucide size={n}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Lucide>,
  toBack: (n) => <Lucide size={n}><path d="M19 21H5" /><path d="m18 11-6 6-6-6" /><path d="M12 17V3" /></Lucide>,
  refresh: (n) => <RefreshIcon size={n} />,
  recalc: (n) => <RecalcGlyph size={n} />,
  draw: (n) => <Lucide size={n}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></Lucide>,
  find: (n) => <SearchIcon size={n} strokeWidth={1.8} />,
  inspector: (n) => <InfoIcon size={n} strokeWidth={1.8} />,
  problems: (n) => <TriangleAlertIcon size={n} strokeWidth={1.8} />,
  reference: (n) => <Lucide size={n}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></Lucide>,
  external: (n) => <Lucide size={n}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Lucide>,
};

const isTile = (it: Option) => !!(it.icon && it.short);

/** Separator-bounded groups, minus what the phone hides or the heading carries; neighbouring tile groups join into one strip. */
function groupsOf(items: MenuItem[]): Group[] {
  const groups: Group[] = [{ items: [] }];
  for (const it of items) {
    if ("sep" in it) groups.push({ label: it.label, items: [] });
    else if (!it.hideOnPhone && !it.inHeading) groups[groups.length - 1].items.push(it);
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

/** The phone's ⋮ menu: one section per menu, its commands as rows. A section's one-tap
 *  actions are pill buttons in its heading; a group whose items all carry an icon and a
 *  short name is tiles; a captioned icon group, or a choice between checked items, is one
 *  row with its controls at the right. */
export function MobileMenuSheet({ menus, run }: { menus: Menu[]; run: (it: Option, keepOpen?: boolean) => void }) {
  const press = (it: Option) => run(it, it.checked !== undefined);
  const row = (it: Option) => (
    <button key={it.label} type="button" className="sol-mpanel__row" aria-pressed={it.checked} disabled={it.disabled} onClick={() => press(it)}>
      {it.label}
      {it.icon && <span className="sol-mpanel__rowicon">{ICONS[it.icon](15)}</span>}
    </button>
  );

  const group = (g: Group, key: number) => {
    if (g.items.every(isTile)) {
      return (
        <div key={key} className="sol-msheet__tiles">
          {g.items.map((it) => (
            <button key={it.label} type="button" className="sol-msheet__tile" aria-label={it.label} disabled={it.disabled} onClick={() => press(it)}>
              {ICONS[it.icon!](15)}
              <span>{it.short}</span>
            </button>
          ))}
        </div>
      );
    }
    if (g.label && g.items.length > 1 && g.items.every((it) => it.checked !== undefined)) {
      return (
        <div key={key} className="sol-mpanel__ctlrow">
          <span>{g.label}</span>
          <div className="sol-mpanel__seg" role="radiogroup" aria-label={g.label}>
            {g.items.map((it) => (
              <button key={it.label} type="button" role="radio" aria-checked={!!it.checked} className={`sol-mpanel__segbtn${it.checked ? " sol-mpanel__segbtn--on" : ""}`} disabled={it.disabled} onClick={() => press(it)}>
                {it.short ?? it.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (g.label && g.items.every((it) => it.icon)) {
      return (
        <div key={key} className="sol-mpanel__ctlrow" role="group" aria-label={g.label}>
          <span>{g.label}</span>
          <div className="sol-mpanel__icons">
            {g.items.map((it) => (
              <button key={it.label} type="button" className="sol-mpanel__icon" aria-label={it.label} title={it.label} disabled={it.disabled} onClick={() => press(it)}>
                {ICONS[it.icon!](16)}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return g.items.map(row);
  };

  return (
    <div className="sol-mpanel sol-msheet">
      {menus.map((menu) => (
        <section key={menu.label} className="sol-msheet__section">
          <div className="sol-mpanel__heading">
            {menu.label}
            {menu.items.map((it) =>
              "sep" in it || !it.inHeading || it.hideOnPhone ? null : (
                <button
                  key={it.label}
                  type="button"
                  className={`sol-mpanel__pill${it.checked ? " sol-mpanel__pill--on" : ""}`}
                  aria-label={it.label}
                  aria-pressed={it.checked}
                  disabled={it.disabled}
                  onClick={() => run(it)}
                >
                  {it.icon && ICONS[it.icon](13)}
                  {it.short ?? it.label}
                </button>
              ),
            )}
          </div>
          {/* The top bar's cable controls are hidden on touch, so View carries them here. */}
          {menu.label === "View" && (
            <div className="sol-mpanel__ctlrow">
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
