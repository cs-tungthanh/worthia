import { computePosition, type Position } from "../../shared/position";
import type { CashMovement, Dividend, ImportedMovement, Movement, Stock } from "../api";
import { matchCashTrades, tradeDays } from "./match";
import type { Statement } from "./pinetree";
import type { CashStatement, CashTrade } from "./pinetreeCash";

// What importing one or both Pinetree statements would change.
// - Securities statement: its share movements (buys, sales, bonus shares), dated at settlement, not saved yet.
// - Cash statement: prices those movements (trade price, fees, tax, trade date) and adds cash dividends. Its
//   trades that match no securities row become transactions of their own (one per symbol, side and trade day),
//   so the cash statement alone is enough to record buys and sales; only bonus shares need the securities one.
// - Importing the securities statement later replaces those cash-only transactions with its rows (keeping their
//   prices), so nothing is counted twice.
// Saved rows are matched (securities: symbol, settlement date, type, shares, balance; cash: symbol, side, trade
// day), so importing the same files again changes nothing.

export type SymbolPlan = {
  symbol: string;
  before: { shares: number; avg: number | null; realised: number | null } | null;
  after: Position;
  touched: boolean;
};

export type ImportPlan = {
  symbols: SymbolPlan[];
  movements: ImportedMovement[]; // securities rows: new, or gaining a price
  cashMovements: CashMovement[]; // cash-only trade days not saved yet
  remove: number[]; // cash-only transactions now covered by securities rows
  dividends: { symbol: string; date: string; amount: number }[];
  counts: { newMovements: number; pricesFilled: number; replaced: number; newDividends: number; stillUnpriced: number };
  overSold: string[]; // symbols whose sales exceed buys + bonus shares (bonus shares missing)
  missingBonus: boolean; // cash statement imported without the securities statement
  rights: string[];
  changes: number;
};

const secKey = (m: { symbol: string; date: string; kind: string; quantity: number; balance: number | null }) =>
  `${m.symbol}|${m.date}|${m.kind}|${m.quantity}|${m.balance}`;
const dayKey = (m: { symbol: string; kind: string; date: string }) => `${m.symbol}|${m.kind}|${m.date}`;

type Trade = CashTrade & { savedId?: number };

