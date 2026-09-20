// [[C107]] obsidianPlugin
import { useRef, useState } from "react";
import { ArrayChip } from "../../src/graph/components/ArrayChip";
import { FrameChip } from "../../src/graph/components/FrameChip";
import { CubeChip } from "../../src/graph/components/CubeChip";
import { deriveFrame, recordsToCube } from "../../src/graph/frame";
import type { CubeRecord } from "../../src/graph/literalEditors";
import {
  listFromYaml, matrixFromYaml, listToYaml, matrixToYaml, frameSourceFromYaml, frameSourceToYaml, rawCell,
  type PropertyKind, type Family, type YamlRecord,
} from "./yamlValue";

const popupCellType = (family: Family) => (family === "complex" ? "string" : family);

export function PropertyChip({ kind, label, initial, onChange }: {
  kind: PropertyKind;
  label: string;
  initial: unknown;
  onChange: (next: unknown) => void;
}) {
  // Obsidian skips re-rendering a focused property, so the chip tracks its own edits.
  const [yaml, setYaml] = useState<unknown>(initial);
  const latest = useRef<unknown>(initial);
  const commit = (next: unknown) => {
    latest.current = next;
    setYaml(next);
    onChange(next);
  };
  const items = Array.isArray(yaml) ? yaml : [];

  if (kind.shape === "list") {
    const family = kind.family!;
    return (
      <ArrayChip
        value={listFromYaml(items, family)}
        label={label}
        size="sm"
        elem={family}
        popupOverrides={{
          data: items.length ? items.map((v) => [rawCell(v)]) : [[""]],
          cellType: popupCellType(family),
          list: false,
          fixedCols: true,
          onSaveRaw: (cells) => commit(listToYaml(cells, family)),
        }}
      />
    );
  }

  if (kind.shape === "matrix") {
    const family = kind.family!;
    const rows = matrixFromYaml(items, family);
    const raw = (items as unknown[][]).map((row) => (Array.isArray(row) ? row.map(rawCell) : []));
    return (
      <ArrayChip
        value={rows.length ? rows : [[null]]}
        label={label}
        size="sm"
        elem={family}
        popupOverrides={{
          data: raw.length ? raw : [[""]],
          cellType: popupCellType(family),
          onSaveRaw: (cells) => commit(matrixToYaml(cells, family)),
        }}
      />
    );
  }

  if (kind.shape === "frame") {
    const source = frameSourceFromYaml(items);
    return (
      <FrameChip
        value={deriveFrame(source)}
        label={label}
        size="sm"
        source={source}
        onSaveSource={(columns) => commit(frameSourceToYaml(columns))}
        popupOverrides={{ unitTaggable: false, noFormulaColumns: true }}
      />
    );
  }

  return (
    <CubeChip
      value={recordsToCube(items as YamlRecord[])}
      label={label}
      size="sm"
      edit={{
        records: () => (Array.isArray(latest.current) ? (latest.current as CubeRecord[]) : []),
        save: (records) => commit(records),
      }}
    />
  );
}
