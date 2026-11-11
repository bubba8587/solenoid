// [[C44]] dateSerials, [[frame-verbs#Type inference]]
/** Which number is the month in a date of numbers alone (`1/2/26`): blank reads it as DATEVALUE does, `#AMBIGUOUS!` when
 *  both could be; the others say which, a two-digit year read as DATEVALUE reads it. The core reads it (`DateOrder`). */
export type DateOrder = "" | "MDY" | "DMY" | "YMD";

const ORDERS: readonly DateOrder[] = ["", "MDY", "DMY", "YMD"];

export const isDateOrder = (v: unknown): v is DateOrder => typeof v === "string" && (ORDERS as readonly string[]).includes(v);

export const DATE_ORDER_OPTIONS: { value: DateOrder; label: string; title: string }[] = [
  { value: "", label: "Auto", title: "Read dates written in numbers alone only when the order is plain: 3/15/2026 is a date, 1/2/2026 is #AMBIGUOUS!" },
  { value: "MDY", label: "MDY", title: "Month first, as the US writes dates: 1/2/26 is 2 January 2026" },
  { value: "DMY", label: "DMY", title: "Day first: 1/2/26 is 1 February 2026" },
  { value: "YMD", label: "YMD", title: "Year first: 26/1/2 is 2 January 2026" },
];
