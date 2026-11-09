// [[C132]] workspaceTree. The sample workspace `?navpreview=1` shows before folders and pages exist; workspace-tree.md § The preview.

export type PreviewNode =
  | { kind: "folder"; name: string; children: PreviewNode[] }
  | { kind: "doc"; name: string; pages?: PreviewPage[] };
export type PreviewPage =
  | { kind: "pagefolder"; name: string; children: PreviewPage[] }
  | { kind: "page"; name: string };

export const PREVIEW_WORKSPACE: PreviewNode[] = [
  {
    kind: "folder", name: "Household", children: [
      {
        kind: "folder", name: "2026", children: [
          {
            kind: "doc", name: "Budget 2026", pages: [
              { kind: "pagefolder", name: "Inputs", children: [
                { kind: "page", name: "Assumptions" },
                { kind: "page", name: "Rates" },
              ] },
              { kind: "page", name: "Model" },
              { kind: "page", name: "Summary" },
            ],
          },
          { kind: "doc", name: "Forecast" },
        ],
      },
      { kind: "doc", name: "Expenses" },
    ],
  },
  {
    kind: "folder", name: "Client work", children: [
      { kind: "doc", name: "House move", pages: [{ kind: "page", name: "Timeline" }, { kind: "page", name: "Costs" }] },
    ],
  },
];

export function isNavPreview(): boolean {
  if (typeof location === "undefined") return false;
  return new URLSearchParams(location.search).get("navpreview") === "1";
}