export function planImport(input: {
  securities: Statement | null;
  cash: CashStatement | null;
  saved: Movement[];
  stocks: Stock[];
  dividends: Dividend[];
}): ImportPlan {
  const { securities, cash, saved, stocks, dividends } = input;
  const savedSec = new Map(saved.filter((m) => m.origin === "securities").map((m) => [secKey(m), m]));
  const savedCash = new Map(
    saved
      .filter((m) => m.origin === "cash" && m.kind !== "bonus" && m.trade_date)
      .map((m) => [dayKey({ ...m, date: m.trade_date! }), m]),
  );

  // Securities rows to price: the new statement's, or (without one) those already saved.
  const base: ImportedMovement[] = securities
    ? securities.movements
        .filter((m) => m.kind !== "other")
        .map((m) => ({
          symbol: m.symbol,
          date: m.date,
          kind: m.kind as ImportedMovement["kind"],
          quantity: m.kind === "sell" ? m.quantityOut : m.quantityIn,
          balance: m.balance,
          price: null,
          fee: null,
          tax: null,
          trade_date: null,
        }))
        .filter((m) => m.quantity > 0)
    : [...savedSec.values()].map((m) => ({ ...m, balance: m.balance! }));

  // Trades: the cash statement's, plus cash-only transactions saved earlier that it doesn't repeat (so a new
  // securities statement can replace them too).
  const fresh: Trade[] = cash?.trades ?? [];
  const freshDays = new Set(tradeDays(fresh).map(dayKey));
  const savedTrades: Trade[] = [...savedCash.values()]
    .filter((m) => !freshDays.has(dayKey({ ...m, date: m.trade_date! })))
    .map((m) => ({
      tradeDate: m.trade_date!,
      symbol: m.symbol,
      kind: m.kind as "buy" | "sell",
      quantity: m.quantity,
      value: (m.price ?? 0) * m.quantity,
      fee: m.fee ?? 0,
      tax: m.tax ?? 0,
      savedId: m.id,
    }));
  const { priced, matched, unmatched } = matchCashTrades(base, [...fresh, ...savedTrades]);

  // Securities rows to send: new ones, and saved ones gaining a price.
  const movements: ImportedMovement[] = [];
  let newSecurities = 0;
  let pricesFilled = 0;
  const touched = new Set<string>();
  for (const m of base) {
    const p = priced.get(m);
    const row = p ? { ...m, ...p } : m;
    const existing = savedSec.get(secKey(m));
    if (!existing) {
      newSecurities++;
      movements.push(row);
      touched.add(m.symbol);
    } else if (p && existing.price == null) {
      pricesFilled++;
      movements.push(row);
      touched.add(m.symbol);
    }
  }

  // Cash-only transactions now covered by a securities row are removed; the row carries their price.
  const remove: number[] = [];
  for (const g of matched) {
    for (const t of g.trades) if (t.savedId) remove.push(t.savedId);
    const same = savedCash.get(dayKey(g));
    if (same && !remove.includes(same.id)) remove.push(same.id);
  }
  for (const id of remove) touched.add(saved.find((m) => m.id === id)!.symbol);

  // Cash trade days matching no securities row become transactions, unless already saved.
  const cashMovements: CashMovement[] = unmatched
    .filter((g) => g.trades.some((t) => !t.savedId) && !savedCash.has(dayKey(g)))
    .map((g) => ({
      symbol: g.symbol,
      date: g.date,
      trade_date: g.date,
      kind: g.kind,
      quantity: g.quantity,
      price: g.value / g.quantity,
      fee: Math.round(g.fee),
      tax: Math.round(g.tax),
    }));
  for (const m of cashMovements) touched.add(m.symbol);

  // Cash dividends not recorded yet (same stock, date and amount).
  const symbolOf = new Map(stocks.map((s) => [s.id, s.symbol]));
  const recorded = new Set(dividends.map((d) => `${symbolOf.get(d.stock_id)}|${d.paid_date}|${d.cash_amount}`));
  const newDividends = (cash?.dividends ?? []).filter((d) => !recorded.has(`${d.symbol}|${d.date}|${d.amount}`));
  for (const d of newDividends) touched.add(d.symbol);

  // Positions after the import: saved movements with the import applied, then the new rows.
  const sentSec = new Map(movements.map((m) => [secKey(m), m]));
  type Row = Omit<Movement, "id" | "source" | "origin">;
  const merged: Row[] = [
    ...saved
      .filter((m) => !remove.includes(m.id))
      .map((m) => {
        const update = m.origin === "securities" ? sentSec.get(secKey(m)) : undefined;
        return update ? { ...m, price: update.price, fee: update.fee, tax: update.tax } : m;
      }),
    ...movements.filter((m) => !savedSec.has(secKey(m))),
    ...cashMovements.map((m) => ({ ...m, balance: null })),
  ];
  const allSymbols = [...new Set([...merged.map((m) => m.symbol), ...touched])].sort();
  const symbols: SymbolPlan[] = allSymbols.map((symbol) => {
    const moves = merged
      .map((m, order) => ({ m, order }))
      .filter(({ m }) => m.symbol === symbol)
      .sort((a, b) => a.m.date.localeCompare(b.m.date) || a.order - b.order)
      .map(({ m }) => m);
    const now = stocks.find((s) => s.symbol === symbol);
    return {
      symbol,
      before: now ? { shares: now.shares, avg: now.avg_price, realised: now.realised } : null,
      after: computePosition(moves),
      touched: touched.has(symbol),
    };
  });

  const newMovements = newSecurities + cashMovements.length;
  return {
    symbols,
    movements,
    cashMovements,
    remove,
    dividends: newDividends,
    counts: {
      newMovements,
      pricesFilled,
      replaced: remove.length,
      newDividends: newDividends.length,
      stillUnpriced: merged.filter((m) => m.kind !== "bonus" && m.price == null).length,
    },
    overSold: symbols.filter((s) => s.after.overSold).map((s) => s.symbol),
    missingBonus: !securities && cashMovements.length > 0,
    rights: cash?.rights ?? [],
    changes: newMovements + pricesFilled + remove.length + newDividends.length,
  };
}
