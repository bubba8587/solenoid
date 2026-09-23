// [[C107]] obsidianPlugin, [[D72]] pluginSaveWritesSourceText
import { useRef, useState, useSyncExternalStore } from "react";
import { ArrayChip, arrayAccentFor } from "../../src/graph/components/ArrayChip";
import { themeVersion, tokenHex } from "./shadow";
import { FrameChip } from "../../src/graph/components/FrameChip";
import { CubeChip } from "../../src/graph/components/CubeChip";
import { deriveFrame, recordsToCube } from "../../src/graph/frame";
import type { CubeRecord } from "../../src/graph/literalEditors";
import {
  coerceYaml, listFromYaml, matrixFromYaml, listToYaml, matrixToYaml, frameSourceFromYaml, frameSourceToYaml, columnTypesOf, rawCell,
  type PropertyKind, type Family, type YamlRecord, type ColumnTypes,
} from "./yamlValue";

const popupCellType = (family: Family) => (family === "complex" ? "string" : family);

function typeAccent(kind: PropertyKind, resolveToken: (token: string) => string | undefined): string | undefined {
  const token =
    kind.shape === "frame" ? "--sock-frame"
    : kind.shape === "cube" ? "--sock-cube"
    : arrayAccentFor(kind.family, kind.shape === "matrix").replace(/^var\(|\)$/g, "");
  return resolveToken(token);
}

export function PropertyChip({ kind, label, initial, onChange, columnTypes, onColumnTypes, resolveToken = tokenHex }: {
  kind: PropertyKind;
  label: string;
  initial: unknown;
  onChange: (next: unknown) => void;
  columnTypes?: ColumnTypes;
  onColumnTypes?: (types: ColumnTypes) => void;
  resolveToken?: (token: string) => string | undefined;
}) {
  const [yaml, setYaml] = useState<unknown>(initial);
  const latest = useRef<unknown>(initial);
  const [picked, setPicked] = useState<ColumnTypes>(columnTypes ?? {});
  const commit = (next: unknown) => {
    latest.current = next;
    setYaml(next);
    onChange(next);
  };
  const items = coerceYaml(kind, yaml) as unknown[];
  useSyncExternalStore(themeVersion.subscribe, themeVersion.get);
  const accent = typeAccent(kind, resolveToken);

  if (kind.shape === "list") {
    const family = kind.family!;
    return (
      <ArrayChip
        value={listFromYaml(items, family)}
        label={label}
        size="sm"
        accent={accent}
        elem={family}
        popupOverrides={{
          data: items.length ? items.map((v) => [rawCell(v)]) : [[""]],
          cellType: popupCellType(family),
          list: false,
          fixedCols: true,
          onSaveRaw: (cells) => commit(listToYaml(cells, yaml)),
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
        value={rows}
        twoD
        label={label}
        size="sm"
        accent={accent}
        elem={family}
        popupOverrides={{
          data: raw.length ? raw : [[""]],
          cellType: popupCellType(family),
          list: false,
          onSaveRaw: (cells) => commit(matrixToYaml(cells, yaml)),
        }}
      />
    );
  }

  if (kind.shape === "frame") {
    const source = frameSourceFromYaml(items, picked);
    const editorSource = source.length ? source : [{ name: "", type: "string" as const, cells: [""] }];
    return (
      <FrameChip
        value={deriveFrame(source)}
        label={label}
        size="sm"
        accent={accent}
        source={editorSource}
        onSaveSource={(columns) => {
          const types = columnTypesOf(columns);
          setPicked((prev) => ({ ...prev, ...types }));
          onColumnTypes?.(types);
          commit(frameSourceToYaml(columns, yaml));
        }}
        popupOverrides={{ unitTaggable: false, noFormulaColumns: true }}
      />
    );
  }

  return (
    <CubeChip
      value={recordsToCube(items as YamlRecord[])}
      label={label}
      size="sm"
      accent={accent}
      edit={{
        records: () => coerceYaml(kind, latest.current) as CubeRecord[],
        save: (records) => commit(records),
      }}
    />
  );
}
