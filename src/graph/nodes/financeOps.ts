// [[C17]] shareImpl

export type CouponOp = "coupdaybs" | "coupdays" | "coupdaysnc" | "coupncd" | "couppcd" | "coupnum";

export type TBillOp = "tbilleq" | "tbillprice" | "tbillyield";

export type SecurityDiscOp = "disc" | "intrate" | "received";

export type PriceDiscOp = "pricedisc" | "yielddisc";

export type PriceMatOp = "pricemat" | "yieldmat";

export type DurationOp = "duration" | "mduration";

export type BondPriceOp = "price" | "yield";

export type OddCouponOp = "oddfprice" | "oddfyield" | "oddlprice" | "oddlyield";

// ─── Return-series math (pandas pct_change/cumprod, quantmod, PerformanceAnalytics) ───

export type ReturnsOp = "log" | "simple" | "cumulative" | "drawdown" | "maxdrawdown" | "cagr" | "volatility" | "sharpe" | "sortino";
export type ReturnsInput = "prices" | "returns";
export const RETURNS_OP_META: Record<ReturnsOp, { label: string; fx: string; takes: ReturnsInput; scalar: boolean; needs: ("rf" | "periods")[]; description: string }> = {
  log:         { label: "Log returns",       fx: "LOGRETURNS",  takes: "prices",  scalar: false, needs: [],               description: "`ln(pₜ / pₜ₋₁)` per period; the first is blank. `numpy.diff(log(p))`, quantmod `dailyReturn` with `type = log`." },
  simple:      { label: "Simple returns",    fx: "PCTCHANGE",   takes: "prices",  scalar: false, needs: [],               description: "`pₜ / pₜ₋₁ − 1` per period; the first is blank. pandas `pct_change`, quantmod `dailyReturn`." },
  cumulative:  { label: "Cumulative return", fx: "CUMRETURNS",  takes: "returns", scalar: false, needs: [],               description: "Compounded growth so far: `Π(1 + r) − 1` per period. `(1 + r).cumprod() − 1`, PerformanceAnalytics `Return.cumulative`." },
  drawdown:    { label: "Drawdown",          fx: "DRAWDOWN",    takes: "prices",  scalar: false, needs: [],               description: "Fall from the running peak per period: `pₜ / max(p₀…pₜ) − 1`, zero at a new high. PerformanceAnalytics `Drawdowns`." },
  maxdrawdown: { label: "Max drawdown",      fx: "MAXDRAWDOWN", takes: "prices",  scalar: true,  needs: [],               description: "The deepest peak-to-trough fall, as a negative fraction. PerformanceAnalytics `maxDrawdown`." },
  cagr:        { label: "CAGR",              fx: "CAGR",        takes: "prices",  scalar: true,  needs: ["periods"],      description: "Compound growth rate per year: (`p_last` / `p_first`)^(periods per year / periods elapsed) − 1." },
  volatility:  { label: "Volatility",        fx: "VOLATILITY",  takes: "returns", scalar: true,  needs: ["periods"],      description: "Sample standard deviation of the returns × √(periods per year). pandas `std` times `√252`." },
  sharpe:      { label: "Sharpe ratio",      fx: "SHARPE",      takes: "returns", scalar: true,  needs: ["rf", "periods"], description: "`mean(r − rf)` / `stdev(r − rf)` × √(periods per year); `rf` is the risk-free rate PER PERIOD. PerformanceAnalytics `SharpeRatio`." },
  sortino:     { label: "Sortino ratio",     fx: "SORTINO",     takes: "returns", scalar: true,  needs: ["rf", "periods"], description: "`mean(r − rf)` / downside deviation × √(periods per year), penalizing only the below-target returns. PerformanceAnalytics `SortinoRatio`." },
};
