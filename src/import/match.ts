import type { CashTrade } from "./pinetreeCash";

// Gives securities-statement rows (settlement-dated, no prices) their prices from cash-statement trades.
//
// A trade settles 2 sessions after it happens (T+2), and one order can be filled in parts, so rows don't pair
// one-to-one: TLG bought as 40 + 100 on 28/01 arrives as one +140 row on 30/01, while two DTP fills of 200 on
// 13/11 arrive as two +200 rows on 17/11. So both sides are totalled per (symbol, side, day) and a settlement day
// is paired with the latest trade day of the same total up to MAX_DAYS before it. Its rows share that day's
// average price, with fees and tax split by shares.

const MAX_DAYS = 10;

export type SettledRow = { symbol: string; date: string; kind: "buy" | "sell" | "bonus"; quantity: number };
export type Pricing = { price: number; fee: number; tax: number; trade_date: string };

// One symbol's buys or sales on one trade day, totalled.
export type TradeDay<T extends CashTrade = CashTrade> = {
  symbol: string;
  kind: "buy" | "sell";
  date: string;
  quantity: number;
  value: number;
  fee: number;
  tax: number;
  trades: T[];
};

const days = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;

export function tradeDays<T extends CashTrade>(trades: T[]): TradeDay<T>[] {
  const byKey = new Map<string, TradeDay<T>>();
  for (const t of trades) {
    const k = `${t.symbol}|${t.kind}|${t.tradeDate}`;
    const g = byKey.get(k) ?? {
      symbol: t.symbol,
      kind: t.kind,
      date: t.tradeDate,
      quantity: 0,
      value: 0,
      fee: 0,
      tax: 0,
      trades: [],
    };
    g.quantity += t.quantity;
    g.value += t.value;
    g.fee += t.fee;
    g.tax += t.tax;
    g.trades.push(t);
    byKey.set(k, g);
  }
  return [...byKey.values()];
}

export function matchCashTrades<R extends SettledRow, T extends CashTrade>(rows: R[], trades: T[]) {
  type Settled = { symbol: string; kind: "buy" | "sell"; date: string; quantity: number; rows: R[] };
  const settled = new Map<string, Settled>();
  for (const r of rows) {
    if (r.kind === "bonus") continue;
    const k = `${r.symbol}|${r.kind}|${r.date}`;
    const g = settled.get(k) ?? { symbol: r.symbol, kind: r.kind, date: r.date, quantity: 0, rows: [] };
    g.quantity += r.quantity;
    g.rows.push(r);
    settled.set(k, g);
  }

  const groups = tradeDays(trades);
  const used = new Set<TradeDay<T>>();
  const priced = new Map<R, Pricing>();
  for (const s of [...settled.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const t = groups
      .filter(
        (g) =>
          !used.has(g) &&
          g.symbol === s.symbol &&
          g.kind === s.kind &&
          g.quantity === s.quantity &&
          days(s.date, g.date) >= 0 &&
          days(s.date, g.date) <= MAX_DAYS,
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0]; // latest trade day first: the closest to settlement
    if (!t) continue;
    used.add(t);
    for (const r of s.rows) {
      const share = r.quantity / s.quantity;
      priced.set(r, {
        price: t.value / t.quantity,
        fee: Math.round(t.fee * share),
        tax: Math.round(t.tax * share),
        trade_date: t.date,
      });
    }
  }

  return { priced, matched: groups.filter((g) => used.has(g)), unmatched: groups.filter((g) => !used.has(g)) };
}
