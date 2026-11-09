import {
  ElementNode as ElementNodeType,
  MolarMassNode as MolarMassNodeType,
} from "../nodeClasses";
import { useRef, useState } from "react";
import { ELEMENT_BY_SYMBOL, ELEMENT_CATEGORIES } from "../nodes/chemistryOps";
import { useConnectedInputs } from "./inlineInput";
import { useSeriesColors } from "./chartCore";
import { FrameDisplay } from "./FrameDisplay";
import { NodeSocket } from "./NodeSocket";
import { FrameOutRow, RowPager, shortNum, useAnchorTop } from "./GeometryFigure";
import { isFrameValue, frameRowCount } from "../frame";
import { isSolError } from "../errorValue";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";
import "./ElementCard.css";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { makeNodeComponent } from "./standardNode";
import { elementPicker } from "../elementPickerStore";
import { getOwningView } from "../activeGraph";
import { processGraph } from "../process";
import { stopDragStart } from "../coarse";

/** A fact's number at rest, with its unit; blank where nobody has measured it. */
const fact = (v: unknown, unit = "") => (typeof v === "number" && Number.isFinite(v) ? `${shortNum(v)}${unit}` : "–");

/** The Element card: the element's tile, tinted by its category, beside its key facts; the tile opens the periodic
 *  table while nothing is wired. Wired, a pager steps through the elements, one row each of the Elements frame. */
export function ElementComponent({ data, emit }: NodeProps<ElementNodeType>) {
  const wired = useConnectedInputs(data.id).has("symbol");
  const palette = useSeriesColors();
  const out = isFrameValue(data.cachedResult) ? data.cachedResult : null;
  const rows = out ? frameRowCount(out) : 0;
  const [shownRow, setShownRow] = useState(data.row);
  const row = Math.min(Math.max(0, shownRow), Math.max(0, rows - 1));
  const step = (d: number) => {
    data.row = Math.min(Math.max(0, row + d), Math.max(0, rows - 1));
    setShownRow(data.row);
  };
  const cell = (name: string) => out?.columns.find((c) => c.name === name)?.values[row];
  // Wired, a socket carries every row's value, as the core answers it: a list, or the one value of a single pick.
  const column = (name: string) => {
    const values = out?.columns.find((c) => c.name === name)?.values ?? [];
    return values.length === 1 ? values[0] : values;
  };
  const shownSymbol = cell("Symbol");
  const el = typeof shownSymbol === "string" ? ELEMENT_BY_SYMBOL.get(shownSymbol) : wired ? undefined : ELEMENT_BY_SYMBOL.get(data.symbol);
  const hueAt = el ? ELEMENT_CATEGORIES.indexOf(el.category as (typeof ELEMENT_CATEGORIES)[number]) : -1;
  const hue = hueAt >= 0 ? palette[hueAt % palette.length] : undefined;

  const openPicker = () => {
    elementPicker.open({
      symbol: data.symbol,
      onPick: (symbol) => {
        data.symbol = symbol;
        void getOwningView(data.id)?.rerenderNode(data.id);
        data.edited(); void processGraph();
      },
    });
  };

  const tileRef = useRef<HTMLButtonElement>(null);
  const tileTop = useAnchorTop(tileRef);
  const port = data.inputs.symbol;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      {tileTop !== undefined && port && <NodeSocket side="input" socketKey="symbol" nodeId={data.id} emit={emit} payload={port.socket} top={tileTop} />}
      <div className="el-card">
        <button
          ref={tileRef}
          type="button"
          className={`el-card__tile${wired ? " el-card__tile--wired" : ""}`}
          style={hue ? ({ "--el-hue": hue } as React.CSSProperties) : undefined}
          disabled={wired}
          onClick={(e) => { e.stopPropagation(); openPicker(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          title={wired ? "Wired: the element comes from the cable" : "Pick from the periodic table"}
        >
          {el ? (
            <>
              <span className="el-card__z">{el.n}</span>
              <span className="el-card__mass">{Number(el.mass.toFixed(3))}</span>
              <span className="el-card__symbol">{el.symbol}</span>
              <span className="el-card__name">{el.name}</span>
            </>
          ) : (
            <span className="el-card__symbol el-card__symbol--none">?</span>
          )}
        </button>
        {el && (
          <dl className="el-card__facts">
            <dt>Category</dt><dd>{el.category}</dd>
            <dt>Configuration</dt><dd>{el.config}</dd>
            <dt>State</dt><dd>{el.state}</dd>
            <dt>Melts</dt><dd>{fact(el.melting, " K")}</dd>
            <dt>Boils</dt><dd>{fact(el.boiling, " K")}</dd>
            <dt>Density</dt><dd>{fact(el.density, " g/cm³")}</dd>
            <dt>Electronegativity</dt><dd>{fact(el.electronegativity)}</dd>
          </dl>
        )}
      </div>
      {rows > 1 && <div className="el-card__pager"><RowPager row={row} rows={rows} onStep={step} /></div>}
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "mass",   label: "G/MOL", value: wired ? column("Mass") : el?.mass ?? null },
          { key: "number", label: "Z",     value: wired ? column("Z") : el?.n ?? null },
        ]}
      />
      <FrameOutRow node={data} socketKey="elements" emit={emit}>
        <FrameDisplay frame={previewed(() => (out ?? (isSolError(data.cachedResult) ? data.cachedResult : null)))} label={nodeDisplayName(data)} />
      </FrameOutRow>
    </NodeShell>
  );
}

export const MolarMassComponent = makeNodeComponent<MolarMassNodeType>((n) => n.cachedResult);
