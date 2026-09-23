// [[C100]] chartIsAValue
export const titleHeight = (fs: number) => Math.ceil(16 * fs);

export function ChartTitle({ text, fs }: { text: string; fs: number }) {
  const h = titleHeight(fs);
  return (
    <div style={{ height: h, lineHeight: `${h}px`, textAlign: "center", fontSize: 11 * fs, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {text}
    </div>
  );
}
